/**
 * POST /api/admin/dg-delete-issue
 *   { issueDate, confirm: true }
 *
 * Deletes the daily_grind_issues row for the given date. The append-only
 * snapshot history in newsletter_issue_versions is NOT touched, so this
 * is a "clear this date" operation, not a nuke. Built to pair with the
 * never-overwrite rule (2026-10-30): if a date already has content and
 * the user explicitly wants a fresh generation, delete first then
 * generate on a clean date rather than running regenerate=1.
 *
 * Guarded by CRON_SECRET AND a required `confirm: true` to prevent
 * accidental calls.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";

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
  let body: { issueDate?: string; confirm?: boolean; force?: boolean };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  if (body.confirm !== true) return NextResponse.json({ error: "confirm:true required to prevent accidental deletion" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // Read the FULL row (incl. sections/html/text) so we can snapshot before
  // deleting. 2026-11-04: twice I deleted without snapshotting first and
  // lost content Mark then asked to recover. Patched here so even if the
  // never-delete rule is violated, the row survives in the snapshot table.
  const { data: before, error: readErr } = await db
    .from("daily_grind_issues")
    .select("issue_date, headline, subject, preheader, html, text_body, sections, generation_meta, approval_status")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });
  if (before.approval_status === "approved" && body.force !== true) {
    return NextResponse.json({
      error: `issue for ${issueDate} is APPROVED. Refusing to delete to prevent dropping something scheduled. If the scheduled campaign has already been cancelled and you really want to delete the orphaned row, pass force:true.`,
      current: { issue_date: before.issue_date, headline: before.headline, approval_status: before.approval_status },
    }, { status: 409 });
  }

  // Snapshot to newsletter_issue_versions BEFORE deleting. Best-effort —
  // if the version-table insert fails, LOG it but still refuse the delete,
  // so content isn't lost. The whole point of this patch is that delete
  // must not be able to lose content.
  const snapshotResult = await db
    .from("newsletter_issue_versions")
    .insert({
      brand: "daily-grind",
      issue_date: issueDate,
      subject: before.subject,
      headline: before.headline,
      preheader: before.preheader,
      html: before.html,
      text_body: before.text_body,
      sections: before.sections,
      generation_meta: before.generation_meta,
      source: "pre_delete_snapshot",
      source_note: "snapshot taken by dg-delete-issue before DELETE",
    });
  if (snapshotResult.error) {
    logger.error("dg_delete_issue.snapshot_failed", {
      issueDate,
      headline: before.headline,
      error: snapshotResult.error.message,
    });
    return NextResponse.json({
      error: `refusing to delete — snapshot write to newsletter_issue_versions failed: ${snapshotResult.error.message}. Row is preserved. Fix the snapshot error before retrying.`,
    }, { status: 500 });
  }

  const { error: delErr } = await db.from("daily_grind_issues").delete().eq("issue_date", issueDate);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  logger.info("dg_delete_issue.success", { issueDate, headline: before.headline });
  return NextResponse.json({
    ok: true,
    deleted: { issueDate: before.issue_date, headline: before.headline, prevStatus: before.approval_status },
    snapshotted: true,
    note: "row preserved in newsletter_issue_versions (source=pre_delete_snapshot). Use /api/admin/issue-versions?brand=daily-grind&issueDate=... to list and restore.",
  });
}
