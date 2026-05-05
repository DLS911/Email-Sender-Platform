---
spec: 06_distribution_platform
title: Distribution Platform & Compliance
version: 1.1
status: draft
audience: dev_team, agentic_orchestrator
dependencies:
  - 00_overview
  - 01_foundation
  - 02_data_model
  - 04_content_pipeline
  - 05_brain_and_learning
consumed_by:
  - 07_experiment_framework
  - 08_review_interface
  - 09_optimization_policies
  - 10_observability
  - 11_deployment
purpose: Define the distribution platform that turns approved episodes into delivered emails and inbound events. Built on a provider abstraction layer with Resend as the v1 implementation, designed for SES migration when commercial scale justifies owning the deliverability substrate directly.
---

# Distribution Platform & Compliance

## What This Spec Covers

The layer between "the editorial pipeline produced an approved episode" and "subscribers received it and produced engagement data." This is the most operationally critical layer in the platform — if it fails, the brand misses sends, deliverability degrades, or compliance violations occur. Bugs here have direct revenue and legal consequences.

The spec covers Resend integration as the sending substrate, subscriber data model and lifecycle, sending domain isolation per brand, segmentation, send scheduling and execution, webhook event ingestion and attribution, reply parsing and routing, suppression list management, and compliance enforcement (CAN-SPAM, GDPR, double opt-in patterns where applicable).

This spec does not cover the review/approval workflow before send (that's `08_review_interface`) or the agentic experimentation that uses this layer (that's `07_experiment_framework`).

## Why Resend, Not Beehiiv or ActiveCampaign — and Why Resend Now, SES Later

The decision was made before this spec was written. Resend is the cleanest sending primitive available — pure programmable infrastructure, modern API, React Email for templates, webhooks for every event. The platform layer described in this spec is what we build on top of Resend to produce the agentic newsletter substrate that doesn't exist as a packaged product.

Beehiiv would solve subscriber management for free but lock the platform into Beehiiv's model of what a newsletter is. We'd hit ceilings on experimentation and attribution within 6-12 months. Migrating off Beehiiv later is painful.

ActiveCampaign is what Mark currently uses and dislikes. It's a database with a UI wrapper. Wrong tool for an agentic platform.

The cost of Resend is approximately 2-3 weeks of additional development to build the platform layer (subscriber management, segmentation, signup forms, suppression list, performance dashboard, compliance flows). The benefit is total architectural control and a foundation for commercial extraction.

**On the layer below Resend.** Resend itself runs on AWS SES. When we send through Resend, the path is `our code → Resend API → Resend's worker layer → AWS SES → ISPs → subscriber inbox`. SES handles the actual SMTP protocol, IP reputation, ISP relationships, and bounce/complaint feedback loops. Resend is a developer-experience layer on top of SES — modern API, React Email, webhook ergonomics, audience primitives, dashboard.

We could go direct to SES and skip Resend. We're not, for v1. The reasoning is in the next section.

The architectural principle for v1: **build the platform behind a provider abstraction so the choice between Resend and SES (or any other provider) is reversible without rewriting application code.**

## Provider Abstraction Layer

The distribution provider — Resend in v1, possibly SES or another provider later — is encapsulated behind a typed interface. Application code never imports a provider SDK directly. All provider interaction goes through `@platform/distribution`.

### Why This Matters

Three reasons make the abstraction non-negotiable:

**Future migration to SES is plausible and should be easy.** When platform volume grows past Resend's pricing curve advantage (typically around 100K-200K sends/month), going direct to SES saves real money. When commercial customers (Phase 6+) want infrastructure independence guarantees, SES gives us a story Resend can't. We need migration to be a new adapter, not a rewrite.

**Provider outages happen.** Resend has had multi-hour outages. So has every email provider in history. The right architecture treats provider failure as a routing problem (swap providers, resume operations) rather than a "the system is down" problem.

**Multiple providers may coexist long-term.** Some brands may want SES for cost; others may want SendGrid for specific deliverability characteristics; bulk transactional traffic might route differently from editorial sends. The abstraction lets us route per-brand or even per-send to different providers.

### The DistributionProvider Interface

A typed interface in `packages/distribution/src/provider.ts`:

```typescript
export interface DistributionProvider {
  // Identity
  readonly name: "resend" | "ses" | "sendgrid" | "postmark";

  // Domain management
  verifyDomain(params: VerifyDomainParams): Promise<DomainStatus>;
  getDomainStatus(domainId: string): Promise<DomainStatus>;
  listDomains(brandId: string): Promise<Domain[]>;

  // Sending
  createBroadcast(params: CreateBroadcastParams): Promise<BroadcastResult>;
  cancelBroadcast(broadcastId: string): Promise<CancelResult>;
  getBroadcastStatus(broadcastId: string): Promise<BroadcastStatus>;

  // Webhooks
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
  parseWebhookEvent(rawPayload: object): NormalizedEvent;
  registerWebhookEndpoint(params: RegisterWebhookParams): Promise<WebhookEndpoint>;

  // Suppression
  addToProviderSuppressionList(email: string, reason: string): Promise<void>;
  removeFromProviderSuppressionList(email: string): Promise<void>;

  // Reputation / deliverability
  getDeliverabilityMetrics(brandId: string, window: TimeWindow): Promise<DeliverabilityMetrics>;
}
```

The `NormalizedEvent` type is the platform's canonical event shape, identical across providers. Provider-specific event payloads get translated to this shape inside each adapter. The webhook handler upstream of the database doesn't know whether it's processing a Resend event or an SES-via-SNS event — it gets a `NormalizedEvent`.

### v1: ResendProvider

