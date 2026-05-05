---
spec: 01_foundation
title: Foundation & LLM Client
version: 1.0
status: draft
audience: dev_team, agentic_orchestrator
dependencies:
  - 00_overview
consumed_by:
  - 02_data_model
  - 03_voice_system
  - 04_content_pipeline
  - 05_brain_and_learning
  - 06_distribution_platform
  - 07_experiment_framework
  - 08_review_interface
  - 09_optimization_policies
  - 10_observability
  - 11_deployment
  - 12_migration_plan
purpose: Define the runtime, repo structure, LLM client wrapper, error handling patterns, and secret management that every other module depends on. First work package. Blocks everything else.
---

# Foundation & LLM Client

## What This Spec Covers

Everything that needs to exist before any other module can be built. Repo structure, language runtime, dependencies, code conventions, the LLM client wrapper, error handling patterns, secret management, observability primitives. This is the substrate.

This spec does not cover business logic, voice modules, or pipeline orchestration. It covers the layer beneath all of that.

## Why This Matters

Most of the bugs in the current MindStudio system are foundation problems, not logic problems. Gemini reasoning leaks happen because there's no JSON-mode safety wrapper. Race conditions happen because there's no atomic state primitive. Hardcoded secrets happen because there's no secret management layer. Context window overflows happen because there's no token-counting before LLM calls.

If we get the foundation right, an entire class of bugs becomes impossible by construction. If we get it wrong, we'll spend Phase 2 onward fighting the same fires we already fought.

The non-negotiable principle: **the foundation must make the right thing easy and the wrong thing hard.** A developer who tries to call an LLM without retry logic should have to work harder than one who uses the wrapper. A developer who tries to embed a secret in code should hit a guardrail before commit.

## Runtime & Language

**TypeScript on Node 22 LTS.** Strict mode. No `any` except at well-defined external boundaries (and even then, validated and narrowed within the first three lines).

Rationale: Node is what MindStudio runs, what Resend's SDK is best supported in, what the dev team is fluent in. TypeScript with strict mode gives us typed contracts at every boundary, which is the architectural principle that prevents the most common AI pipeline bugs.

**No alternative languages in the platform.** Python is not in scope. Go is not in scope. The unified runtime keeps the agent toolchain simple and the deployment surface small.

**Module system: ESM only.** No CommonJS in new code. Top-level `await` allowed. Modern Node features assumed.

## Repo Structure

Single monorepo. Workspace-based. Top-level structure:

```
agentic-newsletter/
├── apps/
│   ├── pipeline/                  # The content generation pipeline (Railway worker)
│   ├── review-ui/                 # Next.js admin UI (Vercel)
│   └── webhook-handler/           # Resend webhook receiver (Railway worker or Supabase Edge Function)
├── packages/
│   ├── llm-client/                # The LLM wrapper. Required by everything that calls models.
│   ├── voice-modules/             # Composable voice specifications.
│   ├── brain/                     # Concept storage, embedding similarity, variety enforcement.
│   ├── distribution/              # Resend integration, subscriber management, compliance.
│   ├── experiments/               # Experiment framework primitives.
│   ├── schemas/                   # Shared Zod schemas. Source of truth for typed contracts.
│   ├── db/                        # Supabase client, migrations, RLS policies.
│   ├── observability/             # Logging, metrics, structured event emission.
│   └── policies/                  # Optimization policies, governance rules.
├── infra/
│   ├── railway/                   # Railway service configurations.
│   ├── vercel/                    # Vercel project configurations.
│   └── supabase/                  # Supabase project configuration, migration scripts.
├── docs/
│   ├── specs/                     # This spec set, version-controlled with the code.
│   ├── runbooks/                  # Operational runbooks for production issues.
│   └── decisions/                 # Architecture Decision Records (ADRs).
├── .github/
│   └── workflows/                 # CI/CD, scheduled crons.
├── package.json                   # Workspace root.
├── tsconfig.base.json             # Shared TS config extended by all packages.
└── AGENTS.md                      # Top-level agent navigation document.
```

