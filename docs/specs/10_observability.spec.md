---
spec: 10_observability
title: Observability, Logging & Alerting
version: 1.0
status: draft
audience: dev_team, agentic_orchestrator, platform_admins
dependencies:
  - 00_overview
  - 01_foundation
  - 02_data_model
  - 04_content_pipeline
  - 05_brain_and_learning
  - 06_distribution_platform
  - 07_experiment_framework
  - 09_optimization_policies
consumed_by:
  - 11_deployment
  - 12_migration_plan
purpose: Define the observability stack — structured logging schema, metrics, dashboards, alerting. The operational visibility that makes the autonomous system debuggable. Answer "what happened and why" in seconds, not hours.
---

# Observability, Logging & Alerting

## What This Spec Covers

The operational visibility layer. Every LLM call, every block execution, every send, every event, every policy decision — logged with enough structure that an operator can answer "what happened and why" by writing a query, not by reading through walls of text.

Specifically: the structured log schema, the metrics taxonomy, the dashboards that ship with v1, the alerting rules and escalation paths, the cost tracking that makes per-brand and per-block economics visible, and the query patterns operators will use most often.

This spec does not cover the underlying log aggregation infrastructure (Railway and Vercel both provide log access; Supabase Logs handle DB-level events) or the choice of metrics platform — those are deployment concerns covered in `11_deployment`. This spec covers what we log, how we structure it, and what we expect to be able to answer.

## Why This Matters

The current MindStudio system is a black box when something goes wrong. Debugging requires reading run logs by hand, correlating across multiple workflow files, and reverse-engineering what happened. The Gemini reasoning leak took hours to diagnose. The Savannah-five-times bug required manual cross-referencing of timestamps and concept records.

A platform that operates autonomously needs the inverse property: every event leaves a forensic trail rich enough that the question "why did the system do this?" gets answered in seconds. Without that property, the autonomy becomes terrifying. With it, the autonomy becomes safe to scale.

Three principles shape the observability design:

**Structured over freeform.** Every log line is structured JSON with typed fields. Searching for "all Hosts Corner failures in the last 30 days" is a SQL query against indexed columns, not a regex against log files.

**Atomic over aggregate.** Every block execution is one row. Every LLM call is one row. Every send event is one row. Aggregations happen at query time. We never lose granular detail by pre-aggregating at write time.

**Self-explaining.** Logs include enough context that the reader doesn't need to cross-reference five other tables to understand what happened. A `block_executions` row has the run_id, brand_id, block name, model used, input/output payloads, error context, cost, timing — all in one place. Reading the row tells you the story.

## Logging Architecture

### Three Layers

**Application logs.** Structured JSON emitted by application code via `@platform/observability`. These flow to stdout in production; Railway and Vercel capture them. Retention is platform-dependent (typically 7-30 days for Railway, 1 day for Vercel function logs unless extended).

**Database event records.** Structured records in Supabase tables. These are the canonical, queryable, indefinite-retention store. Every consequential event (pipeline run, block execution, send, event, policy decision, approval) writes a row. Application logs are operational; database event records are forensic.

**Infrastructure metrics.** Resource utilization, request counts, error rates from Railway, Vercel, Supabase, and the LLM providers. These come from the platform-native dashboards; we don't replicate them.

The most important layer for debugging the autonomous system is layer 2 — the database event records. The other two are supporting infrastructure.

### The `@platform/observability` Package

Every application log goes through this package. The public API is small:

```typescript
import { logger, metric, span } from "@platform/observability";

// Structured log events
logger.info("block_started", {
  block_name: "cover_story_research",
  run_id: "...",
  brand_id: "castor_abbott",
});

logger.warn("schema_validation_retry", {
  block_name: "fact_checker",
  run_id: "...",
  retry_count: 1,
  validation_error: "Required field 'sources' missing",
});

logger.error("pipeline_run_failed", {
  run_id: "...",
  error_code: "llm.generation_failed",
  error_message: "...",
  block_name: "writer_latte",
});

// Counter metrics
metric.increment("llm_call", { provider: "anthropic", model: "claude-sonnet-4.5" });
metric.increment("send_failure", { brand_id: "castor_abbott", reason: "deliverability_breach" });

// Timing metrics
metric.timing("block_duration_ms", 4830, { block_name: "research_latte", brand_id: "castor_abbott" });

// Operation spans (auto-time, auto-log start and end)
const result = await span("destination_validator", async () => {
  // ... block logic
}, { run_id: "...", brand_id: "castor_abbott" });
```

### Log Format Standard

Every log line is one JSON object on one line. Required fields:

