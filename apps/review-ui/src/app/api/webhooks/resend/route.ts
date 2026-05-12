import { resendProvider } from "@platform/distribution";
import { logger } from "@platform/observability";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const signingSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET ?? "";
  if (!signingSecret) {
    logger.error("webhook.resend.missing_secret", {});
    return NextResponse.json({ error: "webhook_misconfigured" }, { status: 500 });
  }

  try {
    const events = await resendProvider.parseWebhook({ rawBody, headers, signingSecret });
    logger.info("webhook.resend.parsed", {
      event_count: events.length,
      event_types: events.map((e) => e.eventType),
    });

    for (const event of events) {
      logger.info("webhook.resend.event", {
        provider_event_id: event.providerEventId,
        event_type: event.eventType,
        event_at: event.eventAt,
        email: event.email,
        bounce_type: event.bounceType,
        click_url: event.clickUrl,
      });
    }

    return NextResponse.json({ received: events.length });
  } catch (err) {
    logger.error("webhook.resend.error", {
      error_message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "invalid_webhook" }, { status: 400 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, endpoint: "resend-webhook" });
}