**Workspace tooling: pnpm.** Faster than npm, better monorepo support, stricter dependency hoisting. Yarn is acceptable; npm is not.

**Each package is independently versioned.** Internal packages reference each other via workspace protocol (`"@platform/llm-client": "workspace:*"`). External packages get pinned versions, no carets.

**No barrel files.** Each package exports specific named exports from a single `index.ts`. Deep imports allowed and preferred when consuming a single function. This keeps tree-shaking working and makes dependency graphs visible.

## TypeScript Configuration

**Base `tsconfig.base.json` settings (every package extends this):**

- `strict: true` — non-negotiable
- `noUncheckedIndexedAccess: true` — array access returns `T | undefined`, forces null checks
- `exactOptionalPropertyTypes: true` — optional means optional, not "undefined or missing"
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `target: ES2023`
- `module: ESNext`
- `moduleResolution: bundler`
- `verbatimModuleSyntax: true` — explicit `import type` for type-only imports
- `resolveJsonModule: true`

**No `tsc` in production.** Use `tsx` for development, `tsup` or `esbuild` for production builds. TypeScript is a type-checker, not a compiler in this stack.

## Code Style

**Linter: Biome.** Faster than ESLint + Prettier combined. Single config file. Handles formatting and linting in one pass.

**Naming conventions:**
- Files: `kebab-case.ts`
- Types and interfaces: `PascalCase`
- Functions and variables: `camelCase`
- Constants (module-level immutable): `SCREAMING_SNAKE_CASE`
- Zod schemas: `PascalCaseSchema` suffix (e.g., `CoverStorySchema`)
- Database tables: `snake_case`, plural (`episodes`, `block_executions`)
- API routes: `kebab-case`

**Function length:** Aim for under 50 lines. If it exceeds 100 lines, it's doing too much.

**No default exports.** Named exports only. This makes refactors safer and IDE features work better.

**Comment policy:** Code should be self-documenting. Comments explain *why*, not *what*. JSDoc on public package exports only. Inline comments on non-obvious decisions only.

**Error messages:** Always actionable. "Failed to parse cover story output: schema validation failed at field `tasting_menu.items[2].url` — expected URL string, got null. Block run ID: abc123" is good. "Validation error" is not.

## The LLM Client Wrapper

This is the most important package in the foundation. Every LLM call in the platform goes through it. Every call gets retry logic, fallback model handling, JSON-mode safety, token counting, structured logging, and cost tracking — for free.

A developer who tries to bypass it should hit friction. A developer who uses it should have a hard time getting a buggy LLM call into production.

### Package: `@platform/llm-client`

**Public API surface:**

```typescript
import { LLMClient } from "@platform/llm-client";

const client = new LLMClient({
  // Provider credentials read from env at construction time.
  // Throws if any required key is missing — fail fast, not at first request.
});

// Structured generation with schema validation.
// Note: blocks pass a model ROLE, not a specific model.
// The wrapper resolves the role to provider/model/temperature/fallback at call time
// by querying platform_config. This makes models hot-swappable without code changes.
const result = await client.generate({
  modelRole: "weekend.writer",         // Resolved from platform_config at call time
  systemPrompt: composedSystemPrompt,
  userPrompt: userMessage,
  schema: CoverStoryOutputSchema,      // Zod schema. Output is validated and typed.
  maxRetries: 2,
  context: {
    blockName: "cover_story",
    runId: "...",
    brandId: "castor_abbott",
  },
});

// result is typed as z.infer<typeof CoverStoryOutputSchema>
// All telemetry is automatically captured to the run log, including the
// resolved provider/model that was actually used (for replay and audit).
```

### Why Model Roles Instead of Direct Model Strings

Code references logical roles ("editor", "weekend.writer", "fact_checker"), not specific model strings ("claude-sonnet-4.5"). The role-to-model mapping lives in `platform_config` and resolves at call time.

**Why this matters:**

