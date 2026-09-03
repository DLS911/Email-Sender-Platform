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
import { logger } from "@platform/observability";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { sendPreviewEmail } from "./preview-email";
import { sendEditorEscalation } from "./editor-escalation";
import {
  extractHaikuBodyRecommendations,
  extractStructuredRecommendations,
  loadAllRecommendations,
  recordRecommendations,
} from "./saturday-latte-recommendations";
import { loadActiveCurated, markCuratedUsed, type CuratedItem, type CuratedKind } from "./latte-curated";
export type { CuratedItem, CuratedKind };
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
  approval_status?: "pending" | "approved" | "needs_work";
  approval_notified_at?: string | null;
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
      "issue_date, subject, cover_story_headline, preheader, sections, html, text_body, model, approval_status, approval_notified_at",
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
      "issue_date, subject, cover_story_headline, preheader, sections, html, text_body, model, approval_status, approval_notified_at",
    )
    .lte("issue_date", maxDate)
    .order("issue_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as CachedLatteIssue | null;
}

// Recent-picks memory = every issue ever generated, regardless of
// approval status. If the writer picked something and it landed in
// the DB, we remember it — otherwise a pending or needs_work draft
// (which contains real picks the writer made) would get re-picked on
// the next generate. Lookback is deep (200 issues ~= 4 years) so the
// system remembers permanently.
export async function loadRecentCoverStories(db: SupabaseClient, limit = 12): Promise<string[]> {
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

// ─── Memory extractors (best-effort text parsers) ───────────────────────

const CREATOR_SUFFIX_STOP = new Set([
  "the", "a", "an", "of", "for", "in", "on", "at", "with", "and",
  "her", "his", "their", "our", "your", "book", "novel", "album",
  "film", "series", "vol", "volume",
]);

/**
 * Extract an author/director/artist name from a tasting title. Matches
 * "Title by Name" and stops at natural boundaries. Returns null when no
 * "by X" pattern is present. Best-effort; the memory is a floor.
 */
function extractCreatorFromTitle(title: string): string | null {
  const trimmed = title.trim();
  const byIdx = trimmed.search(/\s+by\s+/i);
  if (byIdx === -1) return null;
  const tail = trimmed.slice(byIdx).replace(/^\s+by\s+/i, "").trim();
  if (!tail) return null;
  const capped = tail.split(/[.,;:(]|[-—]\s/)[0]?.trim();
  if (!capped) return null;
  const words = capped.split(/\s+/).slice(0, 4);
  const finalWords: string[] = [];
  for (const w of words) {
    const lower = w.toLowerCase().replace(/[^a-z]/g, "");
    if (CREATOR_SUFFIX_STOP.has(lower) && finalWords.length > 0) break;
    finalWords.push(w);
  }
  const result = finalWords.join(" ").replace(/[\s.,;:]+$/, "");
  return result.length >= 3 ? result : null;
}

/**
 * Same "X by Y" scan but over a longer prose body. Only fires once per
 * body — grabs the FIRST creator mention, which is almost always the
 * primary attribution.
 */
function extractCreatorFromBody(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length < 20) return null;
  const m = trimmed.match(/\bby\s+([A-Z][a-zA-Z'’\-.]+(?:\s+[A-Z][a-zA-Z'’\-.]+){0,3})/);
  if (!m || !m[1]) return null;
  return m[1].trim();
}

/**
 * Pull specific spot names (restaurants, cafes, shops, hotels) from a
 * Cover Story body. Matches proper-noun phrases immediately preceded by
 * a strong leader word or wrapped in quotation marks. Best-effort — a
 * noisy signal is fine because dupe detection normalizes and compares.
 */
function extractSpotsFromCoverStory(body: string): string[] {
  const spots = new Set<string>();
  const leaderRe =
    /(?:eat at|drink at|coffee at|stop at|visit|dinner at|breakfast at|stay at|book|order|try|hit)\s+((?:[A-Z][a-zA-Z'’&.\-]+(?:\s+[A-Z][a-zA-Z'’&.\-]+){0,4}))/g;
  let m: RegExpExecArray | null;
  while ((m = leaderRe.exec(body)) !== null) {
    const raw = m[1]?.trim();
    if (raw && raw.length >= 3) spots.add(raw);
  }
  const quotedRe = /["“]([A-Z][^"”]{2,60})["”]/g;
  while ((m = quotedRe.exec(body)) !== null) {
    const raw = m[1]?.trim();
    if (raw && /^[A-Z]/.test(raw) && raw.length <= 60) spots.add(raw);
  }
  return Array.from(spots);
}