The Phase 1 implementation lives at `packages/distribution/src/providers/resend.ts`. It uses the `resend` npm SDK to satisfy every method on the interface. All Resend-specific code lives in this one file. No other file in the codebase imports `resend`.

```typescript
// packages/distribution/src/providers/resend.ts
import { Resend } from "resend";
import { DistributionProvider, NormalizedEvent } from "../provider";

export class ResendProvider implements DistributionProvider {
  readonly name = "resend" as const;
  private client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async createBroadcast(params: CreateBroadcastParams): Promise<BroadcastResult> {
    const result = await this.client.broadcasts.create({
      from: `${params.fromName} <${params.fromEmail}>`,
      to: params.recipients.map(r => r.email),
      subject: params.subjectLine,
      html: params.html,
      reply_to: params.replyTo,
      headers: params.customHeaders,
      tags: params.tags,
    });
    return {
      providerBroadcastId: result.id,
      providerName: "resend",
      acceptedAt: new Date(),
    };
  }

  parseWebhookEvent(rawPayload: object): NormalizedEvent {
    // Translates Resend's event shape to NormalizedEvent
    return {
      providerName: "resend",
      providerEventId: rawPayload.id,
      eventType: this.mapResendEventType(rawPayload.type),
      occurredAt: new Date(rawPayload.created_at),
      subscriberEmail: rawPayload.email,
      brandId: rawPayload.tags?.brand_id,
      sendId: rawPayload.tags?.send_id,
      episodeId: rawPayload.tags?.episode_id,
      clickUrl: rawPayload.click_url,
      bounceType: rawPayload.bounce_type,
      // ...
    };
  }

  // ... other interface methods
}
```

### Future: SESProvider (Phase 6+ commercial extraction)

When the platform commercializes and goes direct to AWS SES, a new adapter file appears: `packages/distribution/src/providers/ses.ts`. It implements the same interface using AWS SDK v3 (`@aws-sdk/client-sesv2`, `@aws-sdk/client-sns`, `@aws-sdk/client-sqs`).

Key differences the SES adapter handles internally:

- **Sending:** SES uses the `SendEmailCommand` and bulk variants instead of Resend's broadcast model. The adapter manages this distinction.
- **Webhooks:** SES doesn't push webhooks directly. Events flow `SES → SNS → SQS → our worker`. The adapter encapsulates this; from the platform's perspective, it's still "events arrive at the webhook endpoint."
- **Domain verification:** Manual DNS records via Route 53 or external registrar, plus SES Configuration Sets. The adapter exposes the same `verifyDomain` method; under the hood it returns the DNS records the customer needs to add.
- **Suppression:** SES has its own account-level suppression list managed via `PutSuppressedDestinationCommand`. The adapter syncs the platform's `suppression_list` with SES's.
- **Reputation:** CloudWatch metrics instead of Resend's dashboard API. The adapter queries CloudWatch and returns `DeliverabilityMetrics` in the canonical shape.

The application code path doesn't change. `apps/pipeline/src/send-orchestration.ts` calls `provider.createBroadcast(...)`. Whether the active provider is Resend or SES is invisible to the orchestrator.

### Provider Selection at Runtime

A new `platform_config` row determines which provider is active per brand:

```typescript
{
  key: "distribution.provider",
  brand_id: "castor_abbott",
  environment: "production",
  value: {
    primary: "resend",
    fallback: null,                    // No fallback in v1; SES becomes an option later
  },
}
```

The distribution orchestrator reads this config and instantiates the appropriate provider. Per-brand provider selection means migration can happen one brand at a time — Castor Abbott on SES while Cortex stays on Resend, for example. This makes migration low-risk; you don't flip a global switch.

### Migration Path: Resend to SES

When the time comes (probably Phase 6 commercial extraction, possibly earlier if costs justify):

1. **Implement `SESProvider` in the same monorepo.** New adapter file. No application changes.
2. **Set up SES production access.** AWS account, sending limits unlocked, dedicated IPs if appropriate.
3. **Verify sending domains in SES** alongside Resend. Both providers can hold the same domain simultaneously.
4. **Warm up SES IPs** by routing 1-5% of sends through SES, increasing weekly. (The provider abstraction supports this — make the provider lookup a weighted choice based on a percentage roll.)
5. **Update `platform_config` row** to switch the brand's provider to `ses` when warm-up is complete.
6. **Decommission Resend** for that brand once a stable period has elapsed.

The whole migration is a config-driven, gradual, per-brand process. No big-bang cutover.

### What This Means for v1

For Phase 1 work, the dev team builds:

1. The `DistributionProvider` interface (typed, exported from `@platform/distribution`).
2. The `NormalizedEvent` type and other canonical shapes.
3. The `ResendProvider` adapter implementing every interface method.
4. A provider factory that reads `platform_config` and returns the appropriate provider for a given brand.
5. Tests verifying that the abstraction works: a mock provider can be swapped in for tests, and the rest of the distribution code is provider-agnostic.

What the dev team explicitly does *not* build:

1. The `SESProvider` adapter. Phase 6+.
2. Any AWS-specific infrastructure (SNS topics, SQS queues, CloudWatch dashboards).
3. Multi-provider routing logic (weighted selection, fallback). v1 has one provider per brand.

Documenting the SES future in this spec so the dev team designs the abstraction correctly the first time. Building the abstraction *without* the future SES path in mind tends to leak Resend assumptions into application code; building it with the future path in mind keeps the boundary clean.

## Architecture Overview

The distribution platform has six logical components:

