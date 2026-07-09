/**
 * Saturday Morning Latte cron driver.
 *
 * Mirrors the daily-grind-cron architecture: separate generate + send flows,
 * fallback to most-recent cached issue if today's isn't ready, per-recipient
 * timezone routing.
 *
 * Operates on saturday_latte_subscribers + saturday_latte_issues tables —
 * the Latte is treated as an entirely separate system from the Daily Grind.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  type SaturdayLatteIssue,
  generateSaturdayLatteIssue,
} from "./saturday-latte-generator";
import {
  type SaturdayLatteContent,
  renderSaturdayLatteHtml,
} from "./saturday-latte-html-template";
import {
  UNSUBSCRIBE_PLACEHOLDER,
  isSuppressed,
  listUnsubscribeHeaders,
  rewriteUnsubscribeUrl,
} from "./send-compliance";

type LatteSubscriber = {
  id: string;
  email: string;
  display_name: string | null;
  timezone: string;
  send_at_hour_local: number;
  active: boolean;
  last_sent_issue_date: string | null;
};

type CachedLatteIssue = {
  issue_date: string;
  subject: string;
  cover_story_headline: string;
  preheader: string;
  sections: SaturdayLatteContent;
  html: string;
  text_body: string;
  model: string;
};

export type LatteSendResult = {
  triggeredAtUtc: string;
  subscribersChecked: number;
  subscribersDueNow: number;
  sent: Array<{ email: string; issueDate: string; resendId: string; fallback?: boolean }>;
  skipped: Array<{ email: string; reason: string }>;
  errors: Array<{ email: string; error: string }>;
  issueDate: string | null;
};

export type LatteGenerateResult = {
  triggeredAtUtc: string;
  targetDate: string;
  generated: boolean;
  reusedExisting: boolean;
  headline: string | null;
  costUsd: number | null;
  latencyMs: number | null;
  error: string | null;
};

function getServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("saturday_latte_cron: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
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

function isSaturday(weekdayShort: string): boolean {
  return weekdayShort === "Sat";
}

function toIsoDate(parts: { year: string; month: string; day: string }): string {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function loadActiveSubscribers(db: SupabaseClient): Promise<LatteSubscriber[]> {
  const { data, error } = await db
    .from("saturday_latte_subscribers")
    .select("id, email, display_name, timezone, send_at_hour_local, active, last_sent_issue_date")
    .eq("active", true);
  if (error) throw new Error(`load_subscribers: ${error.message}`);
  return (data ?? []) as LatteSubscriber[];
}

async function loadCachedIssue(
  db: SupabaseClient,
  issueDate: string,
): Promise<CachedLatteIssue | null> {
  const { data, error } = await db
    .from("saturday_latte_issues")
    .select(
      "issue_date, subject, cover_story_headline, preheader, sections, html, text_body, model",
    )
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) throw new Error(`load_cached_issue: ${error.message}`);
  return (data ?? null) as CachedLatteIssue | null;
}

async function loadMostRecentCachedIssue(
  db: SupabaseClient,
  maxDate: string,
): Promise<CachedLatteIssue | null> {
  const { data, error } = await db
    .from("saturday_latte_issues")
    .select(
      "issue_date, subject, cover_story_headline, preheader, sections, html, text_body, model",
    )
    .lte("issue_date", maxDate)
    .order("issue_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as CachedLatteIssue | null;
}

async function loadRecentCoverStories(db: SupabaseClient, limit = 12): Promise<string[]> {
  const { data, error } = await db
    .from("saturday_latte_issues")
    .select("cover_story_headline")
    .order("issue_date", { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as Array<{ cover_story_headline: string }>).map(
    (r) => r.cover_story_headline,
  );
}

export type RecentLatteContext = {
  coverStoryHeadlines: string[];
  cars: string[];
  tastingMenuTitles: string[];
  cookingMoves: string[];
  sundayResetAuthors: string[];
  sabbathReferences: string[];
};

export async function loadRecentLatteContext(
  db: SupabaseClient,
  limit = 12,
): Promise<RecentLatteContext> {
  const { data, error } = await db
    .from("saturday_latte_issues")
    .select("cover_story_headline, sections")
    .order("issue_date", { ascending: false })
    .limit(limit);
  if (error) {
    return {
      coverStoryHeadlines: [],
      cars: [],
      tastingMenuTitles: [],
      cookingMoves: [],
      sundayResetAuthors: [],
      sabbathReferences: [],
    };
  }
  const ctx: RecentLatteContext = {
    coverStoryHeadlines: [],
    cars: [],
    tastingMenuTitles: [],
    cookingMoves: [],
    sundayResetAuthors: [],
    sabbathReferences: [],
  };
  for (const row of (data ?? []) as Array<{ cover_story_headline: string; sections: unknown }>) {
    if (row.cover_story_headline) ctx.coverStoryHeadlines.push(row.cover_story_headline);
    const s = row.sections;
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const sections = s as Record<string, unknown>;
    const drive = sections.theDrive;
    if (drive && typeof drive === "object" && !Array.isArray(drive)) {
      const car = (drive as Record<string, unknown>).car;
      if (typeof car === "string" && car.trim() !== "") ctx.cars.push(car.trim());
    }
    const tm = sections.tastingMenu;
    if (Array.isArray(tm)) {
      for (const item of tm) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const title = (item as Record<string, unknown>).title;
          if (typeof title === "string" && title.trim() !== "")
            ctx.tastingMenuTitles.push(title.trim());
        }
      }
    }
    const hc = sections.hostsCorner;
    if (hc && typeof hc === "object" && !Array.isArray(hc)) {
      const title = (hc as Record<string, unknown>).moveTitle;
      if (typeof title === "string" && title.trim() !== "")
        ctx.cookingMoves.push(title.trim());
    }
    const sr = sections.sundayReset;
    if (sr && typeof sr === "object" && !Array.isArray(sr)) {
      const author = (sr as Record<string, unknown>).author;
      if (typeof author === "string" && author.trim() !== "")
        ctx.sundayResetAuthors.push(author.trim());
    }
    const sb = sections.sabbath;
    if (sb && typeof sb === "object" && !Array.isArray(sb)) {
      const ref = (sb as Record<string, unknown>).reference;
      if (typeof ref === "string" && ref.trim() !== "") ctx.sabbathReferences.push(ref.trim());
    }
  }
  return ctx;
}

async function persistIssue(
  db: SupabaseClient,
  issueDate: string,
  issue: SaturdayLatteIssue,
  rendered: { html: string; text: string; subject: string; preheader: string },
): Promise<void> {
  const totalInput = issue.meta.researchInputTokens + issue.meta.writerInputTokens;
  const totalOutput = issue.meta.researchOutputTokens + issue.meta.writerOutputTokens;
  const totalLatency = issue.meta.researchLatencyMs + issue.meta.writerLatencyMs;
  const { error } = await db.from("saturday_latte_issues").upsert(
    {
      issue_date: issueDate,
      subject: rendered.subject,
      cover_story_headline: issue.content.coverStoryHeadline,
      preheader: rendered.preheader,
      sections: issue.content,
      html: rendered.html,
      text_body: rendered.text,
      model: issue.meta.model,
      input_tokens: totalInput,
      output_tokens: totalOutput,
      cost_usd: issue.meta.totalCostUsd,
      latency_ms: totalLatency,
      // Explicitly set generated_at on every write so the staleness-detection
      // guard in cache_check sees the correct age after upsert-replace.
      generated_at: new Date().toISOString(),
      research_sources: {
        destinations: issue.research.destinations.map((r) => ({ source: r.source, url: r.url })),
        products: issue.research.products.map((r) => ({ source: r.source, url: r.url })),
        cars: issue.research.cars.map((r) => ({ source: r.source, url: r.url })),
        watchReadListen: issue.research.watchReadListen.map((r) => ({
          source: r.source,
          url: r.url,
        })),
        cooking: issue.research.cooking.map((r) => ({ source: r.source, url: r.url })),
      },
      generation_meta: {
        contentType: issue.contentType,
        researchCitations: issue.meta.researchCitations,
        researchCostUsd: issue.meta.researchCostUsd,
        researchInputTokens: issue.meta.researchInputTokens,
        researchOutputTokens: issue.meta.researchOutputTokens,
        researchLatencyMs: issue.meta.researchLatencyMs,
        writerInputTokens: issue.meta.writerInputTokens,
        writerOutputTokens: issue.meta.writerOutputTokens,
        writerLatencyMs: issue.meta.writerLatencyMs,
        imagesGenerated: issue.meta.imagesGenerated,
        imagesFailed: issue.meta.imagesFailed,
        imagesCostUsd: issue.meta.imagesCostUsd,
        imagesLatencyMs: issue.meta.imagesLatencyMs,
        urlsValidated: issue.meta.urlsValidated,
        urlsDropped: issue.meta.urlsDropped,
        ...(issue.meta.imagePromptsSource ? { imagePromptsSource: issue.meta.imagePromptsSource } : {}),
        ...(issue.meta.imagePromptsError ? { imagePromptsError: issue.meta.imagePromptsError } : {}),
        ...(issue.meta.imagesError ? { imagesError: issue.meta.imagesError } : {}),
      },
    },
    { onConflict: "issue_date" },
  );
  if (error) throw new Error(`persist_issue: ${error.message}`);
}

async function sendOne(
  resend: Resend,
  recipient: LatteSubscriber,
  rendered: { html: string; text: string; subject: string },
): Promise<string> {
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "latte@send.castorabbott.com";
  const personalised = rewriteUnsubscribeUrl(
    rendered.html,
    rendered.text,
    recipient.email,
    "latte",
  );
  const result = await resend.emails.send({
    from: `Mark <${fromAddress}>`,
    to: [recipient.email],
    subject: rendered.subject,
    html: personalised.html,
    text: personalised.text,
    headers: listUnsubscribeHeaders(recipient.email, "latte"),
  });
  if (result.error) {
    throw new Error(`resend_send: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  if (!result.data?.id) throw new Error("resend_send: missing data.id");
  return result.data.id;
}

async function markSent(
  db: SupabaseClient,
  subscriberId: string,
  issueDate: string,
): Promise<void> {
  const { error } = await db
    .from("saturday_latte_subscribers")
    .update({ last_sent_issue_date: issueDate })
    .eq("id", subscriberId);
  if (error) throw new Error(`mark_sent: ${error.message}`);
}

function injectFallbackNote(html: string, requestedDate: string, fallbackDate: string): string {
  const note = `<!-- fallback: requested=${requestedDate} delivered=${fallbackDate} -->
<tr><td style="padding: 12px 48px 0 48px;"><p style="font-size: 11px; color: #b8aa92; font-style: italic; margin: 0;">Note: today&#039;s fresh issue was not available, so this is a recent issue you may have missed.</p></td></tr>`;
  return html.replace("<!-- FOOTER -->", `${note}\n<!-- FOOTER -->`);
}

// ─── Public: generate ──────────────────────────────────────────────────────

export async function runLatteGenerate(
  opts: { targetDate?: string; regenerate?: boolean } = {},
): Promise<LatteGenerateResult> {
  const nowUtc = new Date();
  // Default targetDate: the nearest upcoming Saturday in UTC. If today is
  // Saturday, target today; otherwise target this week's Saturday.
  let targetDate = opts.targetDate;
  if (!targetDate) {
    const d = new Date(nowUtc);
    const utcDay = d.getUTCDay(); // 0=Sun, 6=Sat
    const daysUntilSat = (6 - utcDay + 7) % 7;
    d.setUTCDate(d.getUTCDate() + daysUntilSat);
    targetDate = d.toISOString().slice(0, 10);
  }

  const result: LatteGenerateResult = {
    triggeredAtUtc: nowUtc.toISOString(),
    targetDate,
    generated: false,
    reusedExisting: false,
    headline: null,
    costUsd: null,
    latencyMs: null,
    error: null,
  };

  try {
    const db = getServiceRoleClient();
    // Staleness-detection cache check (added 2026-06-15 after test rows shipped
    // stale content on the DG side; same guard applied here for Latte).
    // Any cached row older than STALE_HOURS is treated as a miss so a fresh
    // generation runs; prevents old test/ad-hoc rows from silently shipping.
    const STALE_HOURS = 12;
    if (!opts.regenerate) {
      const { data: existing } = await db
        .from("saturday_latte_issues")
        .select("issue_date, cover_story_headline, generated_at")
        .eq("issue_date", targetDate)
        .maybeSingle();
      if (existing) {
        const generatedAt = existing.generated_at ? new Date(existing.generated_at) : null;
        const ageHours = generatedAt
          ? (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60)
          : Number.POSITIVE_INFINITY;
        if (ageHours <= STALE_HOURS) {
          result.reusedExisting = true;
          result.headline = existing.cover_story_headline;
          return result;
        }
        // else: stale — fall through and regenerate.
      }
    }

    const [recentCoverStories, recentContext] = await Promise.all([
      loadRecentCoverStories(db),
      loadRecentLatteContext(db),
    ]);
    const start = Date.now();
    const issue = await generateSaturdayLatteIssue({
      issueDate: targetDate,
      recentCoverStories,
      recentContext,
    });
    const rendered = renderSaturdayLatteHtml(issue.content, {
      issueDate: targetDate,
      unsubscribeUrl: UNSUBSCRIBE_PLACEHOLDER,
      webArchiveUrl: "https://castorabbott.com/newsletter/latte/",
    });
    await persistIssue(db, targetDate, issue, rendered);

    result.generated = true;
    result.headline = issue.content.coverStoryHeadline;
    result.costUsd = issue.meta.totalCostUsd;
    result.latencyMs = Date.now() - start;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

// ─── Public: send ──────────────────────────────────────────────────────────

export async function runLatteSend(
  opts: { force?: boolean } = {},
): Promise<LatteSendResult> {
  const force = opts.force ?? false;
  const db = getServiceRoleClient();
  const nowUtc = new Date();

  const result: LatteSendResult = {
    triggeredAtUtc: nowUtc.toISOString(),
    subscribersChecked: 0,
    subscribersDueNow: 0,
    sent: [],
    skipped: [],
    errors: [],
    issueDate: null,
  };

  const subscribers = await loadActiveSubscribers(db);
  result.subscribersChecked = subscribers.length;

  type DueRow = { subscriber: LatteSubscriber; localDate: string };
  const due: DueRow[] = [];

  for (const sub of subscribers) {
    const parts = localTimeParts(nowUtc, sub.timezone);
    const localDate = toIsoDate(parts);

    if (!force) {
      if (!isSaturday(parts.weekday)) {
        result.skipped.push({ email: sub.email, reason: `not Saturday (${parts.weekday})` });
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

  const resend = new Resend(process.env.RESEND_API_KEY);

  for (const row of due) {
    if (await isSuppressed(db, row.subscriber.email)) {
      result.skipped.push({ email: row.subscriber.email, reason: "suppressed" });
      continue;
    }
    try {
      const fresh = await loadCachedIssue(db, row.localDate);
      let rendered: { html: string; text: string; subject: string };
      let usedFallback = false;
      let actualIssueDate = row.localDate;

      if (fresh && fresh.sections && typeof fresh.sections === "object") {
        rendered = { html: fresh.html, text: fresh.text_body, subject: fresh.subject };
      } else {
        const recent = await loadMostRecentCachedIssue(db, row.localDate);
        if (!recent || !recent.html) {
          result.errors.push({
            email: row.subscriber.email,
            error: `no cached issue for ${row.localDate} and no fallback available`,
          });
          continue;
        }
        usedFallback = true;
        actualIssueDate = recent.issue_date;
        rendered = {
          html: injectFallbackNote(recent.html, row.localDate, recent.issue_date),
          text: recent.text_body,
          subject: recent.subject,
        };
      }

      const resendId = await sendOne(resend, row.subscriber, rendered);
      await markSent(db, row.subscriber.id, row.localDate);
      const sentEntry: { email: string; issueDate: string; resendId: string; fallback?: boolean } =
        { email: row.subscriber.email, issueDate: row.localDate, resendId };
      if (usedFallback) {
        sentEntry.fallback = true;
        result.issueDate = actualIssueDate;
      } else {
        result.issueDate = row.localDate;
      }
      result.sent.push(sentEntry);
    } catch (err) {
      result.errors.push({
        email: row.subscriber.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
