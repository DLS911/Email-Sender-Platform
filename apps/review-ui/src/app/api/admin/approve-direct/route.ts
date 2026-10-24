/**
 * POST /api/admin/approve-direct
 *   { brand: "latte" | "daily-grind", issueDate: "YYYY-MM-DD" }
 *
 * Admin backdoor to set approval_status=approved on an issue without
 * the HMAC token. Used when the normal flow isn't practical (e.g. we
 * copied content from another date and need to approve the result).
 * Guarded by CRON_SECRET.
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
  let body: { brand?: string; issueDate?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const brand = body.brand?.trim();
  const issueDate = body.issueDate?.trim();
  if (!brand || (brand !== "latte" && brand !== "daily-grind")) return NextResponse.json({ error: "brand must be 'latte' or 'daily-grind'" }, { status: 400 });
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const table = brand === "latte" ? "saturday_latte_issues" : "daily_grind_issues";
  const { data: before, error: readErr } = await db.from(table).select("approval_status").eq("issue_date", issueDate).maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: `no ${brand} issue for ${issueDate}` }, { status: 404 });

  const { error: upErr } = await db.from(table).update({ approval_status: "approved" }).eq("issue_date", issueDate);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  logger.info("approve_direct.success", { brand, issueDate, prev: before.approval_status });
  return NextResponse.json({ ok: true, brand, issueDate, prevStatus: before.approval_status, newStatus: "approved" });
}