1. **Subscriber data layer** — Per-brand subscriber lists, preferences, consent records.
2. **Segmentation engine** — Static and dynamic segments for targeted sends.
3. **Send orchestration** — Schedules, executes, monitors sends through the active distribution provider.
4. **Sending domain management** — Per-brand domain configuration, DKIM/SPF/DMARC, reputation monitoring.
5. **Event ingestion** — Webhook handlers that capture and attribute every event from the active provider.
6. **Compliance & suppression** — CAN-SPAM enforcement, suppression list, GDPR consent records, complaint handling.

Each component has clear contracts with the others. The send orchestration consumes from the subscriber and segmentation layers, executes through sending domain configuration, and produces events that flow into ingestion and back to the brain via attribution. None of the components reference Resend (or any specific provider) directly — they operate against the `DistributionProvider` interface, with the active provider resolved per-brand from `platform_config`.

## Subscriber Data Layer

Subscribers are per-brand. Same email can subscribe to multiple brands (separate rows). No cross-brand identity resolution at the data layer — each brand owns its subscriber relationship independently.

The `subscribers` table is defined in `02_data_model`. This spec covers the operational logic on top of it.

### Subscriber Lifecycle

A subscriber moves through a defined lifecycle:

```
[unconfirmed] → [active] → [active|unsubscribed|bounced|complained|suppressed]
```

**`unconfirmed`** — Created via signup form, awaiting double opt-in confirmation. Receives only the confirmation email. Times out to `expired` status if not confirmed within 7 days. (Whether double opt-in is required is per-brand configurable; some brands use single opt-in.)

**`active`** — Confirmed and receiving sends. The default state for a healthy subscriber.

**`unsubscribed`** — Voluntarily opted out. Honored across the brand. May or may not be honored across other brands depending on `global` flag in suppression list.

**`bounced`** — Hard bounce detected. Email is invalid or undeliverable. Excluded from future sends. Does not get reactivated automatically.

**`complained`** — Marked as spam by recipient. Auto-added to global suppression list.

**`suppressed`** — Manually suppressed by an admin or auto-suppressed for compliance reasons.

### Signup Endpoints

Each brand has its own signup endpoint. Implementation lives in `apps/webhook-handler` (or as a Vercel serverless function — implementation choice deferred).

**Endpoint:** `POST /api/<brand-slug>/subscribe`

**Request:**
```typescript
{
  email: string,
  name: string | null,
  source: string,                       // "website_signup", "referral", "import", "api"
  custom_fields: Record<string, unknown> | null,
  consent: {
    timestamp: string,                  // ISO datetime
    ip_address: string,                 // For audit/GDPR
    user_agent: string,
    consent_text: string,               // The exact text the subscriber agreed to
  } | null,
}
```

**Response:**
```typescript
{
  status: "pending_confirmation" | "active" | "already_subscribed",
  subscriber_id: string,
}
```

**Behavior:**

1. Validate email format. Reject malformed.
2. Check suppression list (global). If suppressed, return `already_subscribed` (do not reveal suppression status — privacy + abuse prevention).
3. Check existing subscriber for this brand. If `active`, return `already_subscribed`. If `unsubscribed`, return `already_subscribed` (resubscribe requires explicit re-opt-in via a separate flow).
4. Create `subscribers` row with status `unconfirmed` (or `active` if brand uses single opt-in).
5. If double opt-in: send confirmation email via Resend with a tokenized link. Return `pending_confirmation`.
6. If single opt-in: subscriber is active immediately. Return `active`.
7. Log signup event in `audit_log`.

**Rate limiting:** Per-IP rate limit on signup endpoints (10/minute) to prevent abuse. Implementation via Vercel middleware or similar.

### Confirmation Endpoint

**Endpoint:** `GET /api/<brand-slug>/confirm?token=<tokenized-id>`

Verifies the token, marks the subscriber as `active`, redirects to a brand-specific confirmation page. Tokens expire after 7 days; expired tokens trigger a "request a new confirmation" flow.

### Unsubscribe Flow

Unsubscribes happen four ways:

1. **One-click List-Unsubscribe header.** Required by Gmail and Apple Mail for any sender > 5K daily volume. Resend handles this automatically when configured. Webhook fires on action.
2. **Unsubscribe link in email footer.** Tokenized link that lands on a brand-specific unsubscribe confirmation page. One click marks as unsubscribed; second click confirms.
3. **Reply with "unsubscribe."** Reply parsing detects unsubscribe intent and processes it. (See Reply Parsing below.)
4. **Admin action.** Brand admin manually marks a subscriber as unsubscribed.

All four paths converge on the same `unsubscribeSubscriber()` function:

```typescript
async function unsubscribeSubscriber({
  subscriberId, brandId, source, reason, requestedAt,
}: UnsubscribeRequest) {
  await db.transaction(async (tx) => {
    await tx.update("subscribers", subscriberId, {
      status: "unsubscribed",
      unsubscribed_at: requestedAt,
      unsubscribe_reason: reason,
    });
    await tx.insert("audit_log", {
      brand_id: brandId,
      actor_type: "human",
      actor_id: subscriberId,
      action: "unsubscribe",
      target_type: "subscriber",
      target_id: subscriberId,
      payload: { source, reason },
    });
  });

  // Send goodbye confirmation email (one final email is GDPR-compliant)
  await sendGoodbyeEmail(subscriberId, brandId);
}
```

**Critical:** Unsubscribe must take effect immediately. A subscriber who unsubscribes at 6:31 AM must not receive a 6:35 AM scheduled send. Send orchestration checks subscriber status at queue-time, not at schedule-time.

## Segmentation Engine

Segments are named groups of subscribers within a brand. Two types: static and dynamic.

### Static Segments

A static segment is an explicit list of subscriber IDs. Defined once, doesn't change unless subscribers are added/removed manually.

Use cases: VIP lists, beta testers, manually curated cohorts.

