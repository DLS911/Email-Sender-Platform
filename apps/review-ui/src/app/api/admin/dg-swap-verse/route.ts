/**
 * POST /api/admin/dg-swap-verse
 *   { issueDate, verse, reference, application }
 *
 * Replaces the Ancient Truth block on a DG issue. Re-renders HTML/text
 * and snapshots the pre-swap row into generation_meta.previousVersions
 * so the old verse is recoverable. Built for one-off swaps when the
 * auto-selected verse reads grim/confrontational for the week.
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

  let body: { issueDate?: string; verse?: string; reference?: string; application?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const verse = body.verse?.trim();
  const reference = body.reference?.trim();
  const application = body.application?.trim();
  if (!issueDate || !verse || !reference || !application) {
    return NextResponse.json({ error: "issueDate + verse + reference + application all required" }, { status: 400 });
  }

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

  const oldVerse = sections.ancientTruth;
  const nextContent: DailyGrindContent = {
    ...sections,
    ancientTruth: { verse, reference, application },
  };

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
      generation_meta: mergedMeta,
    })
    .eq("issue_date", issueDate);
  if (upErr) return NextResponse.json({ error: `db update: ${upErr.message}` }, { status: 500 });

  logger.info("dg_swap_verse.success", { issueDate, oldRef: oldVerse?.reference, newRef: reference });
  return NextResponse.json({ ok: true, oldVerse, newVerse: { verse, reference, application } });
}