- `timestamp` — ISO 8601 UTC
- `level` — `debug` | `info` | `warn` | `error`
- `event` — short snake_case event name
- `service` — which app emitted it (`pipeline`, `review-ui`, `webhook-handler`)

Required when applicable:

- `run_id` — pipeline run identifier
- `block_name` — which block, if in a block context
- `brand_id` — which brand
- `user_id` — which user, if user-initiated
- `error_code` — stable error code from the typed error hierarchy

Free-form context is allowed but discouraged. If a value is meaningful enough to log, it deserves a typed field name.

```json
{
  "timestamp": "2026-04-29T14:23:45.231Z",
  "level": "warn",
  "service": "pipeline",
  "event": "schema_validation_retry",
  "run_id": "01h8z9k3...",
  "brand_id": "castor_abbott",
  "block_name": "fact_checker",
  "model_role": "weekend.fact_checker",
  "resolved_provider": "anthropic",
  "resolved_model": "claude-sonnet-4-5-20250929",
  "retry_count": 1,
  "validation_error": "Required field 'sources' missing at index 2"
}
```

### What Always Gets Logged

A baseline level of logging that every component implements:

**Pipeline level:**
- `pipeline_started` — run beginning
- `pipeline_completed` — run end with episode_id and total cost/tokens
- `pipeline_failed` — run end with error
- `pipeline_skipped` — variety enforcement, policy violation, or human cancellation
- `advisory_lock_acquired` and `advisory_lock_released`

**Block level:**
- `block_started` — block beginning
- `block_completed` — block end with success status, latency, cost
- `block_retry` — retry attempt with reason
- `block_fallback_used` — fallback model invoked
- `block_validation_failed` — schema validation failure
- `block_failed` — block did not complete

**LLM call level:**
- `llm_call_started` — request to provider
- `llm_call_completed` — response received with token counts and cost
- `llm_call_failed` — provider error
- `llm_call_resolved_role` — for hot-swappable model resolution, log which model the role mapped to

**Brain level:**
- `concept_extracted` — content or framework concept extraction
- `duplicate_detected` — exclusion query rejected a proposal
- `framework_promoted` — experimental → active
- `framework_deprecated` — active → deprecated
- `learning_generated` — analyzer produced a learning
- `learning_applied` — learning's action took effect

**Distribution level:**
- `send_scheduled`
- `send_executing`
- `send_completed`
- `send_failed`
- `send_event_received` — webhook event arriving
- `send_event_attributed` — performance observation written
- `subscriber_unsubscribed`
- `complaint_received`
- `bounce_recorded`

**Policy level:**
- `policy_evaluated` — every policy evaluation with decision and reasons
- `approval_required` — approval queue item created
- `approval_resolved` — human approved or rejected
- `escalation` — agent escalated to human

**Experiment level:**
- `experiment_proposed`
- `experiment_approved`
- `experiment_started`
- `experiment_concluded`
- `experiment_winner_declared`
- `experiment_no_winner` — fallback path taken

This list is not exhaustive but covers the operationally critical events. Adding new events is a normal part of feature development; deprecating events should be deliberate.

## Database Event Records

The forensic layer. Tables defined in `02_data_model` capture structured events. The most important for debugging:

- `pipeline_runs` — one row per pipeline invocation
- `block_executions` — one row per block within a run, with full input/output payloads
- `send_events` — one row per event from the active distribution provider
- `audit_log` — one row per consequential action by humans or agents
- `performance_observations` — one row per attributed engagement event

These tables together enable the queries that operators will run constantly:

- "Show me every Hosts Corner failure in the last 30 days, grouped by failure reason."
- "Why did the pipeline auto-approve framework X promotion last Tuesday?"
- "Which blocks have the highest retry rate this week?"
- "What's the cost trend for the weekend pipeline over the last 90 days?"
- "Show me every policy evaluation that resulted in escalation, by brand."

Every one of these is a SQL query that runs in milliseconds against indexed tables. No log scraping. No regex. No correlation across opaque files.

## Cost Tracking

Cost visibility is non-negotiable. The platform makes hundreds of LLM calls per day across four brands; without cost tracking, economics get away from you.

### Per-Call Cost

Every LLM call records cost in `block_executions.cost_usd`. The LLM client wrapper (per `01_foundation`) computes cost from the provider's token counts and the model's per-million-token pricing. Pricing tables live in `@platform/llm-client/pricing.ts` and update when providers change rates.

### Per-Run Cost

`pipeline_runs.total_cost_usd` aggregates all block costs in the run. Computed at run completion.

### Per-Brand Cost