Defined via the admin UI or via API call to `POST /api/<brand-slug>/segments`.

### Dynamic Segments

A dynamic segment is a query definition. Membership is computed at evaluation time.

**Query definition:**

```typescript
{
  filters: Array<{
    field: string,                      // "subscribed_at", "custom_fields.advisor_type", "engagement_score"
    operator: "=" | "!=" | "<" | ">" | "<=" | ">=" | "in" | "contains" | "exists",
    value: unknown,
  }>,
  combinator: "and" | "or",
}
```

Example:

```typescript
{
  filters: [
    { field: "status", operator: "=", value: "active" },
    { field: "subscribed_at", operator: ">", value: "2026-01-01" },
    { field: "custom_fields.advisor_type", operator: "in", value: ["solo", "rising_star"] },
  ],
  combinator: "and",
}
```

**Evaluation:** At send-time, the dynamic segment query is translated to SQL and executed against the subscriber list. Membership is computed fresh; no materialization needed.

For very large lists where evaluation latency matters, segments can be materialized on a schedule (`segment_memberships` table). Implementation choice deferred — start without materialization, add it if/when query latency becomes a problem.

### Segment Operations

```typescript
// Get current member count
const count = await segmentEngine.countMembers({ brandId, segmentId });

// Get full member list (paginated)
const members = await segmentEngine.getMembers({ brandId, segmentId, page, pageSize });

// Add subscribers to a static segment
await segmentEngine.addToStaticSegment({ brandId, segmentId, subscriberIds });

// Remove subscribers from a static segment
await segmentEngine.removeFromStaticSegment({ brandId, segmentId, subscriberIds });
```

## Send Orchestration

The path from "approved episode" to "delivered emails."

### Send Lifecycle

```
[scheduled] → [sending] → [sent | failed | cancelled]
```

**`scheduled`** — Send is created with a future `scheduled_at` timestamp. Episode is approved, send window has not yet arrived.

**`sending`** — Send is in progress. Resend is processing the broadcast.

**`sent`** — Send completed. Recipients have been queued by Resend. Events are flowing in.

**`failed`** — Send failed. Cause logged. Retry decision is human-driven; the platform does not auto-retry failed sends (the failure mode is rare and the consequences of duplicate sends are worse than late sends).

**`cancelled`** — Send was scheduled but cancelled before execution. No emails went out.

### Scheduling a Send

Triggered from the review UI when a draft is approved with a "Schedule for [time]" action.

```typescript
async function scheduleSend({
  brandId, episodeId, segmentId, scheduledAt, subjectLine, fromEmail, fromName, replyTo,
}: ScheduleSendRequest) {
  // Validate
  await validateEpisodeApproved(brandId, episodeId);
  await validateScheduledTime(scheduledAt);  // Must be future
  await validateSendingDomainConfigured(brandId, fromEmail);

  // Insert sends row
  const send = await db.insert("sends", {
    brand_id: brandId,
    episode_id: episodeId,
    segment_id: segmentId,
    scheduled_at: scheduledAt,
    status: "scheduled",
    subject_line: subjectLine,
    from_email: fromEmail,
    from_name: fromName,
    reply_to: replyTo,
  });

  // Enqueue execution
  await enqueueSendExecution({ sendId: send.id, executeAt: scheduledAt });

  return send;
}
```

The execution queue is implemented as scheduled jobs (Railway cron triggers a worker every minute that picks up sends due in the next minute) or via a queue service. Implementation choice deferred — the simpler scheduled-job approach is fine for v1.

### Executing a Send

When `scheduled_at` is reached:

