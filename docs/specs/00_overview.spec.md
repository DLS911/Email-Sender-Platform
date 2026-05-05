---
spec: 00_overview
title: System Overview & Orientation
version: 1.0
status: draft
audience: dev_team, agentic_orchestrator
read_first: true
dependencies: []
consumed_by:
  - 01_foundation
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
purpose: Single source of truth for what we're building, why, and how the parts fit together. Read this first. Reference it whenever scope is unclear.
---

# System Overview

## What We're Building

A multi-brand agentic content + distribution + learning platform that replaces a brittle MindStudio workflow with a typed, observable, version-controlled system designed for an agentic dev team to build and an agentic editorial system to operate.

The platform serves four brands at launch (two B2B financial services, two B2C financial services, one of which serves both). It's architected for commercial extraction — meaning the four internal brands are the founding customers of what may become Cortex's distribution substrate, and the architecture should support that without requiring a re-architecture later.

This is not a newsletter platform. It's a content learning system where distribution is the feedback mechanism. The newsletters are how the system learns. Sending is the experiment that produces training data for the next generation.

## What Makes This Different

Three things don't exist in the market today, and we're building all three:

**Closed-loop content learning.** Generate, send, measure, learn, regenerate. Every send produces real engagement data that feeds back into the next generation cycle. This loop doesn't exist in any current content platform — operators approximate it manually with spreadsheets and gut feel.

**Framework-vs-content separation in the learning layer.** The system distinguishes what's portable (frameworks, structures, voice mechanisms) from what isn't (specific content, topics, recommendations). Frameworks that perform get reused. Content goes into duplicate prevention regardless of performance. This solves the optimizer-collapse problem that kills every algorithmic content system.

**Variety as a first-class architectural constraint.** Mandatory exploration budgets, cluster prevention, persona rotation, surprise quotients. Variety isn't emergent from randomness — it's enforced by the data model. The learning loop operates within the variety envelope, never outside it.

If we get this right, we own the substrate that nobody else has built.

## Architectural Principles

These shape every decision downstream. When in doubt, return here.

**Typed contracts at every boundary.** Every block input and output is a Zod schema. Every database row has a typed shape. Every LLM call validates structured output before passing downstream. Untyped data is a bug.

**The agent is the user.** Every action a human could take through a UI is a typed API call with predictable semantics. Humans review and approve at the policy level. Agents execute within policy.

**Fail loudly, recover automatically.** Every LLM call has retry logic with model fallback. Every external integration has timeout and error handling. Failures are logged with full context. The system never silently swallows errors.

**Voice is distributed, not siloed.** There is no single voice profile document. Voice lives in composable modules that get loaded based on what's being written. Each brand composes its own subset.

**Observability is non-negotiable.** Every LLM call, every block execution, every send, every event is logged with structured data. "Why did this happen?" must be answerable in seconds, not hours.

**Separate framework learning from content learning.** Frameworks are reusable; content is not. This distinction is hard-coded into the data model, not implemented as a convention.

**Multi-tenancy from day one.** Every table has `brand_id`. Every API call is brand-scoped. Retrofitting this later is painful; building it now adds 15-20% to schema complexity and removes an entire class of future migration work.

**Build for commercial extraction.** This isn't a single-tenant app that might eventually become multi-tenant. It's a multi-tenant platform that currently has one organization (Mark) using it. The difference matters for every architectural decision.

## High-Level Architecture

The system has six logical layers, each owning a distinct responsibility:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        REVIEW & APPROVAL                            │
│  Next.js admin UI on Vercel. Edit-before-send. Per-brand RLS.       │
└─────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │
┌─────────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATION & PIPELINES                       │
│  Typed async TypeScript on Railway. Weekday + weekend pipelines.    │
│  Composes voice modules. Queries brain. Emits events.               │
└─────────────────────────────────────────────────────────────────────┘
              ▲                                          ▲
              │                                          │
┌─────────────────────────┐              ┌──────────────────────────────┐
│      VOICE MODULES      │              │     BRAIN & LEARNING         │
│  Composable, versioned. │              │  Framework concepts +        │
│  Per-brand configs.     │              │  content concepts (separate).│
│  Loaded on demand.      │              │  Embedding similarity.       │
│                         │              │  Variety enforcement.        │
└─────────────────────────┘              └──────────────────────────────┘
                                                        ▲
                                                        │
