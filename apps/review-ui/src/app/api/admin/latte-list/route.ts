/**
 * GET /api/admin/latte-list?limit=50&order=desc
 *
 * Read-only listing of every Saturday Latte issue in Supabase. Returns
 * per-row: issue_date, cover_story_headline, subject, approval_status,
 * image counts (hero/cover/tasting/etc from sections.images), cost, model.
 * No side effects. Built to scan the archive for unsent-but-good
 * candidates to reuse on a date with image-generation problems.
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
  const q = url.searchParams.get("test");
  return authHeader === `Bearer ${cronSecret}` || q === cronSecret;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data, error } = await db
    .from("saturday_latte_issues")
    .select("issue_date, cover_story_headline, subject, approval_status, sections, html, model, cost_usd, generated_at")
    .order("issue_date", { ascending: order === "asc" })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as Array<{
    issue_date: string;
    cover_story_headline: string | null;
    subject: string | null;
    approval_status: string | null;
    sections: Record<string, unknown> | null;
    html: string | null;
    model: string | null;
    cost_usd: number | null;
    generated_at: string | null;
  }>;

  const list = rows.map((r) => {
    const imgs = (r.sections?.images ?? {}) as Record<string, unknown>;
    const imageKeys = Object.keys(imgs);
    const html = r.html ?? "";
    const htmlImgCount = (html.match(/<img\b/gi) ?? []).length;
    const supabaseStoredImgCount = (html.match(/supabase\.co\/storage\/v1\/object\/public\//gi) ?? []).length;
    return {
      issue_date: r.issue_date,
      cover_story_headline: r.cover_story_headline,
      subject: r.subject,
      approval_status: r.approval_status,
      image_section_keys: imageKeys,
      image_section_count: imageKeys.length,
      html_img_tag_count: htmlImgCount,
      supabase_stored_img_count: supabaseStoredImgCount,
      cost_usd: r.cost_usd,
      model: r.model,
      generated_at: r.generated_at,
    };
  });

  return NextResponse.json({ count: list.length, issues: list });
}
