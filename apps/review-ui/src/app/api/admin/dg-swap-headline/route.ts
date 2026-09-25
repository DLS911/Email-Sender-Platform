/**
 * POST /api/admin/dg-swap-headline
 *   { issueDate: "YYYY-MM-DD", newHeadline: "..." }
 *
 * Replaces the H1/subject/preheader-linked headline on a Daily Grind
 * issue without touching the body. Re-renders the HTML/text via the
 * DG template. Snapshots the pre-swap row into
 * generation_meta.previousVersions so the old title is recoverable.
 *
 * Built for the case where the writer produces a good take with a bad
 * subject line — we don't want to regenerate the whole issue just to
 * change 8 words.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import { renderDailyGrindHtml, type DailyGrindContent } from "../../../../lib/daily-grind-html-template";
import { mergePreviousVersion } from "../../../../lib/issue-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  let body: { issueDate?: string; newHeadline?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const newHeadline = body.newHeadline?.trim();
  if (!issueDate || !newHeadline) return NextResponse.json({ error: "issueDate + newHeadline required" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data, error } = await db
    .from("daily_grind_issues")
    .select("issue_date, sections, preheader")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });

  const sections = data.sections as DailyGrindContent | null;
  if (!sections) return NextResponse.json({ error: "no sections" }, { status: 400 });

  const oldHeadline = sections.headline;
  const nextContent: DailyGrindContent = { ...sections, headline: newHeadline };

  const rendered = renderDailyGrindHtml(nextContent, {
    issueDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/grind/",
  });

  const mergedMeta = await mergePreviousVersion(db, "daily_grind_issues", issueDate, null);

  const { error: upErr } = await db
    .from("daily_grind_issues")
    .update({
      sections: nextContent,
      headline: newHeadline,
      subject: rendered.subject,
      html: rendered.html,
      text_body: rendered.text,
      preheader: rendered.preheader,
      generation_meta: mergedMeta,
    })
    .eq("issue_date", issueDate);
  if (upErr) return NextResponse.json({ error: `db update: ${upErr.message}` }, { status: 500 });

  logger.info("dg_swap_headline.success", { issueDate, oldHeadline, newHeadline });
  return NextResponse.json({ ok: true, oldHeadline, newHeadline, subject: rendered.subject });
}
