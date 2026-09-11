/**
 * Re-send the preview email for an existing issue without regenerating.
 *
 * POST /api/admin/resend-preview
 *   { brand: "daily-grind" | "latte", issueDate: "YYYY-MM-DD" }
 *
 * Loads the persisted html/text/subject/preheader for that issue and
 * fires sendPreviewEmail — which delivers to PREVIEW_APPROVER_EMAIL
 * (default mark@castorabbott.com) with EDITOR_ESCALATION_EMAIL
 * (default austin@castorabbott.com) on CC. Useful when the preview
 * bounced, was missed, or the reviewer just wants it re-delivered.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import { sendPreviewEmail } from "../../../../lib/preview-email";

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

function tableFor(brand: string): string | null {
  if (brand === "latte") return "saturday_latte_issues";
  if (brand === "daily-grind") return "daily_grind_issues";
  return null;
}

function headlineColumn(brand: string): string {
  return brand === "latte" ? "cover_story_headline" : "headline";
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { brand?: string; issueDate?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const brand = body.brand?.trim();
  const issueDate = body.issueDate?.trim();
  if (!brand || (brand !== "latte" && brand !== "daily-grind")) {
    return NextResponse.json({ error: "brand must be 'latte' or 'daily-grind'" }, { status: 400 });
  }
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const table = tableFor(brand)!;
  const headlineCol = headlineColumn(brand);
  const { data, error } = await db
    .from(table)
    .select(`issue_date, subject, ${headlineCol}, html, text_body`)
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no ${brand} issue for ${issueDate}` }, { status: 404 });

  const row = data as unknown as { issue_date: string; subject: string | null; html: string | null; text_body: string | null } & Record<string, string | null>;
  if (!row.html) return NextResponse.json({ error: "no rendered html for this issue" }, { status: 400 });

  const baseUrl = process.env.PUBLIC_BASE_URL || "https://email-sndr-platform.vercel.app";
  const subject = row.subject ?? row[headlineCol] ?? `Preview ${issueDate}`;
  const result = await sendPreviewEmail({
    brand,
    issueDate,
    subject,
    issueHtml: row.html,
    ...(row.text_body ? { issueText: row.text_body } : {}),
    baseUrl,
  });

  if (!result.ok) {
    logger.warn("resend_preview.failed", { brand, issueDate, error: result.error });
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  logger.info("resend_preview.sent", { brand, issueDate, resendId: result.resendId });
  return NextResponse.json({
    ok: true,
    resendId: result.resendId,
    to: process.env.PREVIEW_APPROVER_EMAIL || "mark@castorabbott.com",
    cc: process.env.EDITOR_ESCALATION_EMAIL || "austin@castorabbott.com",
    subject,
  });
}
