# AGENTS.md

**Audience:** the dev team and the agentic dev workforce executing the build of this platform.

**Read this first.** Then read `00_overview.spec.md`. Then go to your work.

---

## What This Document Is

This is the navigation document for the spec set. It tells you how to find what you need, how the specs fit together, what conventions apply across all of them, and how to handle ambiguity when you encounter it.

The spec set is 13 documents totaling ~70,000 words. Loading all of them into context for every task wastes tokens and produces worse work. The right approach is targeted loading: read this document plus `00_overview` plus the specs your current work package actually depends on. Nothing more.

---

## The Spec Set

| File | Purpose | Read When |
|------|---------|-----------|
| `00_overview.spec.md` | System overview, principles, brands, phases, glossary | Always. First. |
| `01_foundation.spec.md` | Repo, runtime, LLM client, secrets, advisory locks | Always for any code work. |
| `02_data_model.spec.md` | Full Supabase schema, RLS, migrations | Any task touching the database. |
| `03_voice_system.spec.md` | Voice module composition, Castor Abbott modules | Voice work, brand onboarding, prompt engineering. |
| `04_content_pipeline.spec.md` | Block specs, weekday + weekend pipelines | Pipeline implementation, block work. |
| `05_brain_and_learning.spec.md` | Concept storage, variety, learning loop, modes | Brain work, learning analyzer, feedback loop. |
| `06_distribution_platform.spec.md` | Resend, provider abstraction, subscribers, compliance | Sending infrastructure, webhooks, subscriber management. |
| `07_experiment_framework.spec.md` | Framework vs content experiments, 50-variant pattern | Experiment infrastructure, statistical design. |
| `08_review_interface.spec.md` | Next.js admin UI on Vercel | Frontend work, UX. |
| `09_optimization_policies.spec.md` | Agentic governance, what's autonomous, approval gates | Policy implementation, autonomous decisions. |
| `10_observability.spec.md` | Logs, metrics, dashboards, alerts | Operational concerns, debugging tooling. |
| `11_deployment.spec.md` | Railway, Vercel, Supabase, CI/CD, secrets | Infrastructure work, environment setup. |
| `12_migration_plan.spec.md` | Day-by-day cutover from MindStudio | Phase 1 cutover and brand additions. |

---

## How to Navigate This Spec Set

### When You're Picking Up Work

1. **Read this document.** You're doing that now.
2. **Read `00_overview.spec.md`.** Twenty minutes. Worth every minute.
3. **Identify your work package.** What are you building? Find the spec that covers it.
4. **Read that spec's `dependencies` frontmatter.** Load every spec listed there.
5. **Do not load specs you don't need.** A frontend dev working on the review UI does not need the brain and learning spec. Token efficiency matters.
6. **Refer back to the overview when scope is unclear.** It's the orientation document for a reason.

### When You Encounter Ambiguity

The specs are detailed but not exhaustive. You will hit ambiguity. When you do:

**Check whether the ambiguity is in scope.** Each spec has an "Open Decisions for the Dev Team" section. Some ambiguity is deliberate — the spec doesn't prescribe because the right answer depends on judgment the dev team brings. If your ambiguity is in this list, document your decision in `docs/decisions/` (an ADR) and move on.

**Check whether the ambiguity is covered elsewhere.** A spec may not fully define something because the cross-referenced spec does. Cross-references look like `(see 03_voice_system.spec.md § Voice Module Composition)`. Follow them.

**If neither: surface, don't guess.** Open a question in the team channel or PR. Tag Mark or the senior dev. Wait for resolution. Building on a guess is a regression on the architectural intent and produces work that has to be redone.

The fastest path is not "decide and move." It's "ask, get an answer, build the right thing once."

### When the Spec Is Wrong

Specs are versioned but not infallible. If you discover the spec is wrong:

1. **Stop and verify.** Re-read the relevant section. Make sure you understand the intent before concluding the spec is wrong.
2. **If still wrong, fix the spec first.** Open a PR against the spec document. The spec is canonical truth; code derives from it. If you fix the code without fixing the spec, the next person reads the spec and gets confused.
3. **Update cross-references.** If your spec change affects other specs, update them in the same PR.
4. **Note the change.** ADRs in `docs/decisions/` capture significant architectural decisions; spec changes that meaningfully alter the architecture deserve an ADR.

This means: the spec is the source of truth, and changes to it are a deliberate, reviewed action — not something that happens accidentally as code drifts.

---

## House Conventions

Conventions that apply across all specs and all code in this repo. Not negotiable per work package; deviations require justification.

### Code Conventions

**TypeScript strict mode.** No `any` except at well-defined external boundaries. No `// @ts-ignore` without a comment explaining why.

**Named exports only.** Default exports complicate refactoring and obscure dependencies.

