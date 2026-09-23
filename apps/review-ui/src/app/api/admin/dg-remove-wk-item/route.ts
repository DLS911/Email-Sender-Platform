/**
 * POST /api/admin/dg-remove-wk-item
 *   { issueDate: "YYYY-MM-DD", matchSubstring: "Altruist" }
 *
 * Surgical block-removal for Daily Grind: filters out Worth Knowing
 * items whose headline contains matchSubstring, re-renders HTML/text
 * via the DG template, and writes back with overwrite protection
 * (snapshots the pre-removal row into generation_meta.previousVersions).
 *
 * Built for the 09-23 case where "Vanguard Acquires Altruist" landed
 * in WK for the fifth issue in a row; the reviewer caught none of it
 * because the recent-WK loader only fed the editor pass, not research.
 * This is the escape hatch until the writer-side avoid-list ships.
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

  let body: { issueDate?: string; matchSubstring?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const match = body.matchSubstring?.trim();
  if (!issueDate || !match) return NextResponse.json({ error: "issueDate + matchSubstring required" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data, error } = await db
    .from("daily_grind_issues")
    .select("issue_date, sections")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });

  const sections = data.sections as DailyGrindContent | null;
  if (!sections) return NextResponse.json({ error: "no sections" }, { status: 400 });

  const before = sections.worthKnowing ?? [];
  const filtered = before.filter((w) => !w.headline?.toLowerCase().includes(match.toLowerCase()));
  const removed = before.length - filtered.length;
  if (removed === 0) {
    return NextResponse.json({ ok: false, removed: 0, message: `no WK item matches "${match}"` });
  }
  const nextContent: DailyGrindContent = { ...sections, worthKnowing: filtered };

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
      html: rendered.html,
      text_body: rendered.text,
      subject: rendered.subject,
      preheader: rendered.preheader,
      generation_meta: mergedMeta,
    })
    .eq("issue_date", issueDate);
  if (upErr) return NextResponse.json({ error: `db update: ${upErr.message}` }, { status: 500 });

  logger.info("dg_remove_wk_item.success", { issueDate, match, removed, remaining: filtered.length });
  return NextResponse.json({
    ok: true,
    removed,
    remaining: filtered.length,
    remainingHeadlines: filtered.map((w) => w.headline),
  });
}
