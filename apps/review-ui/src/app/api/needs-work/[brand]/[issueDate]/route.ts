/**
 * Flag a generated newsletter issue as Needs Work.
 *
 * Mark clicks the amber button in the preview email → this endpoint
 * validates the HMAC token, flips approval_status to 'needs_work',
 * fires an escalation email to the editor, and returns a small
 * confirmation page. The scheduled send cron will refuse to ship a
 * needs_work issue and will not re-notify (approval_notified_at
 * suppresses repeats).
 *
 *   GET /api/needs-work/latte/2026-08-15?t=<token>
 *   GET /api/needs-work/daily-grind/2026-08-17?t=<token>
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { verifyApprovalToken, type ApprovalBrand } from "../../../../../lib/approval-token";
import { sendEditorEscalation } from "../../../../../lib/editor-escalation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tableFor(brand: ApprovalBrand): string {
  return brand === "latte" ? "saturday_latte_issues" : "daily_grind_issues";
}

function isValidBrand(s: string): s is ApprovalBrand {
  return s === "latte" || s === "daily-grind";
}

function isValidIssueDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;padding:64px 24px;background:#f4f0eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Georgia,serif;color:#2d2926}
  .card{max-width:520px;margin:0 auto;background:#ffffff;padding:40px 32px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.04)}
  h1{margin:0 0 16px 0;font-size:24px;font-weight:600}
  p{margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#4a4540}
  .status{display:inline-block;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase}
  .needs-work{background:#fef3e0;color:#c47a1a}
</style></head>
<body><div class="card">${body}</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ brand: string; issueDate: string }> },
): Promise<Response> {
  const { brand, issueDate } = await params;
  if (!isValidBrand(brand) || !isValidIssueDate(issueDate)) {
    return new Response(htmlPage("Invalid link", `<h1>Invalid link</h1><p>The URL is malformed.</p>`), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  if (!verifyApprovalToken(brand, issueDate, "needs-work", token)) {
    return new Response(
      htmlPage(
        "Invalid link",
        `<h1>Invalid or expired link</h1><p>This link failed signature verification. It may have been tampered with, or the signing secret was rotated.</p>`,
      ),
      { status: 401, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  }
  const db = createClient(supaUrl, supaKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const table = tableFor(brand);
  const { data: current, error: readErr } = await db
    .from(table)
    .select("approval_status, subject")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: "db_error", detail: readErr.message }, { status: 500 });
  }
  if (!current) {
    return new Response(
      htmlPage("Not found", `<h1>Issue not found</h1><p>No cached issue for <strong>${issueDate}</strong>.</p>`),
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  if (current.approval_status === "needs_work") {
    return new Response(
      htmlPage(
        "Already flagged",
        `<h1>Already flagged</h1><p><span class="status needs-work">Needs Work</span></p><p>Editor has already been notified. Nothing further to do.</p>`,
      ),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const { error: updateErr } = await db
    .from(table)
    .update({
      approval_status: "needs_work",
      approval_action_at: new Date().toISOString(),
      approval_notified_at: new Date().toISOString(),
    })
    .eq("issue_date", issueDate);
  if (updateErr) {
    return NextResponse.json({ error: "update_error", detail: updateErr.message }, { status: 500 });
  }

  const baseUrl = process.env.PUBLIC_BASE_URL || "https://email-sndr-platform.vercel.app";
  await sendEditorEscalation({
    kind: "needs_work",
    brand,
    issueDate,
    subject: current.subject,
    baseUrl,
  });

  return new Response(
    htmlPage(
      "Flagged as Needs Work",
      `<h1>Flagged as Needs Work</h1><p><span class="status needs-work">Needs Work</span></p><p>The ${brand === "latte" ? "Saturday Morning Latte" : "Daily Grind"} for <strong>${issueDate}</strong> will not ship. Editor has been notified.</p><p><em>${escapeHtml(current.subject)}</em></p>`,
    ),
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
