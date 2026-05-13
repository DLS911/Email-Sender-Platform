import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { renderWeekday } from "@platform/email-templates";
import { type DailyGrindIssue, generateDailyGrindIssue } from "./daily-grind-generator";

type TestSubscriber = {
  id: string;
  email: string;
  display_name: string | null;
  timezone: string;
  send_at_hour_local: number;
  active: boolean;
  last_sent_issue_date: string | null;
};

type CachedIssue = {
  issue_date: string;
  subject: string;
  headline: string;
  preheader: string;
  sections: Array<{ name: string; body: string }>;
  html: string;
  text_body: string;
  model: string;
};

export type CronResult = {
  triggeredAtUtc: string;
  subscribersChecked: number;
  subscribersDueNow: number;
  sent: Array<{ email: string; issueDate: string; resendId: string }>;
  skipped: Array<{ email: string; reason: string }>;
  errors: Array<{ email: string; error: string }>;
  issueGenerated: boolean;
  issueDate: string | null;
};

function getServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("daily_grind_cron: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function localTimeParts(nowUtc: Date, timezone: string): {
  year: string;
  month: string;
  day: string;
  hour: number;
  weekday: string;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(nowUtc);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: map.year ?? "0000",
    month: map.month ?? "00",
    day: map.day ?? "00",
    hour: Number(map.hour === "24" ? "0" : (map.hour ?? "0")),
    weekday: map.weekday ?? "Sun",
  };
}

function isWeekday(weekdayShort: string): boolean {
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekdayShort);
}

function toIsoDate(parts: { year: string; month: string; day: string }): string {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function loadActiveSubscribers(db: SupabaseClient): Promise<TestSubscriber[]> {
  const { data, error } = await db
    .from("daily_grind_test_subscribers")
    .select("id, email, display_name, timezone, send_at_hour_local, active, last_sent_issue_date")
    .eq("active", true);
  if (error) throw new Error(`load_subscribers: ${error.message}`);
  return (data ?? []) as TestSubscriber[];
}

async function loadCachedIssue(db: SupabaseClient, issueDate: string): Promise<CachedIssue | null> {
  const { data, error } = await db
    .from("daily_grind_issues")
    .select("issue_date, subject, headline, preheader, sections, html, text_body, model")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) throw new Error(`load_cached_issue: ${error.message}`);
  return (data ?? null) as CachedIssue | null;
}

async function loadRecentTopics(db: SupabaseClient, limit = 30): Promise<string[]> {
  const { data, error } = await db
    .from("daily_grind_issues")
    .select("headline")
    .order("issue_date", { ascending: false })
    .limit(limit);
  if (error) {
    // Don't crash the cron if the lookup fails; just generate without context.
    return [];
  }
  return ((data ?? []) as Array<{ headline: string }>).map((row) => row.headline);
}

function renderToHtmlAndText(issue: DailyGrindIssue, episodeId: string): {
  html: string;
  text: string;
  subject: string;
  preheader: string;
} {
  const rendered = renderWeekday({
    brandName: "Castor Abbott",
    brandSlug: "castor-abbott",
    episodeId,
    headline: issue.headline,
    preheader: issue.preheader || issue.headline.slice(0, 110),
    contentType: issue.contentType,
    sections: issue.sections,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?test=true",
  });
  return {
    html: rendered.html,
    text: rendered.text,
    subject: rendered.subject,
    preheader: rendered.preheader,
  };
}

async function persistIssue(
  db: SupabaseClient,
  issueDate: string,
  issue: DailyGrindIssue,
  rendered: { html: string; text: string; subject: string; preheader: string },
): Promise<void> {
  const { error } = await db.from("daily_grind_issues").insert({
    issue_date: issueDate,
    subject: rendered.subject,
    headline: issue.headline,
    preheader: rendered.preheader,
    sections: issue.sections,
    html: rendered.html,
    text_body: rendered.text,
    model: issue.meta.model,
    input_tokens: issue.meta.inputTokens,
    output_tokens: issue.meta.outputTokens,
    cost_usd: issue.meta.costUsd,
    latency_ms: issue.meta.latencyMs,
    generation_meta: { contentType: issue.contentType },
  });
  if (error) throw new Error(`persist_issue: ${error.message}`);
}

