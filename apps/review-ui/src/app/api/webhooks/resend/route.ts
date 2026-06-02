import { resendProvider } from "@platform/distribution";
import { logger } from "@platform/observability";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getDb() {
  return createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

/**
 * Add an address to suppression_list (item K). UNIQUE constraint on email
 * means we use upsert with ignoreDuplicates. Never throws — webhook keeps
 * returning 200 even on DB transient errors so Resend doesn't retry.
 */
async function suppress(email: string, reason: string, notes: string): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!e) return;
  try {
    const { error } = await getDb().from("suppression_list").upsert(
      {
        email: e,
        reason,
        source_brand_id: "castor_abbott",
        global: true,
        notes,
      },
      { onConflict: "email", ignoreDuplicates: true },
    );
    if (error) {
      logger.error("webhook.resend.suppress_failed", { email: e, reason, error_message: error.message });
    } else {
      logger.info("webhook.resend.suppressed", { email: e, reason });
    }
  } catch (err) {
    logger.error("webhook.resend.suppress_threw", {
      email: e,
      reason,
      error_message: err instanceof Error ? err.message : String(err),
    });
  }
}

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

      // Item K: act on suppressing events.
      // Hard bounces and complaints add the address to suppression_list so the
      // send loop refuses to email it again. Soft bounces are transient (no
      // suppression). Opens/clicks/delivered are just logged for now (item H
      // will persist them to a daily_grind_email_events table).
      if (event.email) {
        if (event.eventType === "bounced" && event.bounceType === "hard") {
          await suppress(
            event.email,
            "bounce-hard",
            `hard bounce via Resend at ${event.eventAt}`,
          );
        } else if (event.eventType === "complained") {
          await suppress(
            event.email,
            "complained",
            `spam complaint via Resend at ${event.eventAt}`,
          );
        }
      }
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