┌─────────────────────────────────────────────────────────────────────┐
│                  DISTRIBUTION & EXPERIMENTATION                     │
│  Resend for sending. Per-brand domains. Webhook event stream.       │
│  Framework experiments + content experiments. Closed feedback loop. │
└─────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │
┌─────────────────────────────────────────────────────────────────────┐
│                      DATA & OBSERVABILITY                           │
│  Supabase Postgres. Multi-tenant. Full audit trail.                 │
│  Structured logs for every LLM call, block, send, event.            │
└─────────────────────────────────────────────────────────────────────┘
```

The data and observability layer underlies everything. The voice modules and brain feed into orchestration. Orchestration produces drafts. Review and approval gate the send. Distribution produces events that feed back into the brain. The loop closes.

## Module Map

The full spec set, in dependency order:

| Spec | Title | Purpose |
|------|-------|---------|
| `00_overview` | System Overview & Orientation | This document. Read first. |
| `01_foundation` | Foundation & LLM Client | Repo, runtime, LLM wrapper, error handling, secrets. |
| `02_data_model` | Database Schema & Migrations | Full Supabase schema, RLS, indexes, migrations. |
| `03_voice_system` | Voice Module Architecture | How voice composes. The Daily Grind weekday + Latte voice modules. |
| `04_content_pipeline` | Content Generation Pipeline | Block specs. Orchestration. Weekday + weekend pipelines. |
| `05_brain_and_learning` | Brain & Learning Loop | Framework vs content concepts. Variety enforcement. Cross-brand transfer. |
| `06_distribution_platform` | Distribution & Compliance | Resend integration. Subscriber management. Compliance. Reply handling. |
| `07_experiment_framework` | Experimentation Primitives | Framework experiments, content experiments, statistical design. |
| `08_review_interface` | Review & Approval UI | Next.js admin. Edit-before-send. Notifications. |
| `09_optimization_policies` | Agentic Governance | What agents can do autonomously. Policy structure. Audit. |
| `10_observability` | Logging & Monitoring | Structured logs, dashboards, alerting. |
| `11_deployment` | Infrastructure & CI/CD | Railway, Vercel, GitHub Actions, secrets, environments. |
| `12_migration_plan` | MindStudio → New System | Phased migration, parallel-run, validation criteria. |
| `AGENTS.md` | Dev Team Navigation | How to navigate the spec set. House conventions. |

## Dependency Graph

Read order for a developer joining the project:

```
            00_overview
                 │
                 ▼
           01_foundation
                 │
                 ▼
           02_data_model
                 │
        ┌────────┼────────┐
        ▼        ▼        ▼
   03_voice  06_distrib  10_observ
        │        │        │
        ▼        ▼        ▼
   04_pipeline  07_experiment
        │        │
        ▼        ▼
   05_brain  08_review
        │        │
        └───┬────┘
            ▼
      09_policies
            │
            ▼
      11_deployment
            │
            ▼
      12_migration