```typescript
async function executeSend(sendId: string) {
  const send = await db.get("sends", sendId);

  // Mark as sending
  await db.update("sends", sendId, { status: "sending" });

  try {
    // Compute final recipient list at execution time (NOT at scheduling time)
    const recipients = await computeRecipientList(send);

    // Compute final subject line and any per-recipient personalization at execution time
    const variants = await computeSendVariants(send, recipients);

    // Resolve the active provider for this brand from platform_config
    const provider = await getDistributionProvider(send.brand_id);

    // Push to the active provider via the abstraction
    const broadcast = await provider.createBroadcast({
      brandId: send.brand_id,
      fromName: send.from_name,
      fromEmail: send.from_email,
      replyTo: send.reply_to,
      subjectLine: send.subject_line,
      html: send.episode.html,
      recipients,
      customHeaders: {
        "List-Unsubscribe": `<${unsubscribeHeaderValue(send.brand_id, recipients)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [
        { name: "brand_id", value: send.brand_id },
        { name: "episode_id", value: send.episode_id },
        { name: "send_id", value: send.id },
      ],
    });

    // Update sends row with the provider's broadcast identifier
    await db.update("sends", sendId, {
      status: "sent",
      sent_at: new Date(),
      provider_name: broadcast.providerName,         // "resend" in v1
      provider_broadcast_id: broadcast.providerBroadcastId,
      recipient_count: recipients.length,
    });

  } catch (err) {
    await db.update("sends", sendId, {
      status: "failed",
      error_summary: err.message,
    });
    await alertOnSendFailure(send, err);
    throw err;
  }
}
```

### Recipient List Computation

The recipient list is computed at execution time, not scheduling time. This matters because:

- Subscribers may have unsubscribed between scheduling and execution
- New subscribers may have joined and should be included if the segment is dynamic
- The suppression list may have grown
- Bounces may have moved subscribers to ineligible status

```typescript
async function computeRecipientList(send: Send): Promise<Recipient[]> {
  let baseList: Subscriber[];

  if (send.segment_id) {
    baseList = await segmentEngine.getMembers({
      brandId: send.brand_id,
      segmentId: send.segment_id,
    });
  } else {
    // No segment = all active subscribers for this brand
    baseList = await db.query("subscribers", {
      where: { brand_id: send.brand_id, status: "active" },
    });
  }

  // Filter out anyone in suppression list (global checks too)
  const suppressed = await db.query("suppression_list", {
    where: { email: { in: baseList.map(s => s.email) }, global: true },
  });
  const suppressedEmails = new Set(suppressed.map(s => s.email));

  return baseList
    .filter(s => s.status === "active")  // Re-check status
    .filter(s => !suppressedEmails.has(s.email))
    .map(s => ({
      subscriber_id: s.id,
      email: s.email,
      name: s.name,
      custom_fields: s.custom_fields,
    }));
}
```

### Send Cancellation

A scheduled send can be cancelled before execution:

```typescript
async function cancelSend(sendId: string, reason: string, cancelledBy: string) {
  const send = await db.get("sends", sendId);

  if (send.status !== "scheduled") {
    throw new Error("Cannot cancel send that is not in scheduled status");
  }

  await db.update("sends", sendId, {
    status: "cancelled",
  });

  await db.insert("audit_log", {
    brand_id: send.brand_id,
    actor_type: "human",
    actor_id: cancelledBy,
    action: "cancel_send",
    target_type: "send",
    target_id: sendId,
    payload: { reason },
  });

  // Remove from execution queue if implemented as a queue
  await dequeueSendExecution(sendId);
}
```

After execution begins (`status: sending`), cancellation is no longer possible. Resend's broadcast API does not support post-send cancellation; the emails are in flight.

## Sending Domain Management

Each brand needs its own verified sending domain. This isolates sender reputation between brands and gives each brand control over its identity.

### Domain Configuration Per Brand

Defaults at launch:

| Brand | Sending Domain | From Address |
|-------|----------------|--------------|
| Castor Abbott | mail.castorabbott.com | hello@mail.castorabbott.com |
| Cortex | mail.cortex.com (or chosen) | hello@mail.cortex.com |
| Fidelon | mail.fidelon.com | hello@mail.fidelon.com |
| Treasure Financial | mail.treasurefinancial.com | hello@mail.treasurefinancial.com |

Each brand verifies its own sending domain through the active distribution provider. DKIM, SPF, and DMARC records are configured per domain. Reputation accumulates per domain — if Brand A has deliverability problems, Brand B is unaffected.

In v1, all four brands verify through Resend. If a brand later migrates to SES, that brand's domain gets verified in SES alongside Resend during the warm-up period.

### Domain Verification

The provider abstraction exposes domain verification. The platform admin UI can show domain status for each brand:

```typescript
const provider = await getDistributionProvider(brandId);
const domainStatus = await provider.getDomainStatus(domainId);
// { status: "verified" | "pending" | "failed", dnsRecords: [...] }
```

The `dnsRecords` array contains the DNS records the brand needs to add (DKIM, SPF, DMARC, return-path). Format is normalized across providers — the same shape is returned whether the active provider is Resend or SES.

Setup is one-time per brand, executed during onboarding. Documented in the runbook.

### Reputation Monitoring

The provider abstraction exposes deliverability metrics per domain. The platform monitors:

- Delivery rate (delivered / sent)
- Bounce rate
- Complaint rate
- Spam folder placement (where measurable)

Thresholds trigger alerts:

- Bounce rate > 5% → warning
- Bounce rate > 10% → critical, pause sends pending review
- Complaint rate > 0.1% → warning
- Complaint rate > 0.3% → critical, pause sends pending review

These thresholds reflect industry deliverability standards. Crossing them causes automatic send pauses with admin notification — better to pause and investigate than to keep sending and watch reputation degrade.

## Webhook Event Ingestion

Every event from the active distribution provider flows through a webhook handler that captures, attributes, and persists the event in the platform's canonical shape.

### Webhook Handler

**Endpoint:** `POST /api/webhooks/{provider}` — e.g., `/api/webhooks/resend` in v1, `/api/webhooks/ses` if SES is added later. Different providers can post to different endpoints; the platform may receive events from multiple providers simultaneously during a migration window.

**Implementation:** Either a Supabase Edge Function or a Railway worker route. Choose based on observability preference (Railway logs are richer, Edge Functions are zero-infra). Decision deferred.

**Critical behaviors:**

1. **Verify signature via the provider adapter.** Each provider has its own signature scheme. The provider's `verifyWebhookSignature` method handles this. Reject any request that fails verification.
2. **Idempotency.** Providers may retry webhook deliveries. Use the provider's event ID (returned in `NormalizedEvent.providerEventId`) as a deduplication key. Reject duplicates silently.
3. **Normalize via the provider adapter.** The provider's `parseWebhookEvent` method translates the raw provider payload into a `NormalizedEvent`. Application code only ever sees normalized events — provider-specific shapes never leak past the adapter.
4. **Fast acknowledgment.** Return 200 OK within 5 seconds. Heavy processing happens in a background job after the row is inserted. If processing fails, the row exists; reprocessing is straightforward.
5. **Logged on receipt and on processing.** Two log events per webhook: receipt (with full payload) and processing outcome.

```typescript
async function handleProviderWebhook(req: Request, providerName: ProviderName) {
  const provider = await getProviderByName(providerName);

  const signature = req.headers[provider.signatureHeaderName];
  const payload = await req.text();
  const secret = await getProviderWebhookSecret(providerName);

  if (!provider.verifyWebhookSignature(payload, signature, secret)) {
    logger.warn("invalid_webhook_signature", { provider: providerName, ip: req.ip });
    return new Response("Invalid signature", { status: 403 });
  }

  const rawPayload = JSON.parse(payload);
  const event = provider.parseWebhookEvent(rawPayload);

  // Idempotency check
  const existing = await db.query("send_events", {
    where: { provider_event_id: event.providerEventId, provider_name: event.providerName },
  });
  if (existing.length > 0) {
    return new Response("OK (duplicate)", { status: 200 });
  }

  // Insert normalized event row
  await db.insert("send_events", {
    send_id: lookupSendIdFromEvent(event),
    brand_id: event.brandId,
    subscriber_id: lookupSubscriberId(event.brandId, event.subscriberEmail),
    event_type: event.eventType,
    event_at: event.occurredAt,
    received_at: new Date(),
    provider_name: event.providerName,
    provider_event_id: event.providerEventId,
    click_url: event.clickUrl,
    click_section: parseClickSection(event.clickUrl),
    bounce_type: event.bounceType,
    raw_payload: rawPayload,
  });

  // Trigger async processing
  await enqueueEventProcessing(event);

  return new Response("OK", { status: 200 });
}
```

The handler is provider-aware in routing only. All provider-specific logic (signature verification, payload parsing, field mapping) is encapsulated in the adapter. Adding SES later means: implement `SESProvider.verifyWebhookSignature` and `parseWebhookEvent` to handle the SNS-wrapped event format, register a new endpoint at `/api/webhooks/ses`, no other changes.

### Click Section Attribution

Email links carry a tracking parameter identifying which section they came from. The webhook handler parses this to populate `send_events.click_section`.

The HTML generator (in `04_content_pipeline`) injects these parameters at render time:

```html
<!-- Original link in episode JSON -->
<a href="https://example.com/article">Read more</a>

