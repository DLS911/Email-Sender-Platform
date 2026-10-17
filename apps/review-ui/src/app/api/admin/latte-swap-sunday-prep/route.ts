/**
 * POST /api/admin/latte-swap-sunday-prep
 *   { issueDate, title, body }
 *
 * Swaps the Sunday Prep section's title + body on a Latte issue.
 * Re-renders html/text/subject/preheader. Snapshots the pre-swap row
 * into generation_meta.previousVersions.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import type { SaturdayLatteContent } from "../../../../lib/saturday-latte-html-template";
import { renderSaturdayLatteHtml } from "../../../../lib/saturday-latte-html-template";
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

  let body: { issueDate?: string; title?: string; body?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const title = body.title?.trim();
  const bodyText = body.body?.trim();
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  if (!title || !bodyText) return NextResponse.json({ error: "title + body required" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data, error } = await db
    .from("saturday_latte_issues")
    .select("sections")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });

  const sections = data.sections as SaturdayLatteContent | null;
  if (!sections) return NextResponse.json({ error: "no sections" }, { status: 400 });

  const prev = sections.sundayPrep ?? { title: "", body: "" };
  const nextSections: SaturdayLatteContent = {
    ...sections,
    sundayPrep: { title, body: bodyText },
  };

  const rendered = renderSaturdayLatteHtml(nextSections, {
    issueDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/latte/",
  });
  const mergedMeta = await mergePreviousVersion(db, "saturday_latte_issues", issueDate, null);

  const { error: upErr } = await db
    .from("saturday_latte_issues")
    .update({
      sections: nextSections,
      html: rendered.html,
      text_body: rendered.text,
      subject: rendered.subject,
      preheader: rendered.preheader,
      generation_meta: mergedMeta,
    })
    .eq("issue_date", issueDate);
  if (upErr) return NextResponse.json({ error: `db update: ${upErr.message}` }, { status: 500 });

  logger.info("latte_swap_sunday_prep.success", { issueDate, oldTitle: prev.title, newTitle: title });
  return NextResponse.json({ ok: true, prev, next: { title, body: bodyText } });
}