```

`00`, `01`, `02` are foundational and unblock everything else. `03`, `06`, `10` can be worked in parallel after `02`. The downstream specs assume the foundation is in place.

## The Four Brands

Brand-specific configuration is detailed in `03_voice_system`. For orientation:

- **Castor Abbott (B2B):** Lead generation business serving financial advisors. The Daily Grind (weekday) and Saturday Morning Latte (weekend) are its newsletter properties. Mark's flagship and the reference implementation. Every other brand inherits the base architecture from this one. Voice: sharp colleague, contrarian, frameworks with teeth (Trust Stacking, GAP, Physician Model). Audience: independent RIAs, wirehouse refugees, fee-only planners, team builders.

- **Cortex (B2B):** AI-powered content engine for financial advisors to build authority through systematic content production. Newsletter audience is RIA leadership and advisors evaluating content infrastructure. Voice: technical-but-accessible, focused on systems and capability, less about contrarian editorial and more about demonstrating what agentic content can do. Audience overlaps with Castor Abbott but with a more ops/infrastructure-minded reader.

- **Fidelon (B2B and B2C):** Financial transparency platform — advisor scorecards, firm trust scores, AI platform leaderboards. Serves both retail investors evaluating advisors (B2C) and the industry watching itself get scored (B2B). Voice: institutional-credible, narrative-disciplined, regulatory-grounded. Distinct register from Castor Abbott — Fidelon's authority comes from data and disclosure, not editorial sharpness. Newsletter content likely splits into separate B2B and B2C tracks within the same brand.

- **Treasure Financial (B2C):** Retail investor audience. Personal finance, wealth-building, investment education for individuals. Voice: accessible without being condescending, practical without being basic. Audience: retail investors at various wealth stages, from accumulators to retirees. Different content frameworks entirely (no Trust Stacking, no advisor personas — different vocabulary, different stakes, different success metrics).

**Migration order:**

1. **Castor Abbott** ships first on the new system. Daily Grind weekday, then Saturday Morning Latte weekend. End of Phase 1.
2. **Fidelon** migrates second (Phase 4). Most editorially distinct from Castor Abbott. Stress-tests the multi-tenancy and voice module separation, and forces the architecture to handle the B2B/B2C dual-track pattern early. If the platform handles Fidelon cleanly, the rest is easier.
3. **Treasure Financial** third. Fully B2C. Stress-tests audience and voice differentiation across the consumer/professional divide.
4. **Cortex** fourth. Closest neighbor to Castor Abbott in audience, so the cross-brand knowledge layer (built in Phase 5) is most relevant here. Cortex also has the meta-property that it's *the product* this platform is becoming — its newsletter literally demonstrates the platform's capabilities.

This ordering deliberately moves the most architecturally challenging brand (Fidelon, with its B2B/B2C duality) to Phase 4 rather than saving it for last. If multi-tenancy breaks under Fidelon's complexity, we discover it before two more brands depend on the same architecture.

## Build Phases

Sequenced for risk reduction. Each phase ends with a working deployable system, not a half-built platform.

**Phase 1 — Foundation + Castor Abbott on new infrastructure (~6 weeks)**
Foundation, data model, voice modules for Castor Abbott (Daily Grind weekday + Saturday Morning Latte weekend), content pipeline, review UI, Resend distribution. End state: both Castor Abbott newsletters run on the new system, replace MindStudio, ship to actual subscribers with human review.

**Phase 2 — Performance event pipeline + basic experimentation (~3 weeks)**
Webhook handlers, event attribution, basic A/B test framework, performance dashboard. End state: every send produces structured engagement data; subject line tests run autonomously within policy.

**Phase 3 — Learning loop + variety enforcement + persona calibration (~4 weeks)**
Framework library, variety constraints, exploration budget, persona panel calibration against real engagement. End state: the system learns from sends and proposes adjustments to future content; variety is enforced.

**Phase 4 — Fidelon migration (~2 weeks)**
Onboard the most editorially distinct brand. Stress-tests multi-tenancy, voice module separation, and the B2B/B2C dual-track capability. End state: two brands running on the same platform with isolated voices, audiences, and learning. Fidelon proves the architecture handles fundamentally different editorial registers.

**Phase 5 — Treasure Financial + Cortex + cross-brand knowledge layer (~3 weeks)**
Onboard the remaining two brands. Build pattern transfer with isolation guarantees. End state: all four brands on the platform; learnings transfer where appropriate (subject line patterns, send-time optimization) and stay isolated where they shouldn't transfer (voice choices, brand-particular content).

**Phase 6 — Cortex commercial wrapper (separate scope)**
External customer onboarding, billing, self-serve admin. Not part of the initial 18-week build. The fact that Cortex is one of the four founding brands means its newsletter content is itself a demonstration of the platform — every Cortex send showcases what the system can do for prospective customers.

Total Phase 1–5: ~18 weeks for an agentic dev team. Compressible with parallelization.

## Success Criteria

The platform is production-ready when:

**Phase 1 complete:**
- Daily Grind ships every weekday morning without human intervention beyond review approval.
- Saturday Morning Latte ships every Saturday morning.
- Zero failed runs due to model JSON leaks, race conditions, or context window overflow.
- Every draft passes through human review and can be edited before send.
- Every send is logged with full attribution.

**Phase 2 complete:**
- Every email produces structured event data within seconds of subscriber interaction.
- Subject line A/B tests run automatically and produce statistically valid winners.
- Performance dashboard answers "which sends performed best last month and why" in under 10 seconds of query time.

**Phase 3 complete:**
- The system proposes specific framework adjustments to future content based on observed performance.
- Variety constraints are enforced — no clustering by content type, framework family, or topic concept beyond configured thresholds.
- Persona panel predictions correlate with observed segment behavior at r ≥ 0.6.

**Phase 4 complete:**
- Two brands run on the platform with completely isolated voices, audiences, and learning.
- A change to Brand 1's voice modules has zero effect on Brand 2's output.
- Cross-brand data leakage is impossible by construction (RLS-enforced).

**Phase 5 complete:**
- Four brands operational.
- Cross-brand pattern transfer works for portable learnings (subject line patterns, send-time optimization) and is blocked for non-portable learnings (specific voice choices, brand-particular content).

## Out of Scope

Explicit list. If you find yourself building any of these in Phase 1–5, stop and check.

- **Self-serve customer onboarding.** Cortex commercialization is Phase 6, not part of this build.
- **Billing and payment infrastructure.** Same.
- **Public marketing website for Cortex.** Same.
- **Multiple languages.** English only at launch.
- **SMS or push notification channels.** Email only at launch.
- **Real-time collaborative editing.** Single editor at a time on any draft.
- **Native mobile apps.** Web admin only.
- **Custom email rendering engines.** React Email components, no custom DSL.
- **Replacing the website (castorabbott.com).** The current site stays; the platform pushes archive HTML to it.
- **AI-generated images at scale.** Existing image generation in MindStudio works; we'll port the integration, not redesign it.

## Open Decisions Deferred to Implementation

These are flagged in their respective specs but listed here for visibility:

- Specific React state management approach for the review UI (Zustand, Jotai, plain context — dev's call).
- Specific testing framework (Vitest preferred but not mandated).
- Specific embedding model for concept similarity (OpenAI text-embedding-3-large is the default; Voyage AI is a viable alternative).
- Specific subject line testing statistical method (Bayesian preferred but frequentist acceptable).
- Whether to use Supabase Edge Functions or a separate Railway worker for webhook handling.

The dev team has authority to decide these based on judgment. Document the decision in the relevant spec when made.

## Glossary

Domain terms used throughout the spec set.

**Block** — A single LLM call within the content pipeline. Has typed input, typed output, configured model, retry policy. Examples: `cover_story_block`, `tasting_menu_validator_block`.

**Brain** — The persistent memory of what the system has produced. Two layers: framework concepts and content concepts.

**Brand** — A top-level tenant. Has its own voice configuration, subscriber list, sending domain, and learning state. Daily Grind is a brand. So is each of the other three.

**Content concept** — A specific topic, destination, recommendation, or factual claim. Locked out of duplicate use within a configured lookback window. Performance is measured but does not trigger reuse.

**Framework concept** — A reusable structural pattern. Voice mechanism, opening style, content architecture, section flow. Performance is measured and high-performers are eligible for reuse.

**Pipeline** — The sequence of blocks that produces one edition of a newsletter. Weekday and weekend pipelines have different block sequences.

**Voice module** — A self-contained piece of voice specification (e.g., the Trust Stacking framework, the Drive's car spectrum). Composed by blocks based on what's being written.

**Variety envelope** — The hard constraints (exploration budget, cluster prevention, persona rotation, surprise quotient) that bound what the learning loop is allowed to recommend.

**Closed loop** — Generate → send → measure → learn → adjust → regenerate. The platform's defining capability.

## How to Use This Spec Set

If you're a developer or agent picking up work:

1. **Read this document fully.** It's the orientation for everything else.
2. **Identify your work package.** Each spec corresponds to a self-contained scope. Find yours.
3. **Load only the specs you need.** Each spec lists its dependencies at the top. Load those, plus this overview, plus your work package spec. Do not load specs you don't need — token efficiency matters in agentic execution.
4. **Honor the contracts.** Specs define input/output shapes. If you change a contract, you change all downstream consumers. Coordinate.
5. **Flag ambiguity in the spec, not in code.** If something's underspecified, surface it for human decision before implementing.
6. **Update the spec as you build.** If you discover the spec was wrong, fix the spec and note the change. The spec is living truth, not a starting point you abandon.

`AGENTS.md` has the detailed playbook for agent execution against this spec set. Read it before delegating work to subagents.

## Where We Are vs. Where We're Going

Right now, the Daily Grind production system runs on MindStudio with the following pain points:

- Brittle to model failures (Gemini reasoning leaks, JSON malformation, context window overflow).
- Race conditions in state management (concurrent runs read stale brain state).
- Hardcoded secrets in plaintext functions.
- Limited observability — debugging requires reading run logs by hand.
- No closed-loop learning — the system doesn't know what worked.
- Single-tenant architecture inadequate for multi-brand operation.

What we're building has none of those problems by construction. Typed pipelines, atomic state, secrets in env vars, structured logs queryable in seconds, closed feedback loops, multi-tenant from day one.

The destination is a platform Mark would be proud to white-label and other operators would line up to license. Build with that endpoint in mind.

---

**Next:** Read `01_foundation.spec.md` to understand the runtime, repo structure, and LLM client wrapper that everything else depends on.
