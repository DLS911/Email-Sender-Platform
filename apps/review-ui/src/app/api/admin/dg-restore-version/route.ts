/**
 * POST /api/admin/dg-restore-version
 *   { issueDate, versionIndex }
 *
 * Promotes generation_meta.previousVersions[versionIndex] back to the
 * current issue content. The current content is pushed to the END of
 * previousVersions (so no data is lost — this is a swap, not a wipe).
 * The DG HTML is re-rendered from the restored sections.
 *
 * Built to let a human say "ship the earlier version, not the one that
 * overwrote it." The overwrite-protection system saves prior content;
 * this endpoint is the human-triggered way to roll back to a snapshot.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import { renderDailyGrindHtml, type DailyGrindContent } from "../../../../lib/daily-grind-html-template";

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

  let body: { issueDate?: string; versionIndex?: number };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const versionIndex = Number(body.versionIndex ?? -1);
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  if (!Number.isInteger(versionIndex) || versionIndex < 0) {
    return NextResponse.json({ error: "versionIndex must be a non-negative integer" }, { status: 400 });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data, error } = await db
    .from("daily_grind_issues")
    .select("issue_date, subject, headline, preheader, html, text_body, sections, approval_status, generation_meta")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });

  const meta = (data.generation_meta ?? {}) as Record<string, unknown>;
  const prevList = Array.isArray(meta.previousVersions)
    ? (meta.previousVersions as Array<Record<string, unknown>>)
    : [];
  if (versionIndex >= prevList.length) {
    return NextResponse.json(
      { error: `versionIndex ${versionIndex} out of range (${prevList.length} previous versions)` },
      { status: 400 },
    );
  }

  const target = prevList[versionIndex]!;
  const restoredSections = target.sections as DailyGrindContent | null;
  if (!restoredSections) return NextResponse.json({ error: "target version has no sections" }, { status: 400 });

  // Push the CURRENT row into previousVersions as a snapshot of what we're
  // overwriting with the restore. Mirrors mergePreviousVersion but keeps
  // the target version in-place rather than appending it (we're swapping,
  // not stacking).
  const currentArchive = {
    savedAt: new Date().toISOString(),
    subject: data.subject,
    headline: data.headline,
    preheader: data.preheader,
    html: data.html,
    textBody: data.text_body,
    sections: data.sections,
    approvalStatus: data.approval_status,
    generationMeta: Object.fromEntries(Object.entries(meta).filter(([k]) => k !== "previousVersions")),
    restoredFromVersionIndex: versionIndex,
  };
  // Keep the restored target in prevList (not removed — in case we want to
  // bounce back later). Add the current content archive to the END.
  const newPrevList = [...prevList, currentArchive].slice(-25);

  // Re-render HTML from restored sections (don't trust the stored HTML —
  // template may have changed since snapshot).
  const rendered = renderDailyGrindHtml(restoredSections, {
    issueDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/grind/",
  });

  const restoredMeta: Record<string, unknown> = {
    ...((target.generationMeta ?? {}) as Record<string, unknown>),
    previousVersions: newPrevList,
    restoredAt: new Date().toISOString(),
    restoredFromVersionIndex: versionIndex,
  };

  const { error: upErr } = await db
    .from("daily_grind_issues")
    .update({
      subject: rendered.subject,
      headline: restoredSections.headline,
      preheader: rendered.preheader,
      html: rendered.html,
      text_body: rendered.text,
      sections: restoredSections,
      generation_meta: restoredMeta,
    })
    .eq("issue_date", issueDate);
  if (upErr) return NextResponse.json({ error: `db update: ${upErr.message}` }, { status: 500 });

  logger.info("dg_restore_version.success", {
    issueDate,
    versionIndex,
    restoredHeadline: restoredSections.headline,
    priorCurrentHeadline: data.headline,
  });
  return NextResponse.json({
    ok: true,
    restored: {
      headline: restoredSections.headline,
      subject: rendered.subject,
      savedAt: target.savedAt,
    },
    previousCurrent: {
      headline: data.headline,
      subject: data.subject,
    },
  });
}
