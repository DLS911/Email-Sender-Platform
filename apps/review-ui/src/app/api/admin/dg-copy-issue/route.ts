/**
 * POST /api/admin/dg-copy-issue
 *   { sourceDate, targetDate, overwrite?: boolean }
 *
 * Copies the full `sections` JSON (incl. theMove / theNumber / howTo /
 * everything) from sourceDate's Daily Grind issue into targetDate's row.
 * Re-renders HTML for the target date and resets approval_status=pending.
 *
 * Built 2026-10-30 for the "relabel Monday to Friday" workflow — Mark
 * approved a Mon 11-02 campaign, then decided the content should ship
 * Fri 10-30 instead. Cancel the Monday campaign, copy content to Friday,
 * schedule Friday.
 *
 * Mirrors apps/review-ui/.../latte-copy-issue/route.ts.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import type { DailyGrindContent } from "../../../../lib/daily-grind-html-template";
import { renderDailyGrindHtml } from "../../../../lib/daily-grind-html-template";

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
    .from("daily_grind_issues")
    .select("sections, subject, headline, preheader")
    .eq("issue_date", sourceDate)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: `source: ${sErr.message}` }, { status: 500 });
  if (!srcRow) return NextResponse.json({ error: `no source issue for ${sourceDate}` }, { status: 404 });

  const { data: tgtRow, error: tErr } = await db
    .from("daily_grind_issues")
    .select("issue_date, headline, approval_status")
    .eq("issue_date", targetDate)
    .maybeSingle();
  if (tErr) return NextResponse.json({ error: `target: ${tErr.message}` }, { status: 500 });
  if (tgtRow && body.overwrite !== true) {
    return NextResponse.json({
      error: `target ${targetDate} already has an issue ("${tgtRow.headline}", status=${tgtRow.approval_status}). Pass overwrite:true to replace.`,
    }, { status: 409 });
  }

  const sections = srcRow.sections as DailyGrindContent | null;
  if (!sections) return NextResponse.json({ error: "source has no sections" }, { status: 400 });

  const rendered = renderDailyGrindHtml(sections, {
    issueDate: targetDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/grind/",
  });

  const payload = {
    issue_date: targetDate,
    sections,
    html: rendered.html,
    text_body: rendered.text,
    subject: rendered.subject,
    preheader: rendered.preheader,
    headline: sections.headline,
    generation_meta: {
      copiedFrom: { sourceDate, copiedAt: new Date().toISOString() },
    },
    approval_status: "pending",
  };

  if (tgtRow) {
    const { error: upErr } = await db.from("daily_grind_issues").update(payload).eq("issue_date", targetDate);
    if (upErr) return NextResponse.json({ error: `update: ${upErr.message}` }, { status: 500 });
  } else {
    const { error: inErr } = await db.from("daily_grind_issues").insert(payload);
    if (inErr) return NextResponse.json({ error: `insert: ${inErr.message}` }, { status: 500 });
  }

  logger.info("dg_copy_issue.success", { sourceDate, targetDate, headline: sections.headline });
  return NextResponse.json({ ok: true, sourceDate, targetDate, headline: sections.headline, overwrote: Boolean(tgtRow) });
}
