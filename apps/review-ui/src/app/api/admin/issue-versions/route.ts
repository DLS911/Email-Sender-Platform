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

  // Fetch-one path. Supports two id shapes:
  //   uuid                                — row in newsletter_issue_versions
  //   "inrow:{brand}:{issueDate}:{idx}"   — index into the current row's
  //                                          generation_meta.previousVersions[]
  if (id) {
    if (id.startsWith("inrow:")) {
      const parts = id.split(":");
      if (parts.length !== 4) return NextResponse.json({ error: "bad inrow id" }, { status: 400 });
      const [, inrowBrand, inrowDate, idxStr] = parts;
      const table = inrowBrand === "latte" ? "saturday_latte_issues" : "daily_grind_issues";
      const { data, error } = await db.from(table).select("generation_meta").eq("issue_date", inrowDate!).maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const list = ((data?.generation_meta as { previousVersions?: unknown[] } | null)?.previousVersions ?? []) as Array<Record<string, unknown>>;
      const idx = Number(idxStr);
      const snap = list[idx];
      if (!snap) return NextResponse.json({ error: "snapshot not found" }, { status: 404 });
      return NextResponse.json({
        version: {
          id, brand: inrowBrand, issue_date: inrowDate,
          version_seq: idx + 1,
          subject: snap.subject, headline: snap.headline, preheader: snap.preheader,
          html: snap.html, text_body: snap.textBody,
          sections: snap.sections, generation_meta: snap.generationMeta,
          source: "pre_overwrite_snapshot", source_note: null,
          preview_resend_id: null, ac_campaign_id: null, ac_message_id: null,
          created_at: snap.savedAt,
        },
      });
    }
    // uuid path — proper versions table
    const { data, error } = await db
      .from("newsletter_issue_versions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ version: data });
  }

  // Listing path — merge two sources so the UI shows history regardless
  // of whether the migration has been applied.
  const merged: Array<Record<string, unknown>> = [];

  // Source 1: newsletter_issue_versions (append-only, requires migration)
  try {
    let q = db
      .from("newsletter_issue_versions")
      .select("id, brand, issue_date, version_seq, subject, headline, preheader, source, source_note, preview_resend_id, ac_campaign_id, ac_message_id, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (brand) q = q.eq("brand", brand);
    if (issueDate) q = q.eq("issue_date", issueDate);
    const { data, error: err1 } = await q;
    if (!err1 && data) merged.push(...(data as Array<Record<string, unknown>>));
  } catch { /* table missing = no rows, fall through */ }

  // Source 2: in-row previousVersions on current issue rows (works today)
  const tablesToRead: Array<{ table: string; brandLabel: "latte" | "daily-grind"; headlineCol: string }> = [];
  if (!brand || brand === "latte") tablesToRead.push({ table: "saturday_latte_issues", brandLabel: "latte", headlineCol: "cover_story_headline" });
  if (!brand || brand === "daily-grind") tablesToRead.push({ table: "daily_grind_issues", brandLabel: "daily-grind", headlineCol: "headline" });
  for (const t of tablesToRead) {
    let q = db.from(t.table).select(`issue_date, generation_meta`);
    if (issueDate) q = q.eq("issue_date", issueDate);
    const { data, error: err2 } = await q;
    if (err2 || !data) continue;
    for (const row of data as Array<{ issue_date: string; generation_meta: { previousVersions?: Array<Record<string, unknown>> } | null }>) {
      const list = row.generation_meta?.previousVersions ?? [];
      list.forEach((snap, idx) => {
        merged.push({
          id: `inrow:${t.brandLabel}:${row.issue_date}:${idx}`,
          brand: t.brandLabel,
          issue_date: row.issue_date,
          version_seq: idx + 1,
          subject: snap.subject,
          headline: snap.headline,
          preheader: snap.preheader,
          source: "pre_overwrite_snapshot",
          source_note: null,
          preview_resend_id: null,
          ac_campaign_id: null,
          ac_message_id: null,
          created_at: snap.savedAt,
        });
      });
    }
  }

  merged.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const trimmed = merged.slice(0, limit);
  return NextResponse.json({ versions: trimmed, count: trimmed.length });
}
