/**
 * POST /api/admin/latte-reextract
 *   { issueDate?: "YYYY-MM-DD", backfillSince?: "YYYY-MM-DD" }
 *
 * Re-runs the Latte recommendation extractor on the CURRENT state of
 * saturday_latte_issues.sections — writing fresh rows into
 * latte_recommendations. Idempotent via the (brand, kind,
 * normalized_value) unique index: re-extracting the same book is a
 * no-op; new picks from regen'd issues get added.
 *
 * Backfill mode (`backfillSince`): re-extracts every Latte issue with
 * issue_date >= backfillSince. Used to repair memory after regen flows
 * swapped picks but the extractor never re-ran.
 *
 * This is what fixes "The Moviegoer appeared 3 Saturdays in a row" —
 * the regens swapped book picks but latte_recommendations stayed
 * frozen with the pre-regen records, so the writer kept seeing a
 * ban list that didn't include the actual last-shipped book.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import {
  extractHaikuBodyRecommendations,
  extractStructuredRecommendations,
  recordRecommendations,
} from "../../../../lib/saturday-latte-recommendations";
import type { SaturdayLatteContent } from "../../../../lib/saturday-latte-html-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const url = new URL(req.url);
  const q = url.searchParams.get("test");
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${cronSecret}` || q === cronSecret;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { issueDate?: string; backfillSince?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const singleDate = body.issueDate?.trim();
  const backfillSince = body.backfillSince?.trim();

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // Pick the issue dates to re-extract.
  let dates: string[];
  if (singleDate) {
    dates = [singleDate];
  } else if (backfillSince) {
    const { data, error } = await db
      .from("saturday_latte_issues")
      .select("issue_date")
      .gte("issue_date", backfillSince)
      .order("issue_date", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    dates = (data ?? []).map((r) => r.issue_date as string);
  } else {
    return NextResponse.json({ error: "issueDate or backfillSince required" }, { status: 400 });
  }

  const results: Array<{ issueDate: string; inserted: number; error?: string; structured: number; haiku: number }> = [];

  for (const issueDate of dates) {
    const { data, error } = await db
      .from("saturday_latte_issues")
      .select("sections")
      .eq("issue_date", issueDate)
      .maybeSingle();
    if (error || !data) {
      results.push({ issueDate, inserted: 0, error: error?.message ?? "not_found", structured: 0, haiku: 0 });
      continue;
    }
    const content = (data.sections ?? null) as SaturdayLatteContent | null;
    if (!content) {
      results.push({ issueDate, inserted: 0, error: "no_sections", structured: 0, haiku: 0 });
      continue;
    }

    const structured = extractStructuredRecommendations(content, issueDate);
    let haikuRows: typeof structured = [];
    try {
      haikuRows = await extractHaikuBodyRecommendations(content, issueDate);
    } catch (err) {
      logger.warn("latte_reextract.haiku_failed", {
        issueDate,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const combined = [...structured, ...haikuRows];
    const rec = await recordRecommendations(db, combined);
    results.push({
      issueDate,
      inserted: rec.inserted,
      ...(rec.error ? { error: rec.error } : {}),
      structured: structured.length,
      haiku: haikuRows.length,
    });
  }

  const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
  const totalErrors = results.filter((r) => r.error).length;
  logger.info("latte_reextract.complete", {
    dates: results.length,
    totalInserted,
    totalErrors,
  });
  return NextResponse.json({ ok: true, datesProcessed: results.length, totalInserted, totalErrors, results });
}
