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
 * Extract our custom tags (brand, issue_date) from a Resend event payload.
 * Sends are tagged at fire time so opens/clicks/etc. carry the newsletter +
 * issue back to us without a secondary lookup. Tags are on `data.tags` as
 * either an array of {name,value} objects or an object map, depending on
 * where Resend surfaces them. Handle both defensively.
 */
function extractTags(rawPayload: unknown): { brand?: string; issueDate?: string; messageId?: string } {
  const p = rawPayload as { data?: Record<string, unknown> } | null;
  const data = p?.data ?? {};
  const rawTags = data.tags;
  const messageId = typeof data.email_id === "string"
    ? data.email_id
    : typeof data.id === "string"
      ? data.id
      : undefined;

  const out: { brand?: string; issueDate?: string; messageId?: string } = {};
  if (messageId) out.messageId = messageId;

  if (Array.isArray(rawTags)) {
    for (const t of rawTags) {
      if (t && typeof t === "object" && "name" in t && "value" in t) {
        const name = String((t as { name: unknown }).name);
        const value = String((t as { value: unknown }).value);
        if (name === "brand") out.brand = value;
        else if (name === "issue_date") out.issueDate = value;
      }
    }
  } else if (rawTags && typeof rawTags === "object") {
    const t = rawTags as Record<string, unknown>;
    if (typeof t.brand === "string") out.brand = t.brand;
    if (typeof t.issue_date === "string") out.issueDate = t.issue_date;
  }

  return out;
}

/**
 * Persist a single event to email_events. Uses upsert with
 * ignoreDuplicates on (provider_name, provider_event_id) so Resend retries
 * won't create duplicates. Never throws — webhook keeps returning 200.
 */
async function persistEvent(event: {
  providerEventId: string;
  eventType: string;
  eventAt: string;
  email: string;
  bounceType?: string;
  clickUrl?: string;
  rawPayload: unknown;
}): Promise<void> {
  const tags = extractTags(event.rawPayload);
  const row: Record<string, unknown> = {
    provider_name: "resend",
    provider_event_id: event.providerEventId,
    event_type: event.eventType,
    event_at: event.eventAt,
    email: event.email.trim().toLowerCase(),
    raw_payload: event.rawPayload,
  };
  if (tags.brand) row.brand = tags.brand;
  if (tags.issueDate) row.issue_date = tags.issueDate;
  if (tags.messageId) row.resend_message_id = tags.messageId;
  if (event.bounceType) row.bounce_type = event.bounceType;
  if (event.clickUrl) row.click_url = event.clickUrl;

  try {
    const { error } = await getDb().from("email_events").upsert(row, {
      onConflict: "provider_name,provider_event_id",
      ignoreDuplicates: true,
    });
    if (error) {
      logger.error("webhook.resend.persist_failed", {
        provider_event_id: event.providerEventId,
        event_type: event.eventType,
        error_message: error.message,
      });
    }
  } catch (err) {
    logger.error("webhook.resend.persist_threw", {
      provider_event_id: event.providerEventId,
      event_type: event.eventType,
      error_message: err instanceof Error ? err.message : String(err),
    });
  }
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

      // Persist every event to email_events for the engagement dashboard.
      // Best-effort — a persist failure never blocks other events or the
      // 200 response back to Resend.
      if (event.email) {
        await persistEvent({
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          eventAt: event.eventAt,
          email: event.email,
          ...(event.bounceType ? { bounceType: event.bounceType } : {}),
          ...(event.clickUrl ? { clickUrl: event.clickUrl } : {}),
          rawPayload: event.rawPayload,
        });
      }

      // Act on suppressing events. Hard bounces and complaints add the
      // address to suppression_list so the send loop refuses to email it
      // again. Soft bounces are transient (no suppression).
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
