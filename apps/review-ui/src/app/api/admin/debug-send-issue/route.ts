/**
 * Send a cached Saturday Latte issue to a single email address for QA.
 *
 * Loads the cached issue by issue_date from saturday_latte_issues, then
 * sends the rendered html/text/subject via Resend to the given ?to.
 * Does NOT touch subscriber state, does NOT check due-now — pure preview.
 *
 *   GET /api/admin/debug-send-issue?to=austin@castorabbott.com&issueDate=2026-07-25&test=<CRON_SECRET>
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const to = url.searchParams.get("to")?.trim();
  const issueDate = url.searchParams.get("issueDate")?.trim();

  if (!to) return NextResponse.json({ error: "missing ?to" }, { status: 400 });
  if (!issueDate) return NextResponse.json({ error: "missing ?issueDate" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: "RESEND_API_KEY missing" }, { status: 500 });
  }

  const db = createClient(supaUrl, supaKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await db
    .from("saturday_latte_issues")
    .select("issue_date, subject, html, text_body")
    .eq("issue_date", issueDate)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "supabase_error", detail: error.message }, { status: 500 });
  }
  if (!data || !data.html) {
    return NextResponse.json({ error: `no cached issue for ${issueDate}` }, { status: 404 });
  }

  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "latte@send.castorabbott.com";
  const resend = new Resend(resendKey);
  try {
    const result = await resend.emails.send({
      from: `Mark <${fromAddress}>`,
      to: [to],
      subject: `[QA] ${data.subject}`,
      html: data.html,
      text: data.text_body ?? "",
      tags: [
        { name: "brand", value: "saturday_latte" },
        { name: "issue_date", value: issueDate },
        { name: "mode", value: "qa_preview" },
      ],
    });
    if (result.error) {
      return NextResponse.json(
        { error: "resend_error", detail: result.error },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      resendId: result.data?.id,
      to,
      issueDate,
      subject: data.subject,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "send_threw", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}
export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
