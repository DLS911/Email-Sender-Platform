import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  extractAndPersistConcepts,
  loadRecentConceptSummaries,
} from "./daily-grind-brain";
import { type DailyGrindIssue, generateDailyGrindIssue } from "./daily-grind-generator";
import {
  type DailyGrindContent,
  renderDailyGrindHtml,
} from "./daily-grind-html-template";

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
  sections: DailyGrindContent;
  html: string;
  text_body: string;
  model: string;
};

export type CronResult = {
  triggeredAtUtc: string;
  subscribersChecked: number;
  subscribersDueNow: number;
  sent: Array<{ email: string; issueDate: string; resendId: string; fallback?: boolean }>;
  skipped: Array<{ email: string; reason: string }>;
  errors: Array<{ email: string; error: string }>;
  issueGenerated: boolean;
  issueDate: string | null;
};

export type GenerateResult = {
  triggeredAtUtc: string;
  targetDate: string;
  generated: boolean;
  reusedExisting: boolean;
  headline: string | null;
  costUsd: number | null;
  latencyMs: number | null;
  brainConceptsPersisted: number | null;
  error: string | null;
  // Research bundle stats — exposed so we can verify research is firing
  // properly and supplying enough distinct sources for the writer. If
  // researchItemCount is low or distinctSources < researchItemCount, that's
  // the upstream cause of writer mode-collapse on Worth Knowing items.
  researchItemCount?: number;
  researchDistinctSources?: number;
  researchSources?: string[];
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

async function loadMostRecentCachedIssue(
  db: SupabaseClient,
  maxDate?: string,
): Promise<CachedIssue | null> {
  let query = db
    .from("daily_grind_issues")
    .select("issue_date, subject, headline, preheader, sections, html, text_body, model")
    .order("issue_date", { ascending: false })
    .limit(1);
  // Never fall back to future-dated content. Without this, a pre-generated
  // tomorrow's issue would silently get sent today if today's was missing.
  if (maxDate) query = query.lte("issue_date", maxDate);
  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return (data ?? null) as CachedIssue | null;
}

/**
 * Inject a small "retried delivery" footer note into rendered HTML. Used when
 * the send route falls back to a previous day's issue because today's wasn't
 * generated. Subscribers see a normal-looking issue with a faint note above
 * the footer; we can grep for it in delivered logs.
 */
function injectFallbackNote(html: string, issueDate: string, fallbackDate: string): string {
  const note = `<!-- fallback: requested=${issueDate} delivered=${fallbackDate} -->
<tr><td style="padding: 12px 40px 0 40px;"><p style="font-size: 11px; color: #b8aa92; font-style: italic; margin: 0;">Note: today's fresh issue was not available, so this is a recent issue you may have missed.</p></td></tr>`;
  // Insert just before the FOOTER row.
  return html.replace("<!-- FOOTER -->", `${note}\n<!-- FOOTER -->`);
}

async function loadRecentHeadlines(db: SupabaseClient, limit = 30): Promise<string[]> {
  const { data, error } = await db
    .from("daily_grind_issues")
    .select("headline")
    .order("issue_date", { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as Array<{ headline: string }>).map((row) => row.headline);
}

async function loadRecentVerses(db: SupabaseClient, limit = 125): Promise<string[]> {
  const { data, error } = await db
    .from("daily_grind_issues")
    .select("sections")
    .order("issue_date", { ascending: false })
    .limit(limit);
  if (error) return [];
  const refs: string[] = [];
  for (const row of (data ?? []) as Array<{ sections: unknown }>) {
    const s = row.sections;
    if (s && typeof s === "object" && !Array.isArray(s)) {
      const at = (s as Record<string, unknown>).ancientTruth;
      if (at && typeof at === "object" && !Array.isArray(at)) {
        const ref = (at as Record<string, unknown>).reference;
        if (typeof ref === "string" && ref.trim() !== "") refs.push(ref.trim());
      }
    }
  }
  return refs;
}

async function persistIssue(
  db: SupabaseClient,
  issueDate: string,
  issue: DailyGrindIssue,
  rendered: { html: string; text: string; subject: string; preheader: string },
): Promise<void> {
  const totalInput = issue.meta.researchInputTokens + issue.meta.writerInputTokens;
  const totalOutput = issue.meta.researchOutputTokens + issue.meta.writerOutputTokens;
  const totalLatency = issue.meta.researchLatencyMs + issue.meta.writerLatencyMs;
  const { error } = await db.from("daily_grind_issues").upsert(
    {
      issue_date: issueDate,
      subject: rendered.subject,
      headline: issue.content.headline,
      preheader: rendered.preheader,
      sections: issue.content,
      html: rendered.html,
      text_body: rendered.text,
      model: issue.meta.model,
      input_tokens: totalInput,
      output_tokens: totalOutput,
      cost_usd: issue.meta.totalCostUsd,
      latency_ms: totalLatency,
      generation_meta: {
        contentType: issue.content.contentType,
        researchWebSearches: issue.meta.researchWebSearches,
        researchInputTokens: issue.meta.researchInputTokens,
        researchOutputTokens: issue.meta.researchOutputTokens,
        researchLatencyMs: issue.meta.researchLatencyMs,
        writerInputTokens: issue.meta.writerInputTokens,
        writerOutputTokens: issue.meta.writerOutputTokens,
        writerLatencyMs: issue.meta.writerLatencyMs,
        researchItemCount: issue.research.items.length,
        researchSources: issue.research.items.map((r) => ({ source: r.source, url: r.url })),
      },
    },
    { onConflict: "issue_date" },
  );
  if (error) throw new Error(`persist_issue: ${error.message}`);
}

async function sendOne(
  resend: Resend,
  recipient: TestSubscriber,
  rendered: { html: string; text: string; subject: string },
): Promise<string> {
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "daily@send.castorabbott.com";
  const result = await resend.emails.send({
    from: `Mark at Castor Abbott <${fromAddress}>`,
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
 * GENERATE-ONLY flow. Used by the nightly pre-generate cron.
 *
 * Researches + writes + persists for opts.targetDate (default: tomorrow UTC).
 * Runs brain extract afterward (best-effort). Does NOT send any emails.
 *
 * If an issue already exists for targetDate, returns reusedExisting=true and
 * skips generation unless opts.regenerate is set.
 *
 * Designed to run on the slow path with the full 300s Vercel budget — sends
 * are handled by runDailyGrindSend on a separate cron schedule.
 */
export async function runDailyGrindGenerate(
  opts: { targetDate?: string; topicHint?: string; regenerate?: boolean } = {},
): Promise<GenerateResult> {
  const nowUtc = new Date();
  const targetDate =
    opts.targetDate ??
    new Date(nowUtc.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const result: GenerateResult = {
    triggeredAtUtc: nowUtc.toISOString(),
    targetDate,
    generated: false,
    reusedExisting: false,
    headline: null,
    costUsd: null,
    latencyMs: null,
    brainConceptsPersisted: null,
    error: null,
  };

  try {
    const db = getServiceRoleClient();

    if (!opts.regenerate) {
      const existing = await loadCachedIssue(db, targetDate);
      if (existing) {
        result.reusedExisting = true;
        result.headline = existing.headline;
        return result;
      }
    }

    const [recentHeadlines, recentVerses, recentConcepts] = await Promise.all([
      loadRecentHeadlines(db),
      loadRecentVerses(db),
      loadRecentConceptSummaries(db, 80),
    ]);

    const start = Date.now();
    const issue = await generateDailyGrindIssue(
      opts.topicHint
        ? {
            issueDate: targetDate,
            recentTopics: recentHeadlines,
            recentVerses,
            recentConcepts,
            topicHint: opts.topicHint,
          }
        : {
            issueDate: targetDate,
            recentTopics: recentHeadlines,
            recentVerses,
            recentConcepts,
          },
    );
    const renderedOutput = renderDailyGrindHtml(issue.content, {
      issueDate: targetDate,
      unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?test=true",
      webArchiveUrl: "https://castorabbott.com/newsletter/grind/",
    });
    await persistIssue(db, targetDate, issue, renderedOutput);

    result.generated = true;
    result.headline = issue.content.headline;
    result.costUsd = issue.meta.totalCostUsd;
    result.latencyMs = Date.now() - start;
    // Surface research stats so we can verify research is producing enough
    // diverse items for the writer. If researchItemCount drops below ~5 or
    // researchDistinctSources is tight, that's the upstream cause of writer
    // mode-collapse.
    result.researchItemCount = issue.research.items.length;
    const distinctSources = new Set(issue.research.items.map((r) => r.source));
    result.researchDistinctSources = distinctSources.size;
    result.researchSources = Array.from(distinctSources);

    try {
      const brain = await extractAndPersistConcepts({
        db,
        content: issue.content,
        issueDate: targetDate,
      });
      result.brainConceptsPersisted = brain.conceptsPersisted;
    } catch (err) {
      console.error("brain.extract_failed", err instanceof Error ? err.message : String(err));
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

/**
 * SEND-ONLY flow. Used by the hourly send cron.
 *
 * For each active subscriber whose local time is currently their target hour
 * on a weekday and who hasn't been sent today's issue yet: look up the cached
 * issue for that subscriber's local date and send it via Resend. If no cached
 * issue exists for the local date, fall back to the most recent cached issue
 * with a footer note (silent re-delivery rather than missing the send).
 *
 * Does NOT generate content. If you want to force a generation, hit
 * runDailyGrindGenerate first or use the legacy runDailyGrindCron path.
 *
 * Force flag bypasses time-of-day + already-sent gates for manual fires.
 */
export async function runDailyGrindSend(
  opts: { force?: boolean } = {},
): Promise<CronResult> {
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

  const resend = new Resend(process.env.RESEND_API_KEY);

  for (const row of due) {
    try {
      const fresh = await loadCachedIssue(db, row.localDate);
      let rendered: { html: string; text: string; subject: string };
      let usedFallback = false;
      let actualIssueDate = row.localDate;

      if (fresh && fresh.sections && typeof fresh.sections === "object") {
        rendered = {
          html: fresh.html,
          text: fresh.text_body,
          subject: fresh.subject,
        };
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

/**
 * Force flag bypasses time-of-day + already-sent gates. Use for manual triggers.
 * skipCache: bypass daily_grind_issues read/write — generate fresh, don't persist
 * topicHint: bias the research phase toward a specific topic area
 *
 * Legacy "do everything in one call" flow. Used by /api/cron/daily-grind for
 * manual force fires. Production cron uses runDailyGrindGenerate (nightly) +
 * runDailyGrindSend (hourly) on separate routes.
 */
export async function runDailyGrindCron(
  opts: { force?: boolean; skipCache?: boolean; topicHint?: string } = {},
): Promise<CronResult> {
  const force = opts.force ?? false;
  const skipCache = opts.skipCache ?? false;
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

  let rendered: { html: string; text: string; subject: string; preheader: string };
  let freshlyGeneratedContent: DailyGrindContent | null = null;
  const cached = skipCache ? null : await loadCachedIssue(db, issueDate);

  if (cached && cached.sections && typeof cached.sections === "object") {
    rendered = {
      html: cached.html,
      text: cached.text_body,
      subject: cached.subject,
      preheader: cached.preheader,
    };
  } else {
    const [recentHeadlines, recentVerses, recentConcepts] = await Promise.all([
      loadRecentHeadlines(db),
      loadRecentVerses(db),
      loadRecentConceptSummaries(db, 80),
    ]);
    const issue = await generateDailyGrindIssue(
      opts.topicHint
        ? {
            issueDate,
            recentTopics: recentHeadlines,
            recentVerses,
            recentConcepts,
            topicHint: opts.topicHint,
          }
        : {
            issueDate,
            recentTopics: recentHeadlines,
            recentVerses,
            recentConcepts,
          },
    );
    result.issueGenerated = true;
    const renderedOutput = renderDailyGrindHtml(issue.content, {
      issueDate,
      unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?test=true",
      webArchiveUrl: "https://castorabbott.com/newsletter/grind/",
    });
    rendered = renderedOutput;
    freshlyGeneratedContent = issue.content;
    if (!skipCache) {
      await persistIssue(db, issueDate, issue, renderedOutput);
    }
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

  // Brain extract runs AFTER sends so emails ship even if this step times out
  // or fails. Best-effort, non-fatal. Only for freshly-generated issues
  // (cached re-sends already had concepts extracted on their original run).
  if (freshlyGeneratedContent) {
    try {
      await extractAndPersistConcepts({
        db,
        content: freshlyGeneratedContent,
        issueDate,
      });
    } catch (err) {
      console.error("brain.extract_failed", err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}