<!-- After HTML generator injection -->
<a href="https://example.com/article?utm_source=newsletter&utm_medium=email&utm_campaign=brand_id&_section=cover_story&_episode=episode_id">Read more</a>
```

The `_section` parameter identifies the originating section. Parsing happens at webhook receipt:

```typescript
function parseClickSection(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("_section");
  } catch {
    return null;
  }
}
```

### Event Types Handled

| Event | Action |
|-------|--------|
| `delivered` | Insert event row. No further action. |
| `opened` | Insert event row. Aggregate to subscriber engagement score. |
| `clicked` | Insert event row with `click_section` attribution. Trigger content concept attribution. |
| `replied` | Insert event row. Trigger reply parsing pipeline. |
| `complained` | Insert event row. Auto-add to suppression list (global). Mark subscriber as `complained`. |
| `bounced` | Insert event row. If hard bounce, mark subscriber as `bounced`. |
| `unsubscribed` | Insert event row. Trigger unsubscribe flow. |
| `failed` | Insert event row. Log for investigation. |

### Performance Attribution to the Brain

The brain (defined in `05_brain_and_learning`) consumes events via the `performance_observations` table. The flow:

1. Webhook handler inserts `send_events` row.
2. A scheduled job (every 5 minutes) reads new `send_events` and produces `performance_observations` rows by joining through `sends → episodes → episode_sections → framework_content_usage`.
3. Performance score recomputation runs every 6 hours, reading from `performance_observations`.

The scheduled-job approach (rather than Postgres triggers or webhook-time inline processing) is chosen for simplicity and observability. If real-time attribution becomes a requirement, the architecture supports moving to triggers.

## Reply Parsing & Routing

Replies are signal. Subscribers replying to a newsletter email are giving the system data about engagement, complaints, content suggestions, and unsubscribe requests. The platform treats replies as first-class events.

### Reply Inbox Configuration

Each brand has a reply-handling email address (e.g., `replies@mail.castorabbott.com`). Resend forwards received replies to a webhook endpoint configured in the brand's domain.

Alternatively, brands can use a third-party inbound email parser (e.g., Postmark Inbound, Mailgun Routes) if Resend's inbound capabilities aren't sufficient. Implementation choice deferred — Resend's roadmap likely covers this; if not, a third-party parser is a small integration.

### Reply Classification

Inbound emails are classified into intent categories:

```typescript
type ReplyClassification =
  | "engagement"           // Positive engagement, agreement, expansion
  | "complaint"            // Complaint about content, frequency, or sender
  | "unsubscribe_request"  // "Please unsubscribe me" or similar
  | "question"             // Specific question requiring response
  | "suggestion"           // Content suggestion, topic request
  | "other";               // Uncategorized
