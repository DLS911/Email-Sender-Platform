/**
 * GET /api/admin/dg-dump?issueDate=YYYY-MM-DD
 *
 * Returns the sections structure for a Daily Grind issue so we can
 * inspect what's in firstPull.paragraphs / mainContent.howTo without
 * loading the full HTML.
 */

import { NextResponse } from "next/server";
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

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const issueDate = url.searchParams.get("issueDate");
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  const { data, error } = await db
    .from("daily_grind_issues")
    .select("issue_date, generated_at, headline, subject, sections")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });
  const s = (data.sections ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    issue_date: data.issue_date,
    headline: data.headline,
    subject: data.subject,
    openingTrifecta_theNumber: (s.openingTrifecta as { theNumber?: unknown } | undefined)?.theNumber ?? null,
    firstPull: s.firstPull ?? null,
    mainContent: s.mainContent ?? null,
    ancientTruth: s.ancientTruth ?? null,
    ps: s.ps ?? null,
  });
}