- **Hot-swappable models.** New model releases get tested by updating one config row, not modifying code and redeploying. When `claude-sonnet-5` ships, it can be live in production within minutes of evaluation.
- **Per-brand customization.** Castor Abbott's writer might use Opus for the Saturday Latte; Treasure Financial's might use Sonnet. Same code, different config, different cost/quality tradeoff.
- **Per-environment overrides.** Staging runs cheaper models. Production runs the configured models. Same code path.
- **Provider outage routing.** Anthropic having an incident? Update the role to point to OpenAI's equivalent. The pipeline keeps running. No code change.
- **A/B testing models in production.** Run `weekend.writer` with Opus for half of brands and Sonnet for the other half. Compare quality scores and costs. Pick the winner.
- **Cost/quality dial without redeploys.** Mark decides the editor is overkill for weekend content. Swaps the model in the UI. Done.

**Audit and replay safety:** When a block runs, the wrapper logs both the role *and* the resolved provider/model that was actually used. Historical replay reconstructs the exact model — replaying a run from 6 weeks ago uses the model that was active at the time, not whatever's configured today.

### Model Role Configuration

Roles are stored as `platform_config` entries with this shape:

```typescript
// In platform_config table
// Key format: "llm.role.<role-name>"
{
  key: "llm.role.weekend.writer",
  brand_id: null,                    // Platform default; override per-brand by setting brand_id
  environment: "production",
  value: {
    primary: {
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      temperature: 0.4,
      max_tokens: 8000,
      reasoning: false,
    },
    fallback: {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      temperature: 0.4,
      max_tokens: 8000,
      reasoning: false,
    },
  },
}
```

Per-brand override example: Castor Abbott uses Opus for the Latte writer; Treasure Financial uses Sonnet because their voice is less ornate.

```typescript
{
  key: "llm.role.weekend.writer",
  brand_id: "treasure_financial",
  environment: "production",
  value: {
    primary: {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      temperature: 0.4,
      max_tokens: 8000,
      reasoning: false,
    },
    fallback: {
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.4,
      max_tokens: 8000,
      reasoning: false,
    },
  },
}
```

Resolution order at call time: brand+environment specific → platform-default+environment → throw if neither exists.

### Default Model Roles

The platform ships with these roles defined. Phase 1 deploys these as platform-wide defaults; brand-specific overrides can be added later as needed.

| Role | Purpose | Default Primary | Default Fallback |
|------|---------|-----------------|------------------|
| `weekday.topic_proposer` | Weekday topic proposal | Sonnet 4.5 @ 0.4 | Opus 4 @ 0.4 |
| `weekday.research` | Weekday research gathering | Sonnet 4.5 @ 0 | Opus 4 @ 0 |
| `weekday.writer` | Weekday content writing | Sonnet 4.5 @ 0.3 | Opus 4 @ 0.3 |
| `weekday.opening_trifecta` | Opening Trifecta candidate generation | Sonnet 4.5 @ 0.5 | Opus 4 @ 0.5 |
| `weekend.destination_proposer` | Weekend destination proposal | Sonnet 4.5 @ 0.7 | Opus 4 @ 0.7 |
| `weekend.research` | Weekend research gathering | Sonnet 4.5 @ 0.2 | Opus 4 @ 0.2 |
| `weekend.writer` | Weekend content writing | Opus 4 @ 0.4 | Sonnet 4.5 @ 0.4 |
| `weekend.fact_checker` | Fact verification | Sonnet 4.5 @ 0 | Opus 4 @ 0 |
| `editor.standard` | Editorial pass for both editions | Sonnet 4.5 @ 0 | Opus 4 @ 0 |
| `persona.evaluator` | Single persona evaluation in panel | Sonnet 4.5 @ 0 | Opus 4 @ 0 |

These are the defaults documented for Phase 1 launch. None are pinned in code. All are config rows the dev team or Mark can update through the admin UI without a deploy.

### Adding a New Provider