A scheduled job aggregates costs by brand into a daily summary table:

```sql
CREATE TABLE daily_cost_summary (
  date date NOT NULL,
  brand_id text NOT NULL REFERENCES brands(id),
  total_cost_usd numeric(10, 4) NOT NULL,
  llm_cost_usd numeric(10, 4) NOT NULL,
  embedding_cost_usd numeric(10, 4) NOT NULL,
  send_count int NOT NULL,
  recipients_total int NOT NULL,
  cost_per_recipient_usd numeric(10, 6),
  PRIMARY KEY (date, brand_id)
);
```

This makes per-brand economics queryable in milliseconds.

### Cost Alerts

Configurable per brand:

- Daily cost > 2x rolling average → warning
- Daily cost > 5x rolling average → critical
- Per-pipeline-run cost > 2x median → warning
- Cost trend up >50% week over week → warning

Thresholds live in `platform_config`. Alerts route through the notification system (email, Slack).

### Cost Attribution

The dashboard exposes cost attribution by:

- Brand
- Pipeline (weekday vs weekend)
- Block
- Model role (which roles drive most cost)
- Provider (if multi-provider, which providers cost most)

Cost-per-section attribution is also available — "what does each weekday Tactic cost on average to produce?" — which informs decisions about model role configuration and prompt optimization.

## Dashboards

The platform ships with a set of operational dashboards. These live in the admin UI (per `08_review_interface`) but are detailed here for content.

### Platform Health Dashboard

Default landing for platform admins.

- Pipeline runs in last 24 hours: count, success rate, average duration, average cost
- Active pipelines (in flight): list with progress
- Sends today and this week per brand
- Quality score trend per brand (7-day rolling)
- Active alerts (deliverability, cost, quality, errors)
- Cost summary per brand (today, week, month)

### Pipeline Debugging Dashboard

For investigating pipeline failures.

- Recent failed runs with one-click drill-down
- Per-block error rates over time
- Retry rates per block per model
- Token usage anomalies (blocks consuming unusually high tokens)
- Latency distribution per block

A single failed run drilldown shows: every block, every retry, every LLM call, the input/output of each, the error context, the cost, the timing — all on one page. The page is the answer to "what happened and why this run failed?"

### Brain & Learning Dashboard

Visibility into the autonomous learning behavior.

- Framework library health (active count, experimental count, deprecated count)
- Recent framework promotions and deprecations
- Persona calibration metrics (per-persona prediction accuracy)
- Variety enforcement statistics (was the exploration budget met? cluster prevention triggers?)
- Pending learnings count and resolution rate
- Cross-brand patterns (platform admin only)

### Distribution Health Dashboard

Operational visibility for the sending infrastructure.

- Recent sends with status (scheduled, sending, sent, failed)
- Per-send metrics summary (open rate, click rate, etc.)
- Deliverability metrics per brand (delivery rate, bounce rate, complaint rate)
- Sending domain status per brand (DKIM/SPF/DMARC verified)
- Webhook event ingestion rate (events received, events processed, lag)
- Suppression list growth

### Cost Dashboard

Per-brand economics.

- Daily cost trend (30-day rolling)
- Cost-per-send by brand
- Cost-per-recipient by brand
- Block cost breakdown
- Model role cost breakdown
- Cost vs revenue (if revenue tracking is added later)

### Audit Dashboard

For compliance and forensic review.

- Recent policy evaluations with decisions and reasons
- Recent approvals (who approved what)
- Recent rejections (who rejected what, with notes)
- Recent escalations
- Voice config and module changes

## Alerting

The platform alerts on operational issues. Alerts route through configured channels (email, Slack) per brand admin preferences.

### Alert Categories

**Critical alerts** — operational problems requiring immediate attention:

- Pipeline failure (a scheduled run did not produce an episode)
- Send failure (a scheduled send did not execute)
- Deliverability threshold breach (bounce or complaint rate above critical threshold)
- Daily cost above critical threshold
- Webhook ingestion lag > 1 hour
- Database connection failures
- LLM provider extended outage (multiple consecutive failures across providers)

**Warning alerts** — issues that need attention but aren't immediately operational:

- Quality score regression (consistent degradation over multiple sends)
- Block retry rate elevated
- Daily cost above warning threshold
- Pending learnings backlog (unaddressed approvals)
- Persona calibration degradation
- Webhook signature failures (potential security issue)

**Informational alerts** — periodic reports, not action-required:

- Daily summary digest per brand
- Weekly performance summary
- Monthly cost report

### Alert Configuration

Alerts are configured via `platform_config`:

