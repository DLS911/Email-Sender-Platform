/**
 * Engagement queries against the email_events table.
 *
 * All queries are indexed:
 * - Per-issue summary: email_events_brand_issue_idx (brand, issue_date)
 * - Per-subscriber history: email_events_email_event_at_idx (email, event_at DESC)
 * - Recent activity: email_events_event_at_idx (event_at DESC)
 *
 * Aggregations use DISTINCT (email) counts so multiple opens by the same
 * subscriber don't inflate the "unique opens" metric.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type BrandId = "daily_grind" | "saturday_latte";

export type IssueMetrics = {
  brand: BrandId;
  issueDate: string;
  sent: number;
  delivered: number;
  uniqueOpens: number;
  uniqueClicks: number;
  bounced: number;
  complained: number;
  openRate: number; // opens / delivered
  clickRate: number; // clicks / delivered
};

export type SubscriberEvent = {
  eventType: string;
  eventAt: string;
  brand: string | null;
  issueDate: string | null;
  clickUrl: string | null;
  bounceType: string | null;
};

export type SubscriberSummary = {
  email: string;
  lastEventAt: string | null;
  lastEventType: string | null;
  totalOpens: number;
  totalClicks: number;
  totalBounces: number;
  totalDelivered: number;
};

function getDb(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("engagement-queries: SUPABASE env missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Aggregate metrics for a single issue. Returns nulls if no events yet.
 * "sent" is inferred from delivered + bounced + complained since Resend
 * emits an event for every terminal outcome (opens/clicks are
 * observational only and don't count as "sent"). If we later log the
 * actual `email.sent` event we can switch to that.
 */
export async function getIssueMetrics(
  brand: BrandId,
  issueDate: string,
): Promise<IssueMetrics | null> {
  const db = getDb();
  const { data, error } = await db
    .from("email_events")
    .select("event_type,email")
    .eq("brand", brand)
    .eq("issue_date", issueDate);
  if (error) throw new Error(`getIssueMetrics: ${error.message}`);
  if (!data || data.length === 0) return null;

  const uniqueOpens = new Set<string>();
  const uniqueClicks = new Set<string>();
  const uniqueDelivered = new Set<string>();
  const uniqueBounced = new Set<string>();
  const uniqueComplained = new Set<string>();

  for (const row of data) {
    const email = String((row as { email: string }).email).toLowerCase();
    const type = String((row as { event_type: string }).event_type);
    if (type === "opened") uniqueOpens.add(email);
    else if (type === "clicked") uniqueClicks.add(email);
    else if (type === "delivered") uniqueDelivered.add(email);
    else if (type === "bounced") uniqueBounced.add(email);
    else if (type === "complained") uniqueComplained.add(email);
  }

  const delivered = uniqueDelivered.size;
  const sent = delivered + uniqueBounced.size + uniqueComplained.size;
  return {
    brand,
    issueDate,
    sent,
    delivered,
    uniqueOpens: uniqueOpens.size,
    uniqueClicks: uniqueClicks.size,
    bounced: uniqueBounced.size,
    complained: uniqueComplained.size,
    openRate: delivered > 0 ? uniqueOpens.size / delivered : 0,
    clickRate: delivered > 0 ? uniqueClicks.size / delivered : 0,
  };
}

/**
 * Recent issues across brands. Reads distinct (brand, issue_date) pairs
 * from the last N days, then aggregates each. For very large event
 * volumes we may want a materialized view; this scan is fine at issue
 * counts under ~1k.
 */
export async function getRecentIssueMetrics(days = 30): Promise<IssueMetrics[]> {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("email_events")
    .select("brand,issue_date")
    .gte("event_at", since)
    .not("brand", "is", null)
    .not("issue_date", "is", null);
  if (error) throw new Error(`getRecentIssueMetrics: ${error.message}`);

  const seen = new Set<string>();
  const keys: Array<{ brand: BrandId; issueDate: string }> = [];
  for (const row of data ?? []) {
    const brand = (row as { brand: string }).brand as BrandId;
    const issueDate = (row as { issue_date: string }).issue_date;
    if (!brand || !issueDate) continue;
    const key = `${brand}::${issueDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push({ brand, issueDate });
  }

  const results = await Promise.all(keys.map((k) => getIssueMetrics(k.brand, k.issueDate)));
  return results
    .filter((r): r is IssueMetrics => r !== null)
    .sort((a, b) => (a.issueDate > b.issueDate ? -1 : 1));
}

/**
 * Per-subscriber event history (most recent first). Limited to a
 * configurable page size for very active subscribers.
 */
export async function getSubscriberEvents(
  email: string,
  limit = 200,
): Promise<SubscriberEvent[]> {
  const db = getDb();
  const { data, error } = await db
    .from("email_events")
    .select("event_type,event_at,brand,issue_date,click_url,bounce_type")
    .eq("email", email.trim().toLowerCase())
    .order("event_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getSubscriberEvents: ${error.message}`);
  return (data ?? []).map((row) => ({
    eventType: String((row as { event_type: string }).event_type),
    eventAt: String((row as { event_at: string }).event_at),
    brand: (row as { brand: string | null }).brand ?? null,
    issueDate: (row as { issue_date: string | null }).issue_date ?? null,
    clickUrl: (row as { click_url: string | null }).click_url ?? null,
    bounceType: (row as { bounce_type: string | null }).bounce_type ?? null,
  }));
}

/**
 * Per-subscriber lifetime summary. Rolls up totals across all issues
 * and brands. Useful for the "who is engaged" list.
 */
export async function getSubscriberSummaries(
  brand?: BrandId,
): Promise<SubscriberSummary[]> {
  const db = getDb();
  let query = db.from("email_events").select("email,event_type,event_at");
  if (brand) query = query.eq("brand", brand);
  const { data, error } = await query;
  if (error) throw new Error(`getSubscriberSummaries: ${error.message}`);

  const perEmail = new Map<string, SubscriberSummary>();
  for (const row of data ?? []) {
    const email = String((row as { email: string }).email).toLowerCase();
    const type = String((row as { event_type: string }).event_type);
    const at = String((row as { event_at: string }).event_at);
    let s = perEmail.get(email);
    if (!s) {
      s = {
        email,
        lastEventAt: null,
        lastEventType: null,
        totalOpens: 0,
        totalClicks: 0,
        totalBounces: 0,
        totalDelivered: 0,
      };
      perEmail.set(email, s);
    }
    if (!s.lastEventAt || at > s.lastEventAt) {
      s.lastEventAt = at;
      s.lastEventType = type;
    }
    if (type === "opened") s.totalOpens++;
    else if (type === "clicked") s.totalClicks++;
    else if (type === "bounced") s.totalBounces++;
    else if (type === "delivered") s.totalDelivered++;
  }

  return Array.from(perEmail.values()).sort((a, b) => {
    if (!a.lastEventAt) return 1;
    if (!b.lastEventAt) return -1;
    return a.lastEventAt > b.lastEventAt ? -1 : 1;
  });
}