A new provider (xAI, Mistral, etc.) is added by:
1. Implementing the provider adapter interface in `@platform/llm-client/src/providers/<name>.ts`.
2. Registering the adapter in the provider registry.
3. Adding the API key to environment variables.
4. Updating role config rows to point to the new provider.

No application code changes. The role-based abstraction means provider additions are isolated to the LLM client package.

### Required Behaviors

**1. Token counting before the call.** Every request counts input tokens before sending. If the request exceeds 90% of the model's context window, the wrapper logs a warning and either truncates non-critical context (with explicit truncation logging) or throws if truncation isn't safe. No silent context overflows.

**2. JSON mode safety.** When a `schema` is provided, the wrapper:
- Adds explicit JSON-only instructions to the system prompt (overridable but not by default)
- Disables reasoning by default (the failure mode we hit with Gemini reasoning leaking into JSON)
- Validates output against the Zod schema
- On validation failure, retries up to `maxRetries` with the previous output and the validation error included as feedback ("Your previous response failed validation at `tasting_menu.items[2].url`. Return only valid JSON matching the schema.")

**3. Provider abstraction.** The wrapper supports Anthropic, OpenAI, and Google as first-class providers. Each provider has its own client adapter implementing a common interface. Adding a new provider is one new adapter file plus registration. No provider-specific logic leaks into application code.

**4. Automatic fallback on primary failure.** If the primary model returns malformed output that can't be auto-healed within `maxRetries`, the wrapper automatically falls back to the configured fallback model. Fallback is logged. If both fail, the wrapper throws a typed error (`LLMGenerationError`) with full diagnostic context.

**5. Retry policy.** Exponential backoff for transient errors (rate limits, network failures, 5xx). No retry for permanent errors (auth failures, malformed requests). Retry counts and delays are logged.

**6. Cost tracking.** Every call records: input tokens, output tokens, model used, cost in USD (computed from per-provider pricing tables), latency in ms. Aggregated to the run log automatically.

**7. Structured logging.** Every call emits a structured log event via `@platform/observability`. Fields include: `timestamp`, `block_name`, `run_id`, `brand_id`, `provider`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `latency_ms`, `status` (success/retry/fallback/failure), `error_type` (if applicable), `validation_status` (passed/failed/healed).

**8. No streaming in v1.** Streaming is unnecessary for the pipeline (which generates structured JSON for downstream consumption, not real-time UI). It adds complexity without value at this stage. May be added later for the review UI's regenerate-on-edit feature; that's Phase 2+.

### Schema Validation Pattern

Every LLM call that produces structured output uses Zod for validation. Schemas live in `@platform/schemas` and are imported by both the block that generates and any downstream block that consumes.

```typescript
// In packages/schemas/src/cover-story.ts
import { z } from "zod";

export const CoverStoryOutputSchema = z.object({
  headline_options: z.array(z.string()).length(3),
  opening_hook: z.string().min(50),
  key_details: z.object({
    where: z.string(),
    when_to_go: z.string(),
    insider_tip: z.string(),
    // ...
  }),
  source_urls: z.array(z.string().url()),
  contrarian_angle: z.string(),
});

export type CoverStoryOutput = z.infer<typeof CoverStoryOutputSchema>;
```

Schemas are the contract between blocks. Changes to a schema are breaking changes and require updating all consumers in the same commit. The CI lint pass enforces this — a schema change that doesn't update consumers fails the build.

### Auto-Heal Logic

When schema validation fails, the wrapper attempts automatic recovery before falling back:

**Pass 1 — Common fixes:** Strip markdown code fences (```json blocks), strip leading/trailing prose, trim whitespace. Re-validate. Most failures are caught here.

**Pass 2 — Structural repair:** If JSON parses but fails schema validation, attempt to extract valid fields and identify missing/wrong-typed ones. Send back to the model with a focused correction prompt: "Your output had these specific issues: [list]. Return corrected JSON."

**Pass 3 — Fallback model:** If pass 1 and pass 2 both fail, switch to the fallback model with the original prompt. Log the fallback event.

**Pass 4 — Throw.** If fallback model also fails, throw `LLMGenerationError` with full context. Block-level retry policy decides whether to retry the entire block or escalate.

This four-pass strategy catches the vast majority of structured output failures (the Gemini reasoning leak we hit twice, malformed JSON, schema drift) without requiring application-level error handling.

## Error Handling Patterns

**Errors are typed.** Every error class extends a base `PlatformError` and carries structured context. No bare `throw new Error("something went wrong")`.

**Error class hierarchy:**

```typescript
class PlatformError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;
  readonly cause?: Error;
}