**File names: kebab-case. Types: PascalCase. Functions and variables: camelCase. Constants: SCREAMING_SNAKE_CASE.**

**Functions under 50 lines.** Larger functions usually do too much. Split.

**No barrel files (`index.ts` re-exporting everything).** Each package has one `index.ts` exporting only what's intended for external use. Internal imports use deep paths.

**Comments explain why, not what.** Code should be self-documenting for *what*. Comments are for non-obvious decisions, gotchas, and constraints that aren't visible in the code.

**Errors are typed.** Every error class extends `PlatformError` and carries a stable `code` string. No `throw new Error("something went wrong")`.

### Schema and Validation

**Every LLM output is validated against a Zod schema.** No exceptions.

**Schemas live in `@platform/schemas`.** Both producer and consumer import from the same schema. Schema changes are breaking changes; update all consumers in the same PR.

**Database row shapes are typed.** Generate types from the Supabase schema; don't hand-write types that drift from the schema.

### LLM Calls

**Every LLM call goes through `@platform/llm-client`.** No direct SDK imports outside the client package.

**Every block declares a model role, not a model string.** Roles resolve from `platform_config` at call time. Code never hardcodes "claude-sonnet-4.5" or similar.

**Reasoning disabled by default.** Enable only with explicit justification (the learning analyzer is the documented exception).

### Distribution Provider

**No code outside `packages/distribution/src/providers/resend.ts` imports the `resend` npm package.** Lint rule enforces this. The provider abstraction is what makes future SES migration possible.

### Database

**Every brand-scoped table has `brand_id`.** RLS policies enforce access. Application code uses helpers that auto-inject brand filters.

**Migrations are forward-only.** No down migrations. If a migration was wrong, write a new one that fixes it.

**Migrations are forward-compatible with both old and new code.** The deploy sequence is code-then-migrations; migrations cannot break the previous code version mid-deploy.

### Voice Modules

**Voice modules are markdown with YAML frontmatter.** Stored in `packages/voice-modules/`.

**Voice module changes are PRs against the repo, not edits in the UI.** This is enforced by policy in `09_optimization_policies`.

**Bumping the `version` field in frontmatter is required for substantive changes.** Typo fixes don't bump.

### Logging

**Every consequential event is logged with structured JSON.** `event` field is snake_case. Required fields per `10_observability`.

**Block executions write a `block_executions` row.** This is the canonical forensic record. Don't skip it for "trivial" blocks; the whole point is uniformity.

**Cost is tracked on every LLM call.** The wrapper handles this; just use the wrapper.

### Testing

**Vitest for unit tests.** Co-located with source (`module.ts` and `module.test.ts` in same directory).

**Integration tests against a real Supabase test instance.** Mock providers for LLM calls in tests.

**End-to-end tests are golden-path snapshots.** Reviewed by humans on update.

**Coverage isn't the target.** Useful coverage is. Every typed contract gets a validation test. Every error path gets a test. Every block gets at least one happy-path integration test.

---

## How Work Decomposes

The spec set is designed for parallelization. Different agents can work on different specs simultaneously after the foundation is in place.

### Sequential Dependencies (Cannot Parallelize)

These must complete in order:

```
00_overview → 01_foundation → 02_data_model
```

Until the data model is in place, downstream work has nothing to build against.

### Parallel Work After Foundation

Once `02_data_model` is done, these specs can be worked in parallel:

- `03_voice_system` (voice module decomposition)
- `06_distribution_platform` (Resend integration, subscriber management)
- `10_observability` (logging infrastructure, dashboards)
- `11_deployment` (CI/CD, environments)

### Sequential After Parallel Work

These need the parallel layer to land first:

- `04_content_pipeline` (depends on voice system)
- `05_brain_and_learning` (depends on data model and pipeline)
- `07_experiment_framework` (depends on pipeline and distribution)
- `08_review_interface` (depends on data model and pipeline)
- `09_optimization_policies` (depends on most of the above)

### Cross-Cutting Throughout

- `12_migration_plan` (depends on essentially everything; consult during cutover work)

### Recommended Team Structure

For an agentic dev team:

- **One agent on infrastructure** (`01`, `02`, `11` early; `10` and `12` later)
- **One agent on content** (`03` early; `04` and `05` later)
- **One agent on distribution** (`06` early; `07` later)
- **One agent on UI/UX** (`08`)
- **One agent on policies and governance** (`09`)
- **A senior reviewer** who reads every spec and reviews PRs across all areas

The senior reviewer is the integration point. They catch contract drift between specs and ensure the pieces fit together.

---

## What "Done" Looks Like

Each spec has its own acceptance criteria checklist. Work isn't done until the checklist is complete and verified.

**Verification means tests pass and an integration scenario works.** Not "I think it works" or "it ran once locally."

