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
  let body: { issueDate?: string; confirm?: boolean };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  if (body.confirm !== true) return NextResponse.json({ error: "confirm:true required to prevent accidental deletion" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data: before, error: readErr } = await db
    .from("daily_grind_issues")
    .select("issue_date, headline, approval_status")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });
  if (before.approval_status === "approved") {
    return NextResponse.json({
      error: `issue for ${issueDate} is APPROVED. Refusing to delete to prevent dropping something scheduled. If you really want to delete, un-approve first.`,
      current: before,
    }, { status: 409 });
  }

  const { error: delErr } = await db.from("daily_grind_issues").delete().eq("issue_date", issueDate);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  logger.info("dg_delete_issue.success", { issueDate, headline: before.headline });
  return NextResponse.json({ ok: true, deleted: { issueDate: before.issue_date, headline: before.headline, prevStatus: before.approval_status } });
}
