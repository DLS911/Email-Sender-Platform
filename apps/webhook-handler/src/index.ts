/**
 * Webhook handler.
 *
 * Receives signed webhook payloads from distribution providers (Resend in v1,
 * SES later), verifies signatures, normalizes events through the
 * DistributionProvider abstraction, and writes rows into `send_events`.
 *
 * Hosting decision (deferred to spec 11_deployment): either Supabase Edge
 * Function or a small Hono server. The handler logic below is host-neutral.
 */
import { Hono } from "hono";
import { logger } from "@platform/observability";
import { resendProvider } from "@platform/distribution";

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, service: "webhook-handler" }));

app.post("/webhooks/resend", async (c) => {
  const rawBody = await c.req.text();
  const headers: Record<string, string> = {};
  for (const [k, v] of c.req.raw.headers.entries()) headers[k.toLowerCase()] = v;

  const signingSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET ?? "";

  try {
    const events = await resendProvider.parseWebhook({ rawBody, headers, signingSecret });
    logger.info("webhook.resend.parsed", { event_count: events.length });
    // TODO(stage-2): write normalized events to send_events with idempotency
    // on (provider_name, provider_event_id).
    return c.json({ received: events.length });
  } catch (err) {
    logger.error("webhook.resend.error", {
      error_message: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "invalid_webhook" }, 400);
  }
});

const port = Number(process.env.PORT ?? 8080);

if (process.env.NODE_ENV !== "test") {
  // Local dev: serve via Node. Production hosting decision is deferred.
  const { serve } = await import("@hono/node-server").catch(() => ({ serve: null }));
  if (serve) {
    serve({ fetch: app.fetch, port });
    logger.info("webhook.listening", { port });
  } else {
    logger.warn("webhook.no_server_adapter", {
      hint: "install @hono/node-server for local dev, or wrap fetch() into a Supabase Edge Function",
    });
  }
}

export { app };
