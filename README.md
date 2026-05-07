# Email Sender Platform

Multi-brand agentic content + distribution + learning platform. Replaces the brittle MindStudio workflow with a typed, observable, version-controlled system designed for an agentic dev team to build and an agentic editorial system to operate.

Phase 1 brand: **Castor Abbott** (Daily Grind weekday + Saturday Morning Latte weekend).
Future brands: Cortex, Fidelon, Treasure Financial.

## Repository layout

```
email-sender-platform/
├── apps/
│   ├── pipeline/           # Content generation pipeline (worker)
│   ├── review-ui/          # Next.js admin UI — Vercel deploy root
│   └── webhook-handler/    # Distribution event ingestion
├── packages/
│   ├── llm-client/         # LLM wrapper. Required by everything that calls models.
│   ├── voice-modules/      # Composable voice specifications + composer.
│   ├── brain/              # Concept storage, embedding similarity, variety enforcement.
│   ├── distribution/       # Resend integration, subscriber management.
│   ├── experiments/        # Experiment framework primitives.
│   ├── schemas/            # Shared Zod schemas. Source of truth for typed contracts.
│   ├── db/                 # Supabase client, migrations, RLS policies.
│   ├── observability/      # Logging, metrics, structured events.
│   └── policies/           # Optimization policies, governance rules.
├── infra/
│   ├── supabase/           # Migrations and config.
│   └── vercel/             # Vercel deployment notes.
├── docs/
│   ├── specs/              # Full architecture spec set (13 specs).
│   ├── runbooks/           # Operational runbooks.
│   └── decisions/          # Architecture Decision Records.
├── AGENTS.md               # Read first if any work will be agent-assisted.
└── CLAUDE.md               # Session operating manual for Claude Code.
```

## Quick start

```bash
# Requires Node 22+ and pnpm 9+
nvm use
corepack enable
pnpm install

# Local dev
pnpm dev

# Lint + typecheck + test
pnpm lint && pnpm typecheck && pnpm test
```

## Getting it actually working in production

Everything in this repo is built, tested, and deployed to Vercel as a static UI. The backend services it talks to (Supabase, Resend, Anthropic) need to exist before the system can do real work.

**Read [`docs/runbooks/phase-0-ops.md`](docs/runbooks/phase-0-ops.md)** — it's the ordered checklist. Each step is independent and unlocks a chunk of capability. Total time: 6-10 hours.

In short:

1. Create Supabase project, apply migrations from `infra/supabase/migrations/` (biggest single unlock)
2. Verify `mail.castorabbott.com` in Resend, get API key + webhook signing secret
3. Drop in `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`
4. Run subscriber + concept import scripts (already in `apps/pipeline/src/scripts/`)
5. Rotate the existing MindStudio GitHub PAT (security-critical)

## Where to read next

- **`AGENTS.md`** — agent navigation and house conventions. Read first.
- **`docs/specs/00_overview.spec.md`** — system overview. Read second.
- **`docs/specs/01_foundation.spec.md`** — runtime, LLM client, secrets. Read before any code work.

The full 13-spec set in `docs/specs/` covers everything: data model, voice, pipeline, brain, distribution, experiments, review UI, governance, observability, deployment, migration.

## Build phases

Per `docs/specs/12_migration_plan.spec.md`:

1. **Phase 1** (~6 wks) — Foundation + Castor Abbott on new platform
2. **Phase 2** (~3 wks) — Performance event pipeline + experiments
3. **Phase 3** (~4 wks) — Learning loop + variety enforcement
4. **Phase 4** (~2 wks) — Fidelon migration
5. **Phase 5** (~3 wks) — Treasure Financial + Cortex + cross-brand layer

## Deployment targets

- **Vercel** — `apps/review-ui` (Next.js admin)
- **Railway** — `apps/pipeline` and `apps/webhook-handler` (Phase 0 deferred until orchestrator app is functional)
- **Supabase** — Postgres + Auth + pgvector

Vercel root directory: `apps/review-ui`. See `infra/vercel/README.md` for setup.

## Key architectural decisions

- TypeScript strict mode, named exports only
- Zod schemas validate every LLM output
- Voice is data, not code — markdown modules versioned in git
- Model **roles**, not hardcoded model strings — hot-swappable via `platform_config`
- Multi-tenant from day one — every brand-scoped table has `brand_id` + RLS
- Framework concepts (reusable) vs content concepts (locked-out) — hard architectural separation
- Pipeline orchestration in TypeScript, not a JSON DSL
