/**
 * POST /api/admin/dg-copy-version-to-date
 *   {
 *     sourceDate: "YYYY-MM-DD",
 *     sourceVersionIndex: 0,     // 0-based index into previousVersions
 *     targetDate: "YYYY-MM-DD",
 *     overwrite?: false          // if targetDate already has an issue, refuse unless true
 *   }
 *
 * Takes a snapshot from sourceDate's generation_meta.previousVersions[idx]
 * and installs it as the targetDate issue — copies sections, re-renders
 * html/subject/preheader, inserts (or overwrites) the targetDate row.
 *
 * Built for the Fri 10-16 incident: a late-arriving regen stomped the
 * approved "CFO hire" content with "She said no to the conversion" and
 * that's what shipped. The CFO version was preserved in previousVersions.
 * This endpoint lets us retroactively ship it on a different date.
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

  let body: {
    sourceDate?: string;
    sourceVersionIndex?: number;
    targetDate?: string;
    overwrite?: boolean;
  };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const sourceDate = body.sourceDate?.trim();
  const targetDate = body.targetDate?.trim();
  const idx = Number(body.sourceVersionIndex ?? -1);
  if (!sourceDate || !targetDate) return NextResponse.json({ error: "sourceDate + targetDate required" }, { status: 400 });
  if (!Number.isInteger(idx) || idx < 0) return NextResponse.json({ error: "sourceVersionIndex must be a non-negative integer" }, { status: 400 });
  if (sourceDate === targetDate) return NextResponse.json({ error: "sourceDate and targetDate must differ (use dg-restore-version instead)" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // 1. Load source row's previousVersions and pick the target snapshot.
  const { data: sourceRow, error: sErr } = await db
    .from("daily_grind_issues")
    .select("generation_meta")
    .eq("issue_date", sourceDate)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: `load source: ${sErr.message}` }, { status: 500 });
  if (!sourceRow) return NextResponse.json({ error: `no source issue for ${sourceDate}` }, { status: 404 });
  const prevList = ((sourceRow.generation_meta as { previousVersions?: unknown[] } | null)?.previousVersions ?? []) as Array<Record<string, unknown>>;
  const snap = prevList[idx];
  if (!snap) return NextResponse.json({ error: `no previousVersions[${idx}] on ${sourceDate} (${prevList.length} total)` }, { status: 404 });
  const sections = snap.sections as DailyGrindContent | null;
  if (!sections) return NextResponse.json({ error: "snapshot has no sections" }, { status: 400 });

  // 2. Check if target date already has an issue.
  const { data: targetExisting, error: tErr } = await db
    .from("daily_grind_issues")
    .select("issue_date, headline")
    .eq("issue_date", targetDate)
    .maybeSingle();
  if (tErr) return NextResponse.json({ error: `check target: ${tErr.message}` }, { status: 500 });
  if (targetExisting && body.overwrite !== true) {
    return NextResponse.json({
      error: `target ${targetDate} already has an issue ("${targetExisting.headline}"). Pass overwrite:true to replace.`,
      existingHeadline: targetExisting.headline,
    }, { status: 409 });
  }

  // 3. Re-render HTML from the copied sections, dated to targetDate.
  const rendered = renderDailyGrindHtml(sections, {
    issueDate: targetDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/grind/",
  });

  // 4. Upsert the target row.
  const payload = {
    issue_date: targetDate,
    subject: rendered.subject,
    headline: sections.headline,
    preheader: rendered.preheader,
    html: rendered.html,
    text_body: rendered.text,
    sections,
    model: "claude-sonnet-4-5-20250929",
    generation_meta: {
      copiedFrom: {
        sourceDate,
        sourceVersionIndex: idx,
        originalSavedAt: snap.savedAt ?? null,
      },
      copiedAt: new Date().toISOString(),
    },
    generated_at: new Date().toISOString(),
    approval_status: "pending",
  };

  if (targetExisting) {
    const { error: upErr } = await db.from("daily_grind_issues").update(payload).eq("issue_date", targetDate);
    if (upErr) return NextResponse.json({ error: `update target: ${upErr.message}` }, { status: 500 });
  } else {
    const { error: inErr } = await db.from("daily_grind_issues").insert(payload);
    if (inErr) return NextResponse.json({ error: `insert target: ${inErr.message}` }, { status: 500 });
  }

  logger.info("dg_copy_version_to_date.success", {
    sourceDate,
    sourceVersionIndex: idx,
    targetDate,
    headline: sections.headline,
    overwrote: Boolean(targetExisting),
  });
  return NextResponse.json({
    ok: true,
    sourceDate,
    sourceVersionIndex: idx,
    targetDate,
    headline: sections.headline,
    subject: rendered.subject,
    htmlLen: rendered.html.length,
    overwrote: Boolean(targetExisting),
  });
}
