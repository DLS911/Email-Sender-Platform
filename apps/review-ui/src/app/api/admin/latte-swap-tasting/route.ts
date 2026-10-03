/**
 * POST /api/admin/latte-swap-tasting
 *   { issueDate, index, newItem: { label, title, url?, body } }
 *
 * Surgically replaces one Tasting Menu item on a Latte issue. Re-renders
 * HTML/text/subject/preheader so all three stay in sync. Snapshots the
 * pre-swap row into generation_meta.previousVersions.
 *
 * Built for one-off fixes like "The Moviegoer was the 3rd Saturday in a
 * row — swap for a different book in the already-sent 10-03 row."
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import type { SaturdayLatteContent, TastingMenuItem } from "../../../../lib/saturday-latte-html-template";
import { renderSaturdayLatteHtml } from "../../../../lib/saturday-latte-html-template";
import { mergePreviousVersion } from "../../../../lib/issue-history";
import {
  extractHaikuBodyRecommendations,
  extractStructuredRecommendations,
  recordRecommendations,
} from "../../../../lib/saturday-latte-recommendations";

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
    index?: number;
    newItem?: Partial<TastingMenuItem>;
  };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const idx = Number(body.index ?? -1);
  const incoming = body.newItem ?? {};
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  if (!Number.isInteger(idx) || idx < 0 || idx > 2) {
    return NextResponse.json({ error: "index must be 0, 1, or 2" }, { status: 400 });
  }
  if (!incoming.label || !incoming.title || !incoming.body) {
    return NextResponse.json({ error: "newItem.label, newItem.title, newItem.body required" }, { status: 400 });
  }

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

  const current = (sections.tastingMenu ?? [])[idx];
  if (!current) return NextResponse.json({ error: `no tastingMenu[${idx}]` }, { status: 400 });

  const nextItem: TastingMenuItem = {
    ...current,
    label: incoming.label,
    title: incoming.title,
    body: incoming.body,
    ...(incoming.url ? { url: incoming.url } : (current.url ? {} : {})),
  };
  if (!incoming.url && current.url) delete (nextItem as { url?: string }).url;

  const nextTasting = sections.tastingMenu.map((item, i) => (i === idx ? nextItem : item));
  const nextSections: SaturdayLatteContent = { ...sections, tastingMenu: nextTasting };

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

  // Keep latte_recommendations in sync with the swap.
  try {
    const structured = extractStructuredRecommendations(nextSections, issueDate);
    const haikuRows = await extractHaikuBodyRecommendations(nextSections, issueDate);
    await recordRecommendations(db, [...structured, ...haikuRows]);
  } catch (err) {
    logger.warn("latte_swap_tasting.reextract_failed", {
      issueDate,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("latte_swap_tasting.success", {
    issueDate,
    index: idx,
    oldTitle: current.title,
    newTitle: incoming.title,
  });
  return NextResponse.json({
    ok: true,
    oldItem: current,
    newItem: nextItem,
  });
}