export type RecentLatteContext = {
  coverStoryHeadlines: string[];
  cars: string[];
  tastingMenuTitles: string[];
  /**
   * Authors/directors/artists parsed from tasting titles via the "X by Y"
   * pattern. Prevents the same author showing up twice with different
   * titles (two Samantha Harvey novels, two Denis Villeneuve films, two
   * Charley Crockett albums).
   */
  tastingCreators: string[];
  cookingMoves: string[];
  sundayResetAuthors: string[];
  sabbathReferences: string[];
  coverStorySpots: string[];
  /**
   * Full recall from latte_recommendations, grouped by kind. Populated
   * by loadRecentLatteContext when the table has rows. Every specific
   * dish, restaurant, brand, and person ever recommended shows up here
   * so the writer sees the complete history.
   */
  allRecommendations?: Record<string, string[]>;
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
      tastingCreators: [],
      cookingMoves: [],
      sundayResetAuthors: [],
      sabbathReferences: [],
      coverStorySpots: [],
    };
  }
  const ctx: RecentLatteContext = {
    coverStoryHeadlines: [],
    cars: [],
    tastingMenuTitles: [],
    tastingCreators: [],
    cookingMoves: [],
    sundayResetAuthors: [],
    sabbathReferences: [],
    coverStorySpots: [],
  };
  const rows = (data ?? []) as Array<{ cover_story_headline: string; sections: unknown }>;
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx += 1) {
    const row = rows[rowIdx];
    if (!row) continue;
    if (row.cover_story_headline) ctx.coverStoryHeadlines.push(row.cover_story_headline);
    const s = row.sections;
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const sections = s as Record<string, unknown>;
    const cs = sections.coverStory;
    if (cs && typeof cs === "object" && !Array.isArray(cs)) {
      const body = (cs as Record<string, unknown>).body;
      if (typeof body === "string") {
        for (const spot of extractSpotsFromCoverStory(body)) ctx.coverStorySpots.push(spot);
      }
    }
    const drive = sections.theDrive;
    if (drive && typeof drive === "object" && !Array.isArray(drive)) {
      const car = (drive as Record<string, unknown>).car;
      if (typeof car === "string" && car.trim() !== "") ctx.cars.push(car.trim());
    }
    const tm = sections.tastingMenu;
    if (Array.isArray(tm)) {
      for (const item of tm) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const rec = item as Record<string, unknown>;
          const title = rec.title;
          if (typeof title === "string" && title.trim() !== "") {
            ctx.tastingMenuTitles.push(title.trim());
            // Creator spacing rule: same author/director/artist is fine
            // across weeks but NOT consecutive weeks. Only pull creators
            // from the most-recent issue (rowIdx === 0) so the writer
            // ban list represents "you did X last week; try someone
            // else this week." Older creators are fair game again.
            if (rowIdx === 0) {
              const creator = extractCreatorFromTitle(title);
              if (creator) ctx.tastingCreators.push(creator);
            }
          }
          if (rowIdx === 0) {
            const body = rec.body;
            if (typeof body === "string") {
              const bodyCreator = extractCreatorFromBody(body);
              if (bodyCreator) ctx.tastingCreators.push(bodyCreator);
            }
          }
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
  // Load the permanent-recall recommendations table for the fine-grained
  // memory (specific dishes, restaurants, brands, people ever mentioned).
  // Best-effort; if the table isn't populated yet or the query fails,
  // we still return the section-level context.
  try {
    const allRecs = await loadAllRecommendations(db, "saturday_latte");
    if (Object.keys(allRecs).length > 0) ctx.allRecommendations = allRecs;
  } catch (err) {
    console.warn(
      "latte.load_all_recommendations_failed",
      err instanceof Error ? err.message : String(err),
    );
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
      sections: {
        ...issue.content,
        ...(issue.meta.imageReferences ? { imageReferences: issue.meta.imageReferences } : {}),
      },
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
        authorScopeViolationsFound: issue.meta.authorScopeViolationsFound,
        authorScopeViolationsApplied: issue.meta.authorScopeViolationsApplied,
        driveReferenceUrl: issue.meta.driveReferenceUrl ?? null,
        driveUsedReference: issue.meta.driveUsedReference ?? false,
        imageValidatorVerdicts: issue.meta.imageValidatorVerdicts ?? [],
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
  issueDate: string,
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
    // Tags flow back on every webhook event so the engagement dashboard
    // can bucket opens/clicks by brand + issue_date without a lookup.
    // Resend tag values must be [A-Za-z0-9_-] so we slug the issue_date
    // (which is already ISO-format, safe).
    tags: [
      { name: "brand", value: "saturday_latte" },
      { name: "issue_date", value: issueDate },
    ],
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

    // Permanent memory: pull the last 200 APPROVED issues (~4 years of
    // Saturdays). The writer sees the full history of what's already been
    // recommended and MUST NOT pick anything on that list.
    // Curated: Austin's manual pre-selections take PRIORITY over
    // shelf/research picks (per-kind: cars, drinks, books, products).
    // Wrapped in try/catch so a curated-loader failure never aborts the
    // whole generate flow (empty curated is a valid state and simply
    // means the writer picks normally).
    const [recentCoverStories, recentContext, curated] = await Promise.all([
      loadRecentCoverStories(db, 200),
      loadRecentLatteContext(db, 200),
      (async () => {
        try {
          return await loadActiveCurated(db);
        } catch (err) {
          logger.warn("cron.saturday_latte_generate.curated_load_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          return { car: [], drink: [], book: [], product: [] };
        }
      })(),
    ]);
    const start = Date.now();
    const issue = await generateSaturdayLatteIssue({
      issueDate: targetDate,
      recentCoverStories,
      recentContext,
      curated,
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

    // Recommendations recorder. Structured extraction always fires;
    // Haiku body pass runs in parallel best-effort so specific dishes
    // and inline mentions land in latte_recommendations. Idempotent
    // via the (brand,kind,normalized_value) unique index.
    try {
      const structured = extractStructuredRecommendations(issue.content, targetDate);
      const haikuRows = await extractHaikuBodyRecommendations(issue.content, targetDate);
      const combined = [...structured, ...haikuRows];
      const rec = await recordRecommendations(db, combined);
      if (rec.error) {
        logger.warn("cron.saturday_latte_generate.recs_write_failed", { error: rec.error });
      } else {
        logger.info("cron.saturday_latte_generate.recs_recorded", {
          structured: structured.length,
          haiku: haikuRows.length,
          inserted: rec.inserted,
        });
      }
    } catch (err) {
      logger.warn("cron.saturday_latte_generate.recs_threw", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Curated-used marker. Walk the actually-published picks and flip
    // any matching curated rows from active → used with the issue date
    // stamped. Idempotent (only affects rows still in "active").
    try {
      const usedList: Array<{ kind: CuratedKind; title: string }> = [];
      if (issue.content.theDrive?.car) usedList.push({ kind: "car", title: issue.content.theDrive.car });
      for (const t of issue.content.tastingMenu ?? []) {
        const label = (t.label ?? "").toLowerCase();
        if (!t.title) continue;
        if (label.includes("drinking")) usedList.push({ kind: "drink", title: t.title });
        else if (label.includes("reading")) usedList.push({ kind: "book", title: t.title });
        else if (label.includes("trying") || label.includes("listening")) usedList.push({ kind: "product", title: t.title });
      }
      const markRes = await markCuratedUsed(db, targetDate, usedList);
      if (markRes.marked > 0) {
        logger.info("cron.saturday_latte_generate.curated_marked_used", { marked: markRes.marked, issue_date: targetDate });
      }
    } catch (err) {
      logger.warn("cron.saturday_latte_generate.curated_mark_threw", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Fire preview email to Mark for approval. Best-effort — if this
    // fails, log and continue; the send cron will refuse to ship a
    // pending issue regardless, so a missing preview blocks the send
    // rather than allowing an unreviewed issue through.
    try {
      const baseUrl = process.env.PUBLIC_BASE_URL || "https://email-sndr-platform.vercel.app";
      const preview = await sendPreviewEmail({
        brand: "latte",
        issueDate: targetDate,
        subject: rendered.subject,
        issueHtml: rendered.html,
        issueText: rendered.text,
        baseUrl,
      });
      if (!preview.ok) {
        logger.warn("cron.saturday_latte_generate.preview_failed", { error: preview.error });
      } else {
        logger.info("cron.saturday_latte_generate.preview_sent", { resendId: preview.resendId });
      }
    } catch (err) {
      logger.warn("cron.saturday_latte_generate.preview_threw", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

// ─── Public: send ──────────────────────────────────────────────────────────

export async function runLatteSend(
  opts: { force?: boolean; overrideIssueDate?: string } = {},
): Promise<LatteSendResult> {
  const force = opts.force ?? false;
  const overrideIssueDate = opts.overrideIssueDate;
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

  // Approval gate: per-issue-date, we check approval_status once and cache
  // the verdict for this cron run. On the first non-approved issue we
  // encounter, escalate to the editor once (guarded by approval_notified_at
  // so a subsequent cron run doesn't spam). All due subscribers whose local
  // date maps to an unapproved issue are recorded as skipped.
  const approvalCache: Map<string, "approved" | "blocked"> = new Map();

  for (const row of due) {
    if (await isSuppressed(db, row.subscriber.email)) {
      result.skipped.push({ email: row.subscriber.email, reason: "suppressed" });
      continue;
    }
    try {
      // overrideIssueDate (test-only) lets a manual send preview a specific
      // Latte issue instead of today's local Saturday. Matches the DG cron.
      const lookupDate = overrideIssueDate ?? row.localDate;

      const cached = approvalCache.get(lookupDate);
      if (cached === "blocked") {
        result.skipped.push({ email: row.subscriber.email, reason: `issue ${lookupDate} not approved` });
        continue;
      }
      if (cached === undefined && !force) {
        const gate = await loadCachedIssue(db, lookupDate);
        if (gate && gate.approval_status && gate.approval_status !== "approved") {
          approvalCache.set(lookupDate, "blocked");
          if (!gate.approval_notified_at) {
            const baseUrl = process.env.PUBLIC_BASE_URL || "https://email-sndr-platform.vercel.app";
            await sendEditorEscalation({
              kind: "send_blocked",
              brand: "latte",
              issueDate: lookupDate,
              subject: gate.subject,
              currentStatus: gate.approval_status,
              baseUrl,
            });
            await db
              .from("saturday_latte_issues")
              .update({ approval_notified_at: new Date().toISOString() })
              .eq("issue_date", lookupDate);
          }
          logger.warn("cron.saturday_latte.send_blocked", {
            issue_date: lookupDate,
            approval_status: gate.approval_status,
          });
          result.skipped.push({ email: row.subscriber.email, reason: `issue ${lookupDate} not approved (${gate.approval_status})` });
          continue;
        }
        if (gate) approvalCache.set(lookupDate, "approved");
      }

      const fresh = await loadCachedIssue(db, lookupDate);
      let rendered: { html: string; text: string; subject: string };
      let usedFallback = false;
      let actualIssueDate = lookupDate;

      if (fresh && fresh.sections && typeof fresh.sections === "object") {
        rendered = { html: fresh.html, text: fresh.text_body, subject: fresh.subject };
      } else {
        const recent = await loadMostRecentCachedIssue(db, lookupDate);
        if (!recent || !recent.html) {
          result.errors.push({
            email: row.subscriber.email,
            error: `no cached issue for ${lookupDate} and no fallback available`,
          });
          continue;
        }
        usedFallback = true;
        actualIssueDate = recent.issue_date;
        rendered = {
          html: injectFallbackNote(recent.html, lookupDate, recent.issue_date),
          text: recent.text_body,
          subject: recent.subject,
        };
      }

      const resendId = await sendOne(resend, row.subscriber, rendered, actualIssueDate);
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
