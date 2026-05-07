# ADR 0004 — Hono for the webhook handler

**Status:** accepted
**Date:** 2026-05-05
**Decision-maker:** dev team

## Context

`apps/webhook-handler` receives Resend webhook events, verifies signatures, and writes normalized rows to `send_events`. Spec 11 leaves the hosting choice between Supabase Edge Functions and a Railway worker as an open decision.

Either way, the handler needs an HTTP framework. Spec 01 says native `fetch` preferred and rules out `axios`, but doesn't address servers.

## Decision

Use **Hono** in `apps/webhook-handler`.

- Built on the standard Web `Request`/`Response` shape.
- Runs on Node, Bun, Cloudflare Workers, Deno, and Supabase Edge Functions without changes.
- Tiny — adds < 50KB.
- TypeScript-native with strong types for request/response.

The handler logic stays host-neutral. We can deploy as a Supabase Edge Function or a Railway service without rewriting the handler — only the entry adapter changes.

## Consequences

- Defers the hosting choice (Supabase Edge vs Railway) to operational reality. Either works.
- The handler is testable as a `fetch`-style function — no Node-specific HTTP mocking needed.
- One additional dependency (`hono` + `@hono/node-server` for local dev).

## Alternatives considered

- **Express.** Heavier, Node-only, weak TypeScript story.
- **Fastify.** Strong TS but Node-only, more dep weight than needed for one route.
- **Native `node:http`.** Possible but the routing and signature parsing boilerplate isn't worth the savings.
- **Pure Supabase Edge Function.** Locks us into Deno runtime. We may end up there, but Hono lets us delay the decision.

## References

- `apps/webhook-handler/src/index.ts`
- `docs/specs/06_distribution_platform.spec.md` (webhook architecture)
- `docs/specs/11_deployment.spec.md` (hosting open decision)