```

**Block: `reply_classifier`**

Input:

```typescript
{
  brandId: string,
  fromEmail: string,
  subject: string,
  body: string,
  inReplyToSendId: string | null,  // If derivable from headers/threading
}
```

Output:

```typescript
{
  classification: ReplyClassification,
  confidence: number,                    // 0-1
  extracted_intent: string,              // Brief summary of what the reply is asking/saying
  suggested_action: "auto_reply" | "queue_for_human" | "auto_unsubscribe" | "log_only",
  flags: string[],                       // E.g., "contains_pii", "negative_sentiment_high"
}
```

**Voice modules composed:** `core/llm-output-discipline` plus a reply-classifier-specific module.

**Model role:** `reply.classifier`. Default: Sonnet 4.5 at temperature 0, reasoning disabled.

### Routing by Classification

| Classification | Action |
|----------------|--------|
| `engagement` | Log to brain as positive signal for the episode. Flag interesting replies for Mark to optionally respond to in the admin UI. |
| `complaint` | Queue for human review in the admin UI. Do not auto-respond. Update subscriber engagement score downward. |
| `unsubscribe_request` | Auto-process via `unsubscribeSubscriber()`. Send confirmation email. Log in audit. |
| `question` | Queue for human review with high priority. Optionally surface suggested response (drafted by LLM but never auto-sent). |
| `suggestion` | Log to brain as content signal. Surface in admin UI for Mark's review. |
| `other` | Log only. Surface in admin UI for manual triage. |

**Critical:** The platform never auto-responds to replies in v1. Auto-unsubscribe is the one exception (it's an unambiguous request requiring no judgment). Everything else routes to humans. The risk of an LLM auto-responding poorly to a subscriber complaint is much greater than the cost of human triage.

### Reply Storage

All replies are stored in `send_events` with `event_type = 'replied'`, `reply_content` (truncated if very long), `reply_classification`, and full payload in `raw_payload`. PII (signatures, phone numbers, etc.) is preserved for context but flagged for handling per privacy policy.

## Suppression List Management

The `suppression_list` table (defined in `02_data_model`) is the do-not-send list. Cross-brand by default — a complaint from Brand A blocks Brand B unless explicitly overridden.

### Auto-Suppression Triggers

| Trigger | Suppression |
|---------|-------------|
| Spam complaint received | Global, permanent |
| Hard bounce detected | Brand-specific, can be unblocked manually |
| Unsubscribe with "remove from all brands" preference | Global, permanent |
| Manual admin action | Per request, with audit |

### Pre-Send Filtering

Every send execution filters the recipient list against the suppression list. Globally suppressed emails are excluded regardless of brand. Brand-specific suppressions are excluded only for that brand.

The check happens at send execution time, not at subscription time. This is critical — the suppression list grows continuously, and an email subscribed last month and complained-from another brand last week must be excluded.

### Manual Suppression Management

Admin UI exposes:
- Search the suppression list by email
- Add to suppression list (with reason, scope: global vs brand-specific)
- Remove from suppression list (only for hard bounces; complaints and manual suppressions are permanent)
- View suppression history per email

## Compliance Enforcement

Compliance is encoded in the data model and enforced operationally, not left to "remember to do this."

### CAN-SPAM Requirements

| Requirement | Implementation |
|-------------|----------------|
| Accurate "From" line | Per-brand `fromEmail` and `fromName` configured and validated. No misleading sender names. |
| Truthful subject lines | Editorial responsibility; no auto-enforcement, but flagged in review if obviously misleading. |
| Identification as advertisement (where applicable) | Editorial responsibility; not generally applicable to newsletter content. |
| Physical postal address in every email | Required field in brand configuration. Enforced at template-render time — sends fail if address is missing. |
| Clear unsubscribe mechanism | One-click List-Unsubscribe header + footer link, both required by sending logic. |
| Honor unsubscribes within 10 days | Auto-honored within minutes via the unsubscribe flow. |
| No misleading transmission information | Resend handles routing; sender authentication via DKIM/SPF/DMARC. |

### GDPR (Where Applicable)

For subscribers in EU jurisdictions:

| Requirement | Implementation |
|-------------|----------------|
| Lawful basis for processing | Consent record stored on `subscribers.consent_record`. |
| Consent must be specific, informed, freely given | Signup flow captures: timestamp, IP, user agent, consent text exactly as shown. |
| Right to access | Admin UI exposes "export subscriber data" — generates a JSON file with all data for that subscriber across all events. |
| Right to erasure | Admin UI exposes "delete subscriber data" — soft-deletes the subscriber and anonymizes events (replaces email with hash). |
| Data portability | Same as right to access. |
| Consent withdrawal | Standard unsubscribe flow. |

GDPR jurisdiction is determined heuristically (subscriber's signup IP geolocation) and stored on the subscriber record. The platform applies GDPR provisions to all EU subscribers regardless of where the brand is registered.

### Per-Brand Compliance Configuration

Some compliance choices are per-brand:

```typescript
{
  key: "compliance.config",
  brand_id: "castor_abbott",
  value: {
    require_double_opt_in: false,        // True for stricter brands
    physical_address: "...",             // Required for CAN-SPAM
    privacy_policy_url: "https://...",
    terms_of_service_url: "https://...",
    sender_jurisdiction: "US",
    gdpr_default_handling: "auto",       // auto | manual
  },
}
```

Fidelon, given its regulatory positioning, may have stricter defaults (always double opt-in, manual GDPR review). Castor Abbott may have looser (single opt-in, auto-handling).

## Performance Tracking & Analytics

Real-time aggregation queries against `send_events` produce the analytics that inform the learning loop and the human dashboard.

### Per-Send Metrics

Computed for every send within minutes of completion:

```typescript
{
  send_id: string,
  recipients: number,
  delivered: number,
  delivery_rate: number,
  unique_opens: number,
  open_rate: number,
  unique_clicks: number,
  click_through_rate: number,
  click_to_open_rate: number,           // CTR / open rate
  replies: number,
  reply_rate: number,
  unsubscribes: number,
  unsubscribe_rate: number,
  complaints: number,
  complaint_rate: number,
  bounces: number,
  bounce_rate: number,
  section_engagement: Record<string, {  // Per-section click attribution
    clicks: number,
    unique_clickers: number,
  }>,
}
```

These metrics live in a materialized view (`send_metrics`) refreshed every 5 minutes. The admin UI reads from this view for the performance dashboard. The brain consumes from `performance_observations` (computed from the same source events).

### Per-Subscriber Engagement Scores

A rolling engagement score per subscriber, updated as events come in:

```typescript
engagement_score = w1 * (recent_open_rate) +
                   w2 * (recent_click_rate) +
                   w3 * (recent_reply_rate) -
                   w4 * (recent_inactivity)
