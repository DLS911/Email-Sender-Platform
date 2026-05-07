# Error catalog

Every `PlatformError` carries a stable `code` string. Application code matches on the code, not the class name. Logs include the code so on-call engineers can grep + look up the runbook entry below.

| Code | Class | What happened | First-response runbook |
|---|---|---|---|
| `llm.generation_failed` | `LLMGenerationError` | LLM call exhausted retries on both primary and fallback | Check `block_executions` for the run; see if it's a transient provider outage (try the other provider). If structured output keeps failing validation, the prompt or schema may have drifted. |
| `schema.validation_failed` | `SchemaValidationError` | A Zod schema rejected output that wasn't auto-healable | Inspect `block_executions.output_payload`. If consistent shape error, the prompt instructions need to match the schema. |
| `brain.query_failed` | `BrainQueryError` | pgvector or supabase query failed during a brain operation | Check Supabase health. Verify the embedding model is reachable. If row-level, check the `content_concepts` row for malformed data. |
| `distribution.send_failed` | `DistributionError` | Resend send failed, or webhook signature failed verification | Check Resend status. If webhook signature, verify `RESEND_WEBHOOK_SIGNING_SECRET` matches the configured value in Resend's dashboard. |
| `policy.violation` | `PolicyViolationError` | An action exceeded what `optimization_policies` permit | Check the `audit_log` for the attempted action. Either escalate the action for human approval or update the policy. |
| `pipeline.advisory_lock_failed` | `PipelineError` | Could not acquire the per-brand advisory lock | Another run is in flight for the brand. Wait or cancel the prior run. Locks auto-release after 30 minutes. |
| `pipeline.concept_check_failed` | `PipelineError` | Topic proposer's candidate was blocked by concept check | Expected when topics dupe recently used content. The pipeline should retry with `avoidConcepts` populated. |
| `pipeline.quality_gate_exceeded_revisions` | `PipelineError` | Persona panel never passed within `maxRevisionCycles` | Surface to the reviewer. Either the topic is genuinely off-voice or the persona thresholds need recalibration (per spec 09). |
| `pipeline.fact_check_failed` | `PipelineError` | Fact check found unresolved claims | Inspect the issues array. Common cause: model hallucinated a stat. Re-run with stricter research grounding. |
| `config.invalid` | `ConfigError` | Missing env var or malformed `platform_config` row | Check the env var listed in `context.name`. For platform_config rows, verify the `value` jsonb matches the expected schema (e.g. `ModelRoleConfigSchema`). |

## Adding a new error

1. Define the class in `packages/schemas/src/errors.ts` extending `PlatformError`.
2. Pick a stable `code` string. Format: `<domain>.<specific_failure>` snake_case.
3. Add a row to this table.
4. If the error needs a non-trivial response, write a runbook entry under `docs/runbooks/`.

## Why stable codes

Class names refactor. Codes don't. Application code that retries-on-some-errors-but-not-others matches on the code. Operations dashboards filter on the code. The class name is for IDE convenience only.
