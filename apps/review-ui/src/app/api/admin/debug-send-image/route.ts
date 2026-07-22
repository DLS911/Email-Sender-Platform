/**
 * Send a debug email containing a single image to a specified address.
 * Used to preview a debug-generated image in the actual email context.
 *
 *   POST /api/admin/debug-send-image?to=austin@castorabbott.com&subject=M2%20test&imageUrl=https://...&caption=optional&test=<CRON_SECRET>
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

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const to = url.searchParams.get("to")?.trim();
  const subject = url.searchParams.get("subject")?.trim() ?? "Debug image";
  const imageUrl = url.searchParams.get("imageUrl")?.trim();
  const caption = url.searchParams.get("caption")?.trim() ?? "";

  if (!to) return NextResponse.json({ error: "missing ?to" }, { status: 400 });
  if (!imageUrl) return NextResponse.json({ error: "missing ?imageUrl" }, { status: 400 });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "RESEND_API_KEY missing" }, { status: 500 });

  const from = process.env.RESEND_FROM_ADDRESS ?? "latte@send.castorabbott.com";
  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f4f0eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Georgia,serif;color:#2d2926">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;padding:32px;border-radius:6px">
      <p style="margin:0 0 24px 0;font-size:14px;color:#6a6360;text-transform:uppercase;letter-spacing:1px">Debug preview</p>
      <img src="${imageUrl}" alt="Debug image" style="display:block;width:100%;height:auto;border-radius:4px;margin:0 0 24px 0"/>
      ${caption ? `<p style="margin:0;font-size:15px;line-height:1.6;color:#4a4540">${caption}</p>` : ""}
    </div>
  </body>
</html>`;

  const text = `Debug preview\n\n${imageUrl}\n\n${caption}`;

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
    return NextResponse.json({ ok: true, id: result.data?.id, to, subject });
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