class LLMGenerationError extends PlatformError { /* code: "llm.generation_failed" */ }
class SchemaValidationError extends PlatformError { /* code: "schema.validation_failed" */ }
class BrainQueryError extends PlatformError { /* code: "brain.query_failed" */ }
class DistributionError extends PlatformError { /* code: "distribution.send_failed" */ }
class PolicyViolationError extends PlatformError { /* code: "policy.violation" */ }
// etc.
```

Every error has a stable `code` string. Application code matches on the code, not on the class name (which can change with refactors). The code maps to a documented error catalog in `docs/runbooks/errors.md`.

**No swallowed errors.** Every catch block either re-throws or handles deliberately. A catch block that does nothing is a code smell that fails review.

**Errors include the run context.** Block name, run ID, brand ID, relevant input snippets (truncated). Logs should let you reconstruct what happened without rerunning the pipeline.

## Secret Management

**No secrets in code.** Ever. This is enforced.

**Source of secrets: Railway's secret store for the worker, Vercel's env config for the review UI, GitHub Secrets for CI.**

**Local development:** `.env.local` files, gitignored. A `env.example` file in each app documents what's required without containing values.

**Required secrets:**

| Variable | Purpose | Source |
|----------|---------|--------|
| `ANTHROPIC_API_KEY` | LLM calls | Anthropic console |
| `OPENAI_API_KEY` | Embeddings, fallback LLM | OpenAI console |
| `GOOGLE_API_KEY` | Image generation, optional LLM | Google AI Studio |
| `RESEND_API_KEY` | Email sending | Resend dashboard |
| `SUPABASE_URL` | Database connection | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB writes | Supabase project settings |
| `SUPABASE_ANON_KEY` | Review UI client | Supabase project settings |
| `GITHUB_PAT` | Web archive commits | GitHub fine-grained PAT (rotate from current MindStudio plaintext token IMMEDIATELY) |
| `SLACK_WEBHOOK_URL` | Review notifications | Slack incoming webhook |

**Validation at startup.** Each app calls `validateEnv()` on boot. Missing required variables → fail fast with a clear message. Apps cannot start in a half-configured state.

**Secret rotation procedure:** Documented in `docs/runbooks/secret-rotation.md`. Includes the GitHub PAT rotation that needs to happen on day one of the migration.

**No `.env` checked in.** Pre-commit hook scans for accidentally committed secrets. CI fails on detection.

## Observability Primitives

Detailed in `10_observability`. The foundation provides the primitives:

**`@platform/observability`** package exports:

- `logger.info(event, fields)` — structured logging, JSON output to stdout
- `logger.warn(event, fields)`
- `logger.error(event, fields)`
- `metric.increment(name, tags)` — counter metrics
- `metric.timing(name, ms, tags)` — latency metrics
- `span(name, fn)` — wrap an async operation in a timing span

**Log format:** JSON, one line per event. Fields are flat, snake_case keys. Mandatory fields: `timestamp`, `level`, `event`. Mandatory in pipeline contexts: `run_id`, `brand_id`, `block_name`.

**Stdout, not files.** Railway and Vercel both capture stdout. No file logging in production. No log rotation logic to maintain.

**Sampling: not in v1.** Log everything until volume forces sampling. With four brands at one send each per day, log volume is manageable.

## Configuration Management

**No config files in code.** Configuration that varies per environment (model choices, retry counts, thresholds) lives in environment-specific config records in Supabase.

**Config schema in `@platform/db`:**

```typescript
// Table: platform_config
{
  key: string,           // "llm.default_primary_model"
  value: jsonb,          // { provider: "anthropic", model: "claude-sonnet-4.5" }
  brand_id: string | null,  // null = platform-wide default
  environment: "production" | "staging" | "development",
  updated_at: timestamp,
  updated_by: string,
}
```

**Config access pattern:**

```typescript
import { config } from "@platform/db";
const primaryModel = await config.get("llm.default_primary_model", { brandId, environment });
```

**Why DB-stored config:** Lets you change retry counts, model choices, threshold values without redeploying. Critical when the system is autonomous and adjustments need to happen quickly.

**Config is cached.** In-memory cache with 60-second TTL. Cache invalidation on update via Supabase Realtime channel. The pipeline reads config at the start of each run, not on every block.

**Brand-scoped overrides.** A config key can have a brand-specific override. Lookup order: brand-specific → platform default. Missing key → throws.

## Determinism & Reproducibility

**Pipeline runs are reproducible given the same inputs.** Same brain state, same voice modules, same models, same temperature → same output (within model nondeterminism).

**Temperature: 0 by default for structured output.** Higher temperatures only where variety is genuinely needed (Tasting Menu options, Unspoken candidates).

**Seeds: not exposed in v1.** Most providers don't support deterministic seeds reliably. We optimize for low temperature + clear schemas instead.

**Replay capability is first-class.** Any past run can be replayed against current voice modules and prompt code via `npm run replay <run_id>`. The run log captures enough context to reconstruct inputs. This is how prompt changes get tested before deployment.

## Concurrency Model

**Pipelines run as queue-driven workers.** A scheduled job (GitHub Actions cron) inserts a `pipeline_run` request row into Supabase. The Railway worker picks it up. The worker holds a Postgres advisory lock on the brand for the duration of the run, preventing concurrent runs of the same brand.

**Why advisory locks:** Solves the race condition that bit the MindStudio system on Jan 22-23. Two concurrent Latte runs both reading stale brain state and producing duplicate Savannah pieces. With advisory locks, the second run blocks until the first releases the lock, by which time the brain has been updated.

**Lock granularity:** Per-brand. Different brands can run concurrently. Same brand cannot.

**Lock timeout:** 30 minutes. If a run hangs longer, the lock auto-releases. Subsequent runs log the previous failure.

**Cross-brand operations are eventually consistent.** Cross-brand pattern transfer (Phase 5) reads from a separate read-replica or eventual-consistency view, not from live brand state.

## Testing Strategy

**Unit tests:** Vitest. Co-located with code (`module.ts` and `module.test.ts` in the same directory). Run on every commit.

**Integration tests:** Test against a real Supabase test instance (Supabase has a local-dev mode that's good enough). LLM calls in integration tests use a deterministic mock provider. Run in CI on PR.

**End-to-end tests:** A small set of golden-path tests that run a full pipeline against fixed inputs and verify the output matches a snapshot. Snapshots are reviewed by humans on update. Run nightly, not on every commit (cost).

**Test coverage:** Not chasing a coverage percentage. Aim for: every typed contract has a schema-validation test, every error path has a test, every block has at least one happy-path integration test. If coverage drops below 70%, investigate.

**Fixture data:** A `fixtures/` directory in the test root with sample brain states, sample voice module configs, sample LLM responses. Fixtures are version-controlled. Updates to fixtures require a code review.

## Open Decisions for the Dev Team

These are flagged but not prescribed. Document the decision in `docs/decisions/` when made.

- **Specific test framework:** Vitest is recommended. Jest acceptable. Mocha is not (slow, dated).
- **Specific bundler for production builds:** tsup recommended. esbuild directly is acceptable. Webpack is not.
- **Specific Postgres advisory lock library:** Use Supabase's built-in support if available; otherwise pick a thin npm wrapper. Don't write your own.
- **Specific HTTP client:** Native `fetch` preferred. `undici` acceptable for cases where native fetch is insufficient. No `axios`.
- **Whether to use Supabase Edge Functions for webhook handling or a separate Railway worker:** Decided in `06_distribution_platform`. Foundation supports either.
- **Specific embedding model:** Decided in `05_brain_and_learning`. Foundation supports any provider via the LLM client.

## Acceptance Criteria

The foundation is complete when:

- [ ] Monorepo is set up with pnpm workspaces, Biome linting, TypeScript strict mode.
- [ ] `@platform/llm-client` exists, supports Anthropic + OpenAI + Google, validates output against Zod schemas, retries on failure, falls back to secondary model, logs every call with full context.
- [ ] The LLM client wrapper accepts a `modelRole` parameter, resolves it from `platform_config` at call time, and logs both the role and the resolved provider/model that was actually used.
- [ ] All 10 default model roles documented above exist as `platform_config` rows for the production environment.
- [ ] An integration test verifies that updating a role config row changes the resolved model on the next call, with no code change.
- [ ] An integration test verifies brand-specific role overrides resolve correctly (brand+env > platform default > throw).
- [ ] `@platform/observability` exists and is consumed by `@platform/llm-client`.
- [ ] `@platform/db` exists with Supabase client setup, `platform_config` table, config read/write helpers.
- [ ] `@platform/schemas` exists with at least one example schema demonstrating the pattern.
- [ ] Secret validation runs on app startup; missing secrets fail fast with clear messages.
- [ ] A reference pipeline app skeleton exists in `apps/pipeline/` that can call an LLM via the wrapper end-to-end using a model role.
- [ ] CI runs lint, type-check, unit tests on every PR.
- [ ] A `dev` script in the root package.json starts a local development environment with watch mode.
- [ ] `docs/decisions/` has at least one ADR documenting a real decision made during foundation work.
- [ ] The current MindStudio GitHub PAT has been rotated and the new value lives in Railway/Vercel secret stores, not in code.

## Why These Choices

A few decisions worth defending explicitly, since they shape everything downstream:

**Why TypeScript strict mode and not "we'll add types later":** Because every prompt-related bug we've seen has been a typing bug at heart. The Gemini reasoning leak was a malformed string getting passed as JSON. The 200K token overflow was an unbounded string concatenation. Strict types catch these at compile time, not at production runtime.

**Why Zod schemas as the canonical contract:** Because LLM outputs are the most untrustworthy data in the system. A schema validates structure, narrows types, generates TypeScript types automatically, and produces useful error messages on failure. The cost of writing schemas is negligible. The cost of not having them is the bug class we've been debugging.

**Why an LLM wrapper instead of "just call the SDK":** Because every block in the system needs the same boilerplate (retry, fallback, validation, logging, cost tracking). Doing it once means it's correct. Doing it 30 times means it's correct in 12 places, half-correct in 10, and broken in 8.

**Why model roles instead of hardcoded model strings:** Because models change. Sonnet 5 will ship. Opus 5 will ship. GPT-5 will ship. Provider outages will happen. Mark will want to A/B test. Per-brand cost/quality tradeoffs will emerge. Hardcoding model strings means every one of those events requires a code change and deploy. Roles in config means they require a config update with full audit. The abstraction cost is small; the agility benefit is large.

**Why advisory locks for concurrency:** Because the race condition that produced five Savannah Lattes on Jan 22-23 was caused by exactly this missing primitive. The fix is one line of Postgres code per pipeline run.

**Why no streaming in v1:** Because streaming complicates schema validation, complicates retry logic, complicates logging, and provides no benefit for a pipeline whose output is consumed by other code, not displayed to users. Add it when there's a user-facing reason to.

**Why workspace monorepo and not separate repos:** Because cross-package changes are common (a schema change touches schemas, the block that produces it, the block that consumes it, and possibly the review UI). Doing this across separate repos is a coordination tax. Doing it in one PR in a monorepo is one commit.

---

**Next:** Read `02_data_model.spec.md` for the complete database schema, RLS policies, and migration strategy.
