/**
 * Send a single email with multiple images stacked, for side-by-side
 * comparison (car test grids, image quality passes, etc.).
 *
 *   POST /api/admin/debug-send-image-batch?test=<CRON_SECRET>
 *   body: {
 *     to: "austin@castorabbott.com",
 *     subject: "Car test grid",
 *     images: [
 *       { url: "https://...", caption: "McLaren F1 LM · reference" },
 *       ...
 *     ]
 *   }
 */

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as {
    to?: string;
    subject?: string;
    images?: Array<{ url?: string; caption?: string }>;
  };
  const to = body.to?.trim();
  const subject = body.subject?.trim() ?? "Image batch";
  const images = Array.isArray(body.images) ? body.images : [];
  if (!to) return NextResponse.json({ error: "missing to" }, { status: 400 });
  if (images.length === 0) return NextResponse.json({ error: "missing images" }, { status: 400 });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "RESEND_API_KEY missing" }, { status: 500 });
  const from = process.env.RESEND_FROM_ADDRESS ?? "latte@send.castorabbott.com";

  const blocks = images
    .map((img) => {
      if (!img.url) return "";
      return `<div style="margin:0 0 32px 0"><p style="margin:0 0 8px 0;font-size:13px;color:#6a6360;font-weight:600">${escapeHtml(img.caption ?? "")}</p><img src="${img.url}" alt="${escapeHtml(img.caption ?? "")}" style="display:block;width:100%;height:auto;border-radius:6px;border:1px solid #e6d9c3"/></div>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f4f0eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Georgia,serif;color:#2d2926"><div style="max-width:640px;margin:0 auto;background:#ffffff;padding:32px;border-radius:8px">${blocks}</div></body></html>`;

  const text = images
    .map((img) => `${img.caption ?? ""}\n${img.url ?? ""}`)
    .join("\n\n");

  const resend = new Resend(apiKey);
  try {
    const result = await resend.emails.send({
      from: `Latte Debug <${from}>`,
      to: [to],
      subject,
      html,
      text,
    });
    if (result.error) {
      return NextResponse.json({ error: "resend_error", detail: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: result.data?.id, to, subject, imageCount: images.length });
  } catch (err) {
    return NextResponse.json(
      { error: "send_threw", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
