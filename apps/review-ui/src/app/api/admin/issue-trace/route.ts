/**
 * Issue Pipeline Trace API
 *
 * Returns the full per-issue pipeline trace: each stage's input (what it
 * received from prior stages) and output (what it produced for downstream
 * stages), plus the final drift-check flags.
 *
 * The visual page at /admin/trace/[date] reads this endpoint. It is also
 * directly callable for ad-hoc debugging:
 *
 *   GET /api/admin/issue-trace?date=2026-05-21&test=<CRON_SECRET>
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  if (!cronSecret) return false;
  if (authHeader === `Bearer ${cronSecret}`) return true;
  if (querySecret && querySecret === cronSecret) return true;
  return false;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "missing or malformed `date` param (YYYY-MM-DD)" }, { status: 400 });
  }

  const db = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );

  const { data, error } = await db
    .from("daily_grind_issues")
    .select("issue_date, headline, generation_meta")
    .eq("issue_date", date)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: `no issue found for ${date}` }, { status: 404 });
  }

  const meta = (data.generation_meta ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    issueDate: data.issue_date,
    headline: data.headline,
    pipeline: meta.pipeline ?? null,
    issueSummary: meta.issueSummary ?? null,
    contentType: meta.contentType ?? null,
    researchSources: meta.researchSources ?? null,
  });
}