```

Weights configurable via `platform_config`. The score informs:

- Dynamic segments (e.g., "highly engaged subscribers")
- Re-engagement campaigns (subscribers with declining scores)
- Persona calibration (which subscribers correlate with which personas)
- Churn risk identification

## Data Model Implications

The provider abstraction implies small additions to the `sends` and `send_events` schemas defined in `02_data_model`. These should be added in the same migration sequence:

```sql
-- sends table additions
ALTER TABLE sends
  RENAME COLUMN resend_broadcast_id TO provider_broadcast_id;
ALTER TABLE sends
  ADD COLUMN provider_name text NOT NULL DEFAULT 'resend';

-- send_events table additions
ALTER TABLE send_events
  ADD COLUMN provider_name text NOT NULL DEFAULT 'resend',
  ADD COLUMN provider_event_id text;
CREATE UNIQUE INDEX idx_send_events_provider_dedup
  ON send_events (provider_name, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
```

The `provider_event_id` column with the unique index is what enforces idempotency — duplicate webhook deliveries cannot create duplicate event rows even if they arrive seconds apart.

`02_data_model` should be updated to reflect these columns in the canonical schema definitions.

## Open Decisions for the Dev Team

- **Whether to use Supabase Edge Functions or Railway worker for webhook handling:** Both work. Lean toward Railway for richer logs, accept Edge Functions for zero-infra simplicity. Decide by week 1.
- **Whether to materialize segment memberships:** Not in v1. Add if/when query latency exceeds 500ms.
- **Specific double-opt-in template design:** Per brand, designed in React Email. Implementation detail.
- **Whether to use Resend's inbound email parsing or a third-party (Postmark, Mailgun):** Check Resend's current capabilities at implementation time. If incomplete, use Postmark Inbound. Code path through `reply_classifier` is identical regardless.
- **Specific implementation of physical address compliance:** Per-brand config row. Template rendering enforces.
- **GDPR jurisdiction determination strategy:** IP-geolocation at signup, refined by self-declaration if user provides country. Mark as TBD-improve in production.
- **Whether to support custom domains for unsubscribe links:** v1 uses a platform-managed domain. Custom domains are a Phase 5+ feature.
- **When to begin SES adapter work:** Deferred to Phase 6+ unless cost or commercial requirements force it earlier. The architecture supports it; the implementation is not Phase 1-5 work.

## Acceptance Criteria

The distribution platform is complete when:

**Provider abstraction:**

- [ ] `DistributionProvider` interface defined in `@platform/distribution`.
- [ ] `NormalizedEvent` and other canonical shapes defined.
- [ ] `ResendProvider` adapter implemented and passing all interface compliance tests.
- [ ] No code outside `packages/distribution/src/providers/resend.ts` imports the `resend` npm package. Lint rule enforces this.
- [ ] Provider factory reads `platform_config` and returns the correct provider per brand.
- [ ] A mock provider exists for tests; integration tests use the mock and pass without any Resend API calls.
- [ ] `sends` and `send_events` schemas include `provider_name` and `provider_broadcast_id`/`provider_event_id` columns.
- [ ] The unique index on `(provider_name, provider_event_id)` enforces idempotency.
- [ ] An ADR captures the decision to use Resend in v1 with SES as a documented future migration path.

**Operational capability:**

- [ ] All four brands have verified sending domains through the active provider with DKIM/SPF/DMARC records validated.
- [ ] The `subscribers` table CRUD operations work via API and admin UI.
- [ ] Signup endpoint exists per brand with rate limiting and double-opt-in support.
- [ ] Confirmation endpoint exists with token validation and 7-day expiry.
- [ ] Unsubscribe flow works via all four paths (List-Unsubscribe header, footer link, reply, admin action).
- [ ] Static and dynamic segments are creatable, queryable, and usable in send orchestration.
- [ ] Send scheduling and execution works end-to-end with at least one test send to a small list.
- [ ] Recipient list computation happens at execution time, not scheduling time. Verified with a test where a subscriber unsubscribes between schedule and execute.
- [ ] Send cancellation works for scheduled sends and is blocked for sending/sent sends.
- [ ] Webhook handler verifies signatures via the provider adapter, enforces idempotency, and acknowledges within 5 seconds.
- [ ] All event types (`delivered`, `opened`, `clicked`, `replied`, `complained`, `bounced`, `unsubscribed`, `failed`) are correctly normalized and persisted to `send_events`.
- [ ] Click section attribution works: clicks on links in the Cover Story produce `send_events` with `click_section = 'cover_story'`.
- [ ] Performance attribution from `send_events` to `performance_observations` runs as a scheduled job every 5 minutes and produces correct attributions.
- [ ] Reply classifier categorizes replies into the 6 categories with reasonable accuracy on a held-out test set.
- [ ] Reply routing executes correctly: unsubscribe requests auto-process, complaints queue for human review, engagement signals log to brain.
- [ ] Suppression list filters every send at execution time. A complainted email cannot receive a subsequent send.
- [ ] Auto-suppression triggers fire correctly for complaints, hard bounces, and manual suppressions.
- [ ] CAN-SPAM physical address renders in every email; sends without configured address fail at render time.
- [ ] GDPR right-to-access produces a complete JSON export of subscriber data.
- [ ] GDPR right-to-erasure soft-deletes the subscriber and anonymizes their events.
- [ ] Per-send metrics are computed within 5 minutes of send completion and surfaced in the admin UI.
- [ ] Reputation monitoring fires alerts at the documented thresholds (bounce rate, complaint rate).
- [ ] An integration test verifies the full path: signup → confirm → send → open → click → attribution → brain performance update.

---

**Next:** Read `07_experiment_framework.spec.md` for the experimentation primitives — framework experiments, content experiments, statistical design, and the 50-variant micro-test pattern.
