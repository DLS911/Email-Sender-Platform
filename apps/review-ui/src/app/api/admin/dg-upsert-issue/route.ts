/**
 * POST /api/admin/dg-upsert-issue
 *   { issueDate, sections, contentType, overwrite?: boolean }
 *
 * Install a full DailyGrindContent sections JSON at the given issue_date.
 * Bypasses the writer / proposer / all validation gates. Built 2026-11-02
 * after I deleted the Woodbridge chronicle before any snapshot — Mark
 * had to paste the full email back and I need a way to install it
 * directly. Re-renders html/text/subject/preheader from sections.
 *
 * overwrite required if a row already exists.
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
  let body: {
    issueDate?: string;
    sections?: DailyGrindContent;
    overwrite?: boolean;
    installedFrom?: string;
  };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const sections = body.sections;
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  if (!sections || typeof sections !== "object") return NextResponse.json({ error: "sections (DailyGrindContent) required" }, { status: 400 });
  if (!sections.headline) return NextResponse.json({ error: "sections.headline required" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data: existing, error: readErr } = await db
    .from("daily_grind_issues")
    .select("issue_date, headline, approval_status")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (existing && body.overwrite !== true) {
    return NextResponse.json({
      error: `target ${issueDate} already has issue "${existing.headline}" (status=${existing.approval_status}). Pass overwrite:true to replace.`,
      current: existing,
    }, { status: 409 });
  }

  const rendered = renderDailyGrindHtml(sections, {
    issueDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/grind/",
  });

  const payload = {
    issue_date: issueDate,
    sections,
    html: rendered.html,
    text_body: rendered.text,
    subject: rendered.subject,
    preheader: rendered.preheader,
    headline: sections.headline,
    generation_meta: {
      installedFrom: body.installedFrom ?? "dg-upsert-issue",
      installedAt: new Date().toISOString(),
    },
    approval_status: "pending",
  };

  if (existing) {
    const { error: upErr } = await db.from("daily_grind_issues").update(payload).eq("issue_date", issueDate);
    if (upErr) return NextResponse.json({ error: `update: ${upErr.message}` }, { status: 500 });
  } else {
    const { error: inErr } = await db.from("daily_grind_issues").insert(payload);
    if (inErr) return NextResponse.json({ error: `insert: ${inErr.message}` }, { status: 500 });
  }

  logger.info("dg_upsert_issue.success", { issueDate, headline: sections.headline, overwrote: Boolean(existing) });
  return NextResponse.json({ ok: true, issueDate, headline: sections.headline, subject: rendered.subject, overwrote: Boolean(existing) });
}
