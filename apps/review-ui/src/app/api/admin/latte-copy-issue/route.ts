/**
 * POST /api/admin/latte-copy-issue
 *   { sourceDate, targetDate, overwrite?: boolean }
 *
 * Copies ALL sections (incl images) from sourceDate's Latte issue
 * into targetDate's row. Re-renders. Used when image generation is
 * blocked for the target date and we want to ship a prior fully
 * imaged issue instead.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import type { SaturdayLatteContent } from "../../../../lib/saturday-latte-html-template";
import { renderSaturdayLatteHtml } from "../../../../lib/saturday-latte-html-template";

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
  let body: { sourceDate?: string; targetDate?: string; overwrite?: boolean };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const sourceDate = body.sourceDate?.trim();
  const targetDate = body.targetDate?.trim();
  if (!sourceDate || !targetDate) return NextResponse.json({ error: "sourceDate + targetDate required" }, { status: 400 });
  if (sourceDate === targetDate) return NextResponse.json({ error: "sourceDate and targetDate must differ" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data: srcRow, error: sErr } = await db
    .from("saturday_latte_issues")
    .select("sections, subject, cover_story_headline, preheader")
    .eq("issue_date", sourceDate)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: `source: ${sErr.message}` }, { status: 500 });
  if (!srcRow) return NextResponse.json({ error: `no source issue for ${sourceDate}` }, { status: 404 });

  const { data: tgtRow, error: tErr } = await db
    .from("saturday_latte_issues")
    .select("issue_date, cover_story_headline")
    .eq("issue_date", targetDate)
    .maybeSingle();
  if (tErr) return NextResponse.json({ error: `target: ${tErr.message}` }, { status: 500 });
  if (tgtRow && body.overwrite !== true) {
    return NextResponse.json({
      error: `target ${targetDate} already has an issue ("${tgtRow.cover_story_headline}"). Pass overwrite:true to replace.`,
    }, { status: 409 });
  }

  const sections = srcRow.sections as SaturdayLatteContent | null;
  if (!sections) return NextResponse.json({ error: "source has no sections" }, { status: 400 });

  const rendered = renderSaturdayLatteHtml(sections, {
    issueDate: targetDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/latte/",
  });

  const payload = {
    issue_date: targetDate,
    sections,
    html: rendered.html,
    text_body: rendered.text,
    subject: rendered.subject,
    preheader: rendered.preheader,
    cover_story_headline: srcRow.cover_story_headline,
    generation_meta: {
      copiedFrom: { sourceDate, copiedAt: new Date().toISOString() },
    },
    approval_status: "pending",
  };

  if (tgtRow) {
    const { error: upErr } = await db.from("saturday_latte_issues").update(payload).eq("issue_date", targetDate);
    if (upErr) return NextResponse.json({ error: `update: ${upErr.message}` }, { status: 500 });
  } else {
    const { error: inErr } = await db.from("saturday_latte_issues").insert(payload);
    if (inErr) return NextResponse.json({ error: `insert: ${inErr.message}` }, { status: 500 });
  }

  logger.info("latte_copy_issue.success", { sourceDate, targetDate, headline: srcRow.cover_story_headline });
  return NextResponse.json({ ok: true, sourceDate, targetDate, headline: srcRow.cover_story_headline, overwrote: Boolean(tgtRow) });
}
