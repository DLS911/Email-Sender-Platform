/**
 * POST /api/admin/latte-patch-cover
 *   {
 *     issueDate,
 *     headline?: string,                       // sections.coverStoryHeadline + cover_story_headline column
 *     preheader?: string,                      // sections.preheader
 *     paragraphs?: { [index: string]: string } // sections.coverStoryParagraphs[index] = text
 *   }
 *
 * Surgical edit of the Latte cover story. Re-renders html/text/subject/
 * preheader with the v1 renderer and snapshots the prior row into
 * generation_meta.previousVersions, same as latte-swap-tasting.
 *
 * Built 2026-11-21: the writer dated the cover to the SEND month
 * ("Madeira in November" sent Nov 21). Mark: the cover is a trip the
 * reader can still book, so it should name a month 2-3 months out. There
 * was no route that could touch headline / preheader / a single paragraph.
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
  let body: { issueDate?: string; headline?: string; preheader?: string; paragraphs?: Record<string, string> };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  const headline = typeof body.headline === "string" && body.headline.trim() ? body.headline.trim() : null;
  const preheader = typeof body.preheader === "string" && body.preheader.trim() ? body.preheader.trim() : null;
  const paragraphs = body.paragraphs && typeof body.paragraphs === "object" ? body.paragraphs : {};
  if (!headline && !preheader && Object.keys(paragraphs).length === 0) {
    return NextResponse.json({ error: "nothing to patch: pass headline, preheader, and/or paragraphs" }, { status: 400 });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data, error } = await db.from("saturday_latte_issues").select("sections").eq("issue_date", issueDate).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });
  const sections = data.sections as SaturdayLatteContent | null;
  if (!sections || !Array.isArray(sections.coverStoryParagraphs)) {
    return NextResponse.json({ error: "row is not a v1 Latte (no coverStoryParagraphs)" }, { status: 400 });
  }

  const next: SaturdayLatteContent = structuredClone(sections);
  const changed: string[] = [];
  if (headline) { next.coverStoryHeadline = headline; changed.push("headline"); }
  if (preheader) { next.preheader = preheader; changed.push("preheader"); }
  for (const [k, v] of Object.entries(paragraphs)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= next.coverStoryParagraphs.length) {
      return NextResponse.json({ error: `paragraph index ${k} out of range (0..${next.coverStoryParagraphs.length - 1})` }, { status: 400 });
    }
    if (typeof v !== "string" || !v.trim()) return NextResponse.json({ error: `paragraph ${k} text required` }, { status: 400 });
    next.coverStoryParagraphs[i] = v.trim();
    changed.push(`paragraph.${i}`);
  }

  const rendered = renderSaturdayLatteHtml(next, {
    issueDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/latte/",
  });
  const mergedMeta = await mergePreviousVersion(db, "saturday_latte_issues", issueDate, null);

  const { error: upErr } = await db
    .from("saturday_latte_issues")
    .update({
      sections: next,
      cover_story_headline: next.coverStoryHeadline,
      html: rendered.html,
      text_body: rendered.text,
      subject: rendered.subject,
      preheader: rendered.preheader,
      generation_meta: mergedMeta,
    })
    .eq("issue_date", issueDate);
  if (upErr) return NextResponse.json({ error: `db update: ${upErr.message}` }, { status: 500 });

  logger.info("latte_patch_cover.success", { issueDate, changed });
  return NextResponse.json({ ok: true, changed, headline: next.coverStoryHeadline, preheader: next.preheader, subject: rendered.subject });
}