async function sendOne(
  resend: Resend,
  recipient: TestSubscriber,
  rendered: { html: string; text: string; subject: string },
): Promise<string> {
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "daily@send.castorabbott.com";
  const result = await resend.emails.send({
    from: `Castor Abbott Daily Grind <${fromAddress}>`,
    to: [recipient.email],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (result.error) {
    throw new Error(`resend_send: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  if (!result.data?.id) {
    throw new Error("resend_send: response missing data.id");
  }
  return result.data.id;
}

async function markSent(
  db: SupabaseClient,
  subscriberId: string,
  issueDate: string,
): Promise<void> {
  const { error } = await db
    .from("daily_grind_test_subscribers")
    .update({ last_sent_issue_date: issueDate })
    .eq("id", subscriberId);
  if (error) throw new Error(`mark_sent: ${error.message}`);
}

/**
 * Force flag bypasses time-of-day + already-sent gates. Use for manual triggers.
 */
export async function runDailyGrindCron(opts: { force?: boolean } = {}): Promise<CronResult> {
  const force = opts.force ?? false;
  const db = getServiceRoleClient();
  const nowUtc = new Date();

  const result: CronResult = {
    triggeredAtUtc: nowUtc.toISOString(),
    subscribersChecked: 0,
    subscribersDueNow: 0,
    sent: [],
    skipped: [],
    errors: [],
    issueGenerated: false,
    issueDate: null,
  };

  const subscribers = await loadActiveSubscribers(db);
  result.subscribersChecked = subscribers.length;

  type DueRow = { subscriber: TestSubscriber; localDate: string };
  const due: DueRow[] = [];

  for (const sub of subscribers) {
    const parts = localTimeParts(nowUtc, sub.timezone);
    const localDate = toIsoDate(parts);

    if (!force) {
      if (!isWeekday(parts.weekday)) {
        result.skipped.push({ email: sub.email, reason: `weekend (${parts.weekday})` });
        continue;
      }
      if (parts.hour !== sub.send_at_hour_local) {
        result.skipped.push({
          email: sub.email,
          reason: `local hour ${parts.hour} != target ${sub.send_at_hour_local} (${sub.timezone})`,
        });
        continue;
      }
      if (sub.last_sent_issue_date === localDate) {
        result.skipped.push({ email: sub.email, reason: `already sent for ${localDate}` });
        continue;
      }
    }

    due.push({ subscriber: sub, localDate });
  }

  result.subscribersDueNow = due.length;
  if (due.length === 0) return result;

  const issueDate = due[0]!.localDate;
  result.issueDate = issueDate;

  let cached = await loadCachedIssue(db, issueDate);
  let issue: DailyGrindIssue;
  let rendered: { html: string; text: string; subject: string; preheader: string };

  if (cached) {
    rendered = {
      html: cached.html,
      text: cached.text_body,
      subject: cached.subject,
      preheader: cached.preheader,
    };
    issue = {
      headline: cached.headline,
      preheader: cached.preheader,
      contentType: "tactic",
      sections: cached.sections,
      meta: {
        model: cached.model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        issueDate,
      },
    };
  } else {
    const recentTopics = await loadRecentTopics(db);
    issue = await generateDailyGrindIssue({ issueDate, recentTopics });
    result.issueGenerated = true;
    rendered = renderToHtmlAndText(issue, `daily-grind-${issueDate}`);
    await persistIssue(db, issueDate, issue, rendered);
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  for (const row of due) {
    try {
      const resendId = await sendOne(resend, row.subscriber, rendered);
      await markSent(db, row.subscriber.id, row.localDate);
      result.sent.push({ email: row.subscriber.email, issueDate: row.localDate, resendId });
    } catch (err) {
      result.errors.push({
        email: row.subscriber.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