**Acceptance criteria are not optional.** They're the contract between the spec author and the implementer. If a criterion seems wrong, fix the spec, don't skip the criterion.

**The migration acceptance criteria from `12_migration_plan` are the ultimate test.** The platform is operational when Castor Abbott has shipped from the new system for two consecutive weeks without missing a send and without quality regression. That's the bar.

---

## When You Encounter These Things

### "Should I add a feature not in the spec?"

Default answer: no. The spec is opinionated about what's in scope and what isn't. "Out of Scope" sections are explicit.

If you think a feature should be added, propose it through a spec PR. Get review. If approved, the spec changes and your code implements the new spec. Don't ship code that adds undocumented features.

### "I want to use a different library/framework/pattern."

The specs document defaults and recommendations. Some choices are open ("Specific test framework: Vitest is recommended. Jest acceptable.").

For *open* choices: pick what works, document in an ADR, move on.

For *prescribed* choices (e.g., "TypeScript strict mode," "Zod schemas," "Postgres advisory locks"): deviation requires justification in a PR against the spec. The default is to use what's specified.

### "This spec is too detailed / I want to do it differently."

The detail is deliberate. Specs that under-specify produce inconsistent implementations across a multi-agent team. Detail is the price of parallelism.

If a specific decision in a spec seems wrong, push back through review. Don't quietly ignore.

### "I've encountered a situation the spec doesn't cover."

Three possibilities:
1. It's covered in a spec you haven't loaded. Re-check cross-references.
2. It's a deliberately open decision (in "Open Decisions" of the relevant spec). Document your call in an ADR.
3. It's a genuine gap. Open a question, propose a spec addition.

### "I'm being asked to commit a secret to the repo."

Don't. Secrets go in Railway, Vercel, GitHub Secrets, or `.env.local` files. The pre-commit hook should catch you, but don't rely on it.

### "I need to bypass a constraint to ship faster."

Stop. Bypassing constraints documented in the spec is the failure mode. The constraints exist for reasons (often documented inline; sometimes the reasons emerge from architectural integrity).

Examples of constraints that *must* be honored:
- Provider abstraction (no direct Resend imports outside the adapter)
- Voice module discipline (no agent-driven voice changes)
- RLS policies (no service-role bypasses except in trusted backend code)
- Audit logging (every consequential action is logged)
- Schema validation (every LLM output is validated)

If a constraint genuinely needs to flex, propose a spec change through review. Don't ship code that violates the spec.

---

## How to Add to This Spec Set

The spec set will evolve as the platform matures. Adding to it correctly:

**For new modules or features:**
1. Open a PR with the new spec document
2. Update `00_overview.spec.md`'s module map and dependency graph
3. Update relevant existing specs' `consumed_by` frontmatter
4. Get review from a senior team member before merging

**For new brands beyond the original four:**
1. Add brand definition to `00_overview.spec.md`
2. Add brand voice modules per `03_voice_system.spec.md`'s "Adding a New Brand" pattern
3. Configure brand-specific policies in `09_optimization_policies.spec.md`
4. Follow the migration playbook from `12_migration_plan.spec.md`

**For commercial extraction (Phase 6+):**
- This is a major undertaking. Will need its own spec document (`13_commercial_extraction.spec.md` or similar) defining the multi-tenant SaaS layer, billing, customer onboarding, support model.
- Out of scope for the initial 18-week build but architected for from day one.

---

## A Note on Voice and Tone in This Repo

The system prompts that produce newsletter content are written in Mark's voice — direct, opinionated, no hedging. The specs in this set are written the same way.

When you write code, comments, ADRs, runbooks, or anything else that lives in this repo: match that voice. Direct. Specific. No hedge words. No corporate speak. No "perhaps consider" or "it might be wise."

If you're writing a runbook for "what to do when the pipeline fails," write what to do. Not "you may wish to consider examining the logs."

This isn't stylistic preference for its own sake. The voice consistency is what makes the documentation usable at 3am when something breaks. Hedge-word documentation is harder to read under stress.

---

## A Final Note

This spec set is the result of a long conversation between Mark and Claude about what should be built. It represents real architectural thinking applied to real problems. The system it describes — agentic content + distribution + learning, multi-brand, with closed feedback loops and variety enforcement — doesn't exist anywhere else as a packaged product.

Your job is to build it. Not to second-guess every decision (most have reasoning behind them) and not to follow blindly (some decisions will need updating as you learn). Build with judgment. Push back where push-back is warranted. Honor the architectural intent.

The platform's success will be measured by whether Castor Abbott's subscribers receive a newsletter every weekday at 5 AM that they actually want to read. Not by whether the architecture is elegant. Not by whether the code is beautiful. By whether the operational outcome is achieved.

Good luck. Build well.

— Architecture spec set v1.0