```typescript
{
  key: "alerts.config",
  brand_id: "castor_abbott",
  value: {
    channels: {
      slack: "https://hooks.slack.com/...",
      email: ["mark@castorabbott.com"],
    },
    thresholds: {
      cost_warning_multiplier: 2.0,
      cost_critical_multiplier: 5.0,
      bounce_rate_warning: 0.05,
      bounce_rate_critical: 0.10,
      complaint_rate_warning: 0.001,
      complaint_rate_critical: 0.003,
      block_retry_rate_warning: 0.20,
    },
    digest_schedule: {
      daily: "08:00",
      weekly: "Mon 08:00",
    },
  },
}
```

Brand-specific overrides for thresholds. Different brands have different normal operating parameters.

### Alert Implementation

A scheduled job runs every 5 minutes and checks alert conditions. Triggered alerts insert rows into an `alerts` table:

```sql
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text REFERENCES brands(id),
  category text NOT NULL,                    -- "critical", "warning", "info"
  alert_type text NOT NULL,                  -- e.g., "pipeline_failure", "deliverability_breach"
  status text NOT NULL DEFAULT 'firing',     -- "firing", "acknowledged", "resolved"
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  acknowledged_by uuid REFERENCES users(id),
  context jsonb,                             -- Alert-specific details
  notification_log jsonb,                    -- Which channels notified, when

  CONSTRAINT alerts_category_valid CHECK (category IN ('critical', 'warning', 'info')),
  CONSTRAINT alerts_status_valid CHECK (status IN ('firing', 'acknowledged', 'resolved'))
);

CREATE INDEX idx_alerts_brand_status ON alerts(brand_id, status, triggered_at DESC);
```

Alerts surface in the admin UI. Acknowledging an alert stops further notifications for that specific incident; resolving it marks the issue as handled.

### Deduplication

Alert deduplication prevents notification spam:

- Same alert type firing multiple times within a window: notify once, increment count
- Critical alerts re-notify every hour if not acknowledged
- Warning alerts notify once and surface in dashboard until acknowledged

## Specific Query Patterns

The queries operators will run constantly. Documented here as both expectations and as integration test fodder.

### "Show me every Hosts Corner failure in the last 30 days, grouped by reason"

```sql
SELECT
  COALESCE(error_payload->>'error_code', 'unknown') as error_code,
  COUNT(*) as failure_count,
  MIN(started_at) as first_seen,
  MAX(started_at) as last_seen
FROM block_executions
WHERE block_name = 'hosts_corner_writer'
  AND brand_id = 'castor_abbott'
  AND status = 'failed'
  AND started_at > now() - interval '30 days'
GROUP BY error_code
ORDER BY failure_count DESC;
```

Should return in <100ms with appropriate indexes.

### "Why did the pipeline auto-approve framework X promotion last Tuesday?"

```sql
SELECT
  al.created_at,
  al.action,
  al.payload,
  al.actor_id,
  al.payload->>'matched_policy_id' as policy_used,
  al.payload->>'reasons' as policy_reasons
FROM audit_log al
WHERE al.action = 'policy_evaluated'
  AND al.payload->>'action_class' = 'framework.promote.experimental_to_active'
  AND al.payload->>'framework_id' = '<framework_id>'
  AND al.created_at BETWEEN '<tuesday>' AND '<wednesday>';
```

The full forensic trail of the decision is in the audit log.

### "What's the cost per send for Castor Abbott vs. Treasure Financial over the last quarter?"

```sql
SELECT
  brand_id,
  AVG(total_cost_usd) as avg_cost_per_run,
  AVG(total_cost_usd / NULLIF(recipient_count, 0)) as avg_cost_per_recipient,
  COUNT(*) as run_count
FROM pipeline_runs pr
JOIN sends s ON pr.episode_id = s.episode_id
WHERE pr.brand_id IN ('castor_abbott', 'treasure_financial')
  AND pr.status = 'completed'
  AND pr.started_at > now() - interval '90 days'
GROUP BY brand_id;
```

### "Which blocks are driving the highest retry rates this week?"

```sql
SELECT
  block_name,
  brand_id,
  COUNT(*) FILTER (WHERE retry_count > 0) as retry_count,
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE retry_count > 0)::float / COUNT(*) as retry_rate
FROM block_executions
WHERE started_at > now() - interval '7 days'
GROUP BY block_name, brand_id
HAVING COUNT(*) > 10
ORDER BY retry_rate DESC
LIMIT 20;
```

### "Show me the full execution trail of pipeline run X"

