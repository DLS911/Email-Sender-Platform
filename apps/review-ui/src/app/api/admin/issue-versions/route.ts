/**
 * GET /api/admin/issue-versions
 *   ?brand=latte|daily-grind
 *   &issueDate=YYYY-MM-DD   (optional — omit to list across dates)
 *   &id=<uuid>              (optional — fetch one row incl. html)
 *   &limit=25               (default; only used when listing)
 *
 * Returns append-only history of every issue version, so nothing that
 * was ever generated is permanently lost. Includes preview_resend_id
 * + ac_campaign_id if attached.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  return authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const brand = url.searchParams.get("brand");
  const issueDate = url.searchParams.get("issueDate");
  const id = url.searchParams.get("id");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "25")));

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // Fetch-one path returns full html/text/sections. Called when the
  // reviewer clicks a version to view or export it.
  if (id) {
    const { data, error } = await db
      .from("newsletter_issue_versions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ version: data });
  }

  // Listing path — omit html/text_body/sections for payload size.
  let q = db
    .from("newsletter_issue_versions")
    .select("id, brand, issue_date, version_seq, subject, headline, preheader, source, source_note, preview_resend_id, ac_campaign_id, ac_message_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (brand) q = q.eq("brand", brand);
  if (issueDate) q = q.eq("issue_date", issueDate);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ versions: data ?? [], count: (data ?? []).length });
}