```sql
SELECT
  sequence,
  block_name,
  block_type,
  status,
  retry_count,
  fallback_used,
  validation_status,
  cost_usd,
  latency_ms,
  started_at,
  completed_at
FROM block_executions
WHERE pipeline_run_id = '<run_id>'
ORDER BY sequence;
```

This is the canonical "what happened in this run" query. The admin UI's pipeline debugging dashboard runs this and renders the result.

## Operational Runbooks

Common operational scenarios documented in `docs/runbooks/`. The runbooks are referenced from alerts so when an operator gets paged, they have a guide.

Standard runbooks for v1:

- `pipeline-failure.md` — what to do when a scheduled run fails
- `deliverability-breach.md` — bounce or complaint rate threshold breached
- `cost-spike.md` — daily cost above threshold
- `webhook-ingestion-lag.md` — events not flowing in
- `provider-outage.md` — LLM or distribution provider degraded or down
- `database-connection-issues.md` — Supabase connectivity
- `secret-rotation.md` — rotating API keys and credentials
- `learning-mode-transition.md` — moving a brand between learning modes
- `model-role-update.md` — changing model role configuration
- `disaster-recovery.md` — full system restoration from backup

Each runbook follows the same shape: trigger conditions, immediate response steps, escalation criteria, root cause investigation guidance, post-incident actions.

## Logging Performance

Logging cannot be a bottleneck. The architecture handles this:

- Structured log emission is non-blocking (writes to stdout buffer; OS handles flushing)
- Database event records are written asynchronously where possible (block_executions inserts after the block completes, not during)
- High-cardinality metrics (per-block, per-brand timing) are written to Supabase as time-series data; aggregation happens at query time
- Sampling is not used in v1 (volume is manageable); becomes available if log volume forces it

## Open Decisions for the Dev Team

- **Specific log aggregation tool:** Railway and Vercel logs are sufficient for v1. If volume grows or cross-service correlation becomes painful, evaluate Better Stack, Datadog, or Honeycomb. Defer until pain emerges.
- **Specific metrics platform:** Supabase tables for v1 (works, queryable, cheap). If complex aggregation is needed, evaluate Prometheus + Grafana or platform-native tools.
- **Whether to use OpenTelemetry standards:** Recommended for forward compatibility but adds complexity. Acceptable to use platform-specific patterns in v1 and migrate to OTel later if needed.
- **Specific dashboard implementation:** built into the admin UI per `08_review_interface`, with charts via Recharts or visx. No separate Grafana for v1.
- **Specific alerting tool:** simple custom alerting against `platform_config` thresholds in v1. Move to PagerDuty or similar if on-call rotation becomes a thing.

## Acceptance Criteria

The observability system is complete when:

- [ ] `@platform/observability` package is implemented with `logger`, `metric`, and `span` exports.
- [ ] Every block in the content pipeline emits `block_started` and `block_completed` (or `block_failed`) events.
- [ ] Every LLM call emits `llm_call_completed` with model role, resolved provider/model, token counts, cost, latency.
- [ ] Every pipeline run emits `pipeline_started` and `pipeline_completed` (or `pipeline_failed`).
- [ ] Every block execution writes a `block_executions` row with full metadata.
- [ ] Every pipeline run writes a `pipeline_runs` row with aggregated cost.
- [ ] Daily cost summaries are computed via scheduled job and stored in `daily_cost_summary`.
- [ ] All 5 dashboards (Platform Health, Pipeline Debugging, Brain & Learning, Distribution Health, Cost) are implemented in the admin UI.
- [ ] All documented query patterns return results in <100ms with realistic data volumes (verified with synthetic load test).
- [ ] Alert configuration via `platform_config` works; updating thresholds takes effect on next alert evaluation.
- [ ] Alert evaluation runs every 5 minutes via scheduled job.
- [ ] Notification delivery works for Slack and email channels per brand configuration.
- [ ] Alert deduplication works: same alert type firing repeatedly does not produce notification spam.
- [ ] All 10 standard runbooks exist in `docs/runbooks/`.
- [ ] Alert messages link to the relevant runbook for self-service investigation.
- [ ] An integration test verifies end-to-end forensic capability: a failed pipeline run can be fully reconstructed from `pipeline_runs`, `block_executions`, and `audit_log` without external context.
- [ ] An integration test verifies cost tracking: a synthetic run with known token counts produces correct `total_cost_usd` and correct entries in `daily_cost_summary`.
- [ ] Logs include the resolved model (not just the role) so historical replay reconstructs the actual model used at the time.

---

**Next:** Read `11_deployment.spec.md` for infrastructure, CI/CD, secrets, environments, and the operational deployment of the platform.
