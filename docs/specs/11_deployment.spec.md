---
spec: 11_deployment
title: Deployment & Infrastructure
version: 1.0
status: draft
audience: dev_team, devops, platform_admins
dependencies:
  - 00_overview
  - 01_foundation
  - 02_data_model
  - 06_distribution_platform
  - 10_observability
consumed_by:
  - 12_migration_plan
purpose: Define the infrastructure setup, CI/CD pipeline, secret management, and environment strategy. The "how this actually runs in production" layer. Hosting on Railway, Vercel, Supabase. GitHub Actions for cron and CI/CD. Secret rotation and disaster recovery procedures.
---

# Deployment & Infrastructure

## What This Spec Covers

How the platform actually runs. Where each service is hosted, how deployments work, how secrets get managed, how environments separate, how disasters get recovered from. The boring-but-critical layer that turns "the code works on my laptop" into "this runs reliably for four brands every day."

The spec is opinionated about infrastructure choices because operational complexity compounds. A simple, well-understood stack with one service per layer beats a sophisticated multi-service architecture for a four-brand platform. Save the complexity for when you have the volume to justify it.

## Why This Matters

Most of the bugs in production systems aren't logic bugs. They're infrastructure bugs. A pipeline that runs fine locally fails because the production environment has a different Node version. Secrets that work in staging fail in production because rotation didn't propagate. CI passes but deployment breaks because the build artifact is missing a dependency. These are infrastructure problems, and they show up in spec 10 (observability) as alerts but they get fixed here.

The architecture is shaped by three principles:

**Boring infrastructure.** Railway for workers, Vercel for the UI, Supabase for state, GitHub for source. Four widely-used managed services. No Kubernetes, no custom orchestration, no clever multi-cloud strategies. Each service does one thing and does it well.

**One way to deploy.** Code lands on `main` → CI runs → CI deploys. No manual deploy scripts. No "promote to staging" buttons. The same automated pipeline ships every change, which means it gets exercised many times per week and works reliably.

**Reversible by default.** Every deployment can be rolled back. Every secret can be rotated. Every database migration is forward-only and tested. When something breaks at 3am, the recovery path doesn't require remembering manual steps.

## Infrastructure Topology

```
                      ┌─────────────────────────────┐
                      │       GitHub (source)       │
                      │  - Code                     │
                      │  - Spec docs                │
                      │  - GitHub Actions (CI/cron) │
                      └──────────────┬──────────────┘
                                     │
                ┌────────────────────┼─────────────────────┐
                ▼                    ▼                     ▼
       ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐
       │     Railway     │  │     Vercel      │  │    Supabase      │
       │                 │  │                 │  │                  │
       │ - Pipeline      │  │ - Review UI     │  │ - Postgres       │
       │   worker        │  │   (Next.js)     │  │ - Auth           │
       │ - Webhook       │  │ - Public signup │  │ - Storage        │
       │   handler       │  │   pages         │  │ - Realtime       │
       │ - Scheduled     │  │                 │  │ - Edge Functions │
       │   jobs          │  │                 │  │   (optional)     │
       └────────┬────────┘  └────────┬────────┘  └─────────┬────────┘
                │                    │                     │
                └────────────────────┼─────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
       ┌─────────────┐         ┌─────────────┐       ┌─────────────┐
       │   Anthropic │         │    Resend   │       │   OpenAI    │
       │     API     │         │  (sending)  │       │ (embeddings)│
       └─────────────┘         └─────────────┘       └─────────────┘
```

Three managed-platform tenants (Railway, Vercel, Supabase) plus three external API providers. GitHub is source-of-truth for code and the trigger surface for scheduled jobs.

## Service-by-Service Breakdown

### Railway: Pipeline Worker

**What runs here:** The content generation pipeline, the webhook handler, the scheduled background jobs (performance attribution, learning analyzer, daily cost summary, alert evaluation).

**Why Railway:** Long-running processes need a real worker host. Vercel functions time out at 60 seconds (300 with Pro); Railway has no such limit. Logs are accessible and not aggressively rotated. Pricing scales linearly. The DX is good — git-based deployment, environment variables in a dashboard, restart on demand.

**Service configuration:**

- One project per environment (production, staging)
- Multiple services within each project:
  - `pipeline-worker` — picks up scheduled pipeline runs, executes them
  - `webhook-handler` — receives Resend webhooks, persists events
  - `scheduled-jobs` — runs cron-triggered background jobs
- Each service is one Docker container running the appropriate entry point from the monorepo
- Resource sizing: small instances initially (Railway's defaults are fine for v1 volume); upsize when memory or CPU pressure shows in observability

**Deployment:** Git-based. Push to `main` → Railway builds and deploys. Build is `pnpm install && pnpm build`; runtime is `pnpm start:<service>` per service.

**Why not Vercel for these workloads:** Function timeouts. Pipeline runs can take 5-10 minutes. Webhook handlers need to persist to a database which can be slow under load. Long-running processes are not Vercel's strength.

### Vercel: Review UI

**What runs here:** The Next.js admin UI from `apps/review-ui`. Public-facing brand signup pages (one per brand at `castorabbott.com/subscribe`, `cortex.com/subscribe`, etc.) if they're served from this codebase, or as separate Next.js sites if managed independently.

**Why Vercel:** Best-in-class Next.js hosting. Edge network. Preview deployments per PR. Zero-configuration deployments. Vercel is built around Next.js; using anything else would be choosing pain.

**Configuration:**

- One Vercel project for the admin UI
- Production domain: `admin.platform.com` (or whatever DNS pattern)
- Preview deployments per PR, accessible at `<branch>-admin.vercel.app`
- Environment variables for Supabase URL and anon key
- Edge Functions for high-traffic API routes if needed (signup endpoints likely qualify)

**Deployment:** Git-based. Push to `main` → Vercel builds and deploys to production. PRs get preview deployments automatically.

### Supabase: Database, Auth, Storage, Realtime

**What lives here:** All persistent state. The full schema from `02_data_model`. User authentication. File storage if/when needed (logos, custom assets). Realtime subscriptions for the admin UI.

**Why Supabase:** Postgres is the right database. Supabase wraps it with Auth, Realtime, Edge Functions, and Storage in a coherent product. RLS is first-class. Pricing is reasonable through the size we'll be at for the next 18-24 months.

**Configuration:**

- One Supabase project per environment (production, staging, plus optional dev)
- Production tier: Pro at minimum (provides daily backups with 7-day retention; PITR is optional add-on)
- Database extensions enabled: `pgvector` (for embeddings), `pg_cron` (for scheduled DB-side jobs if needed), `pgtap` (for SQL tests)

**Migrations:** Managed via the Supabase CLI. Migration files in `infra/supabase/migrations/`. Applied via CI on deploy.

**Backups:** Supabase managed daily backups with 7-day retention on Pro tier. Application-level export job (per `02_data_model`) provides a redundant backup to Vercel Blob storage with longer retention.

### GitHub: Source, CI, Cron

**What lives here:** All source code. All spec documents. CI/CD workflows. Scheduled job triggers for cron-driven pipelines.

**Repository structure:** Single monorepo (per `01_foundation`). Branch protection on `main` requiring CI passing and at least one review.

**GitHub Actions workflows:**

- `ci.yml` — runs on every PR: lint, type-check, unit tests, integration tests
- `deploy.yml` — runs on push to `main`: triggers Railway and Vercel deployments
- `cron-castor-abbott-weekday.yml` — schedules the Daily Grind pipeline (Mon-Fri at 5:00 AM ET)
- `cron-castor-abbott-weekend.yml` — schedules the Saturday Latte pipeline (Sat at 5:00 AM ET)
- `cron-{brand}-*.yml` — same pattern for other brands once they migrate
- `cron-attribution-job.yml` — runs every 5 minutes to attribute send events
- `cron-cost-summary.yml` — runs daily to compute cost summaries
- `cron-alerts-eval.yml` — runs every 5 minutes to evaluate alerts
- `cron-learning-analyzer.yml` — runs daily after attribution

**Why GitHub Actions for cron:** It's free, the workflow definitions are version-controlled with the code, and cron precision is sufficient (cron jobs can drift by a few minutes; we don't need second-level precision). The alternative (Railway-native cron) is fine but harder to version-control.

**Cron triggers call API endpoints, not pipeline code directly.** The workflow makes an authenticated POST to `<railway-worker-url>/api/trigger-pipeline?brand=castor_abbott&edition=weekday`. The worker validates the auth token and executes. This indirection means cron logic is decoupled from pipeline logic; either can change without touching the other.

## Environments

Three environments. Each has its own Supabase project, its own Railway project, its own Vercel project.

**`production`** — what runs the actual business. Real subscribers, real sends, real money. Strict access control (only Mark and his developer have admin access). Deploys happen via CI from `main` branch.

**`staging`** — production-like environment for testing. Real-ish data (anonymized snapshots from production occasionally) but no real sends going to real subscribers. Deploys happen via CI from `staging` branch. Used for end-to-end testing before promoting to production.

**`development`** — local dev plus a shared cloud dev environment. Local dev runs Supabase locally via the CLI; shared cloud dev is a Supabase free-tier project for collaborative testing. Deploys are manual; this environment is for active feature development.

The architecture decision: three environments not two. Some teams collapse staging into production with feature flags. That works for some products. For an autonomous content system that sends to real subscribers, the consequences of a production-deploy bug are too high. Staging exists to catch what local dev misses but production can't afford.

### Environment Configuration

Each environment has its own:

- Supabase project (separate URL and credentials)
- Railway project
- Vercel project
- LLM provider API keys (or shared keys with environment tags for cost attribution)
- Resend API key and verified domains (production uses real `mail.castorabbott.com`; staging uses `staging-mail.castorabbott.com`)
- Configuration values in `platform_config` (same shape, different values; cheaper models in dev/staging, real models in production)

Environment is determined by an `ENV` variable injected at deploy time. Application code reads `ENV` to determine behavior in environment-conditional logic.

### Promotion Path

Code flows: feature branch → PR → `main` → production deploy. No manual promotion through staging.

The reasoning: continuous deployment to production is the only way to ensure the deploy pipeline works reliably. Manual promotion paths atrophy and break under stress. By deploying every change to production via the same automated path, the path stays exercised.

Staging is for feature-branch testing, not as a promotion gate. Developers can deploy a feature branch to staging for end-to-end testing before merging to `main`. Once merged, production deploy is automatic.

## CI/CD Pipeline

### CI on Every PR

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:unit

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:integration
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY_TEST }}
```

Three parallel jobs: lint-typecheck, unit-tests, integration-tests. All three must pass for the PR to merge. Branch protection enforces this.

### Deploy on Merge to Main

`.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy-railway:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: railway up --service pipeline-worker
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
      - run: railway up --service webhook-handler
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
      - run: railway up --service scheduled-jobs
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}

  deploy-vercel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: vercel deploy --prod --token=${{ secrets.VERCEL_TOKEN }}

  apply-migrations:
    runs-on: ubuntu-latest
    needs: [deploy-railway, deploy-vercel]
    steps:
      - uses: actions/checkout@v4
      - run: supabase db push --linked
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
```

Migrations apply *after* the new code is deployed. The reasoning: migrations are forward-compatible with both the old code and the new code (this is a constraint on how migrations get written), so the old code keeps working during the deploy window. If migrations applied first, there'd be a window where new schema exists with old code running against it — which can break in subtle ways.

If a deploy fails partway, the previous version stays running on Railway and Vercel. Migrations either applied or didn't. The system is in a known state in either case.

### Cron Workflows

Per-pipeline cron workflows trigger pipeline runs. Example:

`.github/workflows/cron-castor-abbott-weekday.yml`:

```yaml
name: Cron Castor Abbott Weekday
on:
  schedule:
    - cron: '0 9 * * 1-5'  # 5:00 AM ET (9:00 UTC), Mon-Fri

jobs:
  trigger-pipeline:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST "${{ secrets.RAILWAY_WORKER_URL }}/api/trigger-pipeline" \
            -H "Authorization: Bearer ${{ secrets.WORKER_API_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{"brand_id":"castor_abbott","edition":"weekday"}'
```

The workflow is minimal: an authenticated HTTP call. The pipeline logic itself lives in the Railway worker, not in the workflow.

GitHub Actions cron drift can be 5-15 minutes; for editorial content this is fine. If sub-minute precision becomes necessary later, switch to Railway's native cron.

## Secret Management

Secrets are configuration that must never live in code. The platform handles this through provider-native secret stores plus strict CI rules.

### Where Secrets Live

| Provider | Storage |
|----------|---------|
| Railway | Project-level environment variables in dashboard |
| Vercel | Project-level environment variables in dashboard |
| Supabase | Auth handles its own; service role key stored in Railway and Vercel |
| GitHub | Repository secrets for CI/CD workflows |
| Local dev | `.env.local` files, gitignored |

### Required Secrets

| Variable | Where Used | Source |
|----------|------------|--------|
| `ANTHROPIC_API_KEY` | Pipeline worker | Anthropic console |
| `OPENAI_API_KEY` | Pipeline worker, embeddings | OpenAI console |
| `GOOGLE_API_KEY` | Pipeline worker (image gen, optional LLM) | Google AI Studio |
| `RESEND_API_KEY` | Pipeline worker, webhook handler | Resend dashboard |
| `RESEND_WEBHOOK_SECRET` | Webhook handler | Resend dashboard |
| `SUPABASE_URL` | All services | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Pipeline worker, webhook handler | Supabase project settings |
| `SUPABASE_ANON_KEY` | Review UI | Supabase project settings |
| `SUPABASE_ACCESS_TOKEN` | CI for migrations | Supabase access tokens |
| `GITHUB_PAT` | Pipeline worker (web archive commits) | GitHub fine-grained PAT |
| `SLACK_WEBHOOK_URL_<BRAND>` | Pipeline worker, alert system | Slack incoming webhooks |
| `RAILWAY_TOKEN` | CI for Railway deploys | Railway dashboard |
| `VERCEL_TOKEN` | CI for Vercel deploys | Vercel dashboard |
| `WORKER_API_TOKEN` | GitHub Actions cron, validating worker calls | Generated, stored in both places |

### Secret Validation at Boot

Each application validates required secrets at startup. Missing secrets fail fast with a clear error. No secret should be loaded lazily into a path that can fail at request time.

```typescript
// In each app's bootstrap
import { validateEnv } from "@platform/db";

validateEnv({
  required: ["ANTHROPIC_API_KEY", "RESEND_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  optional: ["GOOGLE_API_KEY"],
});
// Throws PlatformError("env.missing_secret", { variable: "..." }) if any required is missing
```

### Secret Rotation Procedure

Documented in `docs/runbooks/secret-rotation.md`. The procedure for any secret:

1. Generate new secret in the provider console
2. Update Railway environment variables (production project)
3. Update Vercel environment variables (production project)
4. Update GitHub repository secrets if used in CI
5. Trigger a Railway and Vercel redeploy to pick up new values
6. Verify the new secret works (a sample API call)
7. Revoke the old secret in the provider console
8. Log the rotation in `audit_log`

The MindStudio GitHub PAT rotation is the first scheduled use of this procedure (Phase 1 day 1).

### Pre-Commit Secret Scanning

A pre-commit hook scans staged changes for accidentally-committed secrets. Patterns include:

- AWS access keys (`AKIA...`)
- Anthropic keys (`sk-ant-...`)
- OpenAI keys (`sk-proj-...`)
- Common patterns: `api_key=`, `password=`, `secret=`

CI re-runs the scan on every PR. False positives can be allowlisted via configuration.

This catches the most common accidental leak: a developer pastes a config file to debug something and forgets to gitignore it.

## Local Development

A developer should be able to clone the repo and have a working local environment in under 30 minutes.

### Setup Steps

```bash
# Clone repo
git clone git@github.com:org/agentic-newsletter.git
cd agentic-newsletter

# Install dependencies
pnpm install

# Start local Supabase
supabase start

# Apply migrations
pnpm db:migrate

# Seed local data (brands, sample voice configs, sample episodes)
pnpm db:seed

# Copy env template
cp .env.example .env.local
# Fill in API keys (Anthropic, OpenAI, Resend test mode key)

# Run pipeline worker
pnpm dev:pipeline

# In separate terminal: run review UI
pnpm dev:ui

# Trigger a test pipeline run
pnpm cli pipeline run --brand castor_abbott --edition weekday --dry-run
```

`--dry-run` runs the full pipeline but doesn't actually send. Useful for testing prompt changes locally.

### Local Test Data

Seed data includes:

- All four brands with default voice configs
- A handful of sample subscribers per brand
- A sample of historical episodes (anonymized)
- Sample framework concepts and content concepts (a few hundred to make brain queries meaningful)
- Sample policies (the standard set from `09_optimization_policies`)

Seed data is generated by a script in `apps/pipeline/src/scripts/seed-local.ts`. It's deterministic so re-running gives the same data.

## Disaster Recovery

If everything breaks, the platform can be restored from backups within hours.

### Recovery Scenarios

**Supabase project deleted or corrupted.** Daily backup restoration from Supabase. Pro tier has 7-day retention with PITR available as add-on. Recovery procedure: create new Supabase project, restore from backup, update `SUPABASE_URL` and credentials in Railway and Vercel, redeploy.

**Railway project deleted.** Less consequential because Railway is stateless (state is in Supabase). Recreate the project from the Railway dashboard, configure environment variables, deploy from `main`. Maybe 30 minutes of downtime.

**Vercel project deleted.** Same — stateless. Recreate, configure, deploy.

**GitHub repo deleted.** Mirror exists on local development machines. `git push --mirror` from any developer's clone restores. No data loss because all state is in Supabase.

**LLM provider catastrophic outage.** Pipeline degrades — runs that need that provider fail. The model role abstraction means failover to another provider is a config change. No code change required. Document the procedure in `docs/runbooks/provider-outage.md`.

**Resend extended outage.** Similar — switch to SES via the provider abstraction (per `06_distribution_platform`), if SESProvider is built. In v1, sends are paused until Resend recovers.

### Application-Level Backup

Beyond Supabase's managed backups, a daily cron exports critical tables to Vercel Blob storage:

- `episodes` and `episode_revisions`
- `content_concepts` and `framework_concepts`
- `subscribers` (per brand)
- `audit_log`

This is redundant safety. If Supabase fails catastrophically, we can rebuild on another database from these JSON exports.

Retention: 90 days in Vercel Blob, then archived to S3 Glacier (or similar) for long-term retention.

### Quarterly Restore Drill

Documented in `docs/runbooks/disaster-recovery.md`. Once per quarter, a platform admin executes a recovery drill in staging:

1. Create a fresh Supabase project
2. Restore from the latest backup
3. Verify schema integrity
4. Verify data completeness (key tables row counts match expected)
5. Run a sample pipeline against the restored data
6. Document elapsed time and any gaps in the procedure

The drill prevents recovery procedures from atrophying. If the procedure breaks, you find out during a drill, not during an actual disaster.

## Performance and Scaling

The v1 architecture handles four brands with daily sends comfortably. Performance ceilings worth knowing:

- **Pipeline runs:** Railway can run dozens of concurrent pipelines. Bottleneck is LLM provider rate limits, not infrastructure. Anthropic's tier-1 limits are sufficient for v1; tier upgrades are easy.
- **Webhook ingestion:** A single Railway worker handles thousands of webhooks per minute. We expect tens to low hundreds. No bottleneck near v1 volume.
- **Database queries:** With the indexes from `02_data_model`, queries return in <100ms at expected volume. Watch the Supabase query performance dashboard.
- **Realtime subscriptions:** Supabase Realtime supports tens of concurrent subscriptions per project comfortably. The admin UI uses 5-10 subscriptions per active user.
- **Storage:** Episodes, events, audit logs grow continuously. At expected volume, expect 5-10 GB/year of database storage. Supabase Pro starts at 8 GB included; expansion is cheap.

When does the architecture need to evolve?

- **>20 brands or >100K total subscribers:** evaluate dedicated database resources or sharding. Not v1.
- **>10K sends/day:** evaluate dedicated SES IPs and direct integration (per the SES migration path in `06`). Not v1.
- **>10 platform users:** evaluate proper RBAC tooling. Not v1.

These are scaling considerations for the future, not Phase 1 work. Design for the business that exists; build for the business that will exist; don't pre-build for the business you might have someday.

## Open Decisions for the Dev Team

- **Specific Railway service sizing:** Start with default sizes; upsize when observability shows pressure.
- **Specific Vercel plan:** Pro is sufficient for v1; team plan if multiple developers need separate environments.
- **Specific Supabase tier:** Pro at minimum for daily backups. Team tier ($599/mo) if PITR or advanced features are needed.
- **Specific GitHub plan:** Free tier works; Team or Enterprise if SSO becomes required.
- **Whether to use a CDN for the public signup pages:** Vercel's built-in is sufficient. Cloudflare in front of Vercel is overkill at v1 volume.
- **Specific monitoring/APM tool:** Defer to operational pain. Railway logs + Vercel logs + Supabase queries + the dashboards from `10_observability` cover v1.
- **Whether to maintain separate test API keys for LLM providers:** Yes for staging and CI; no for development (developers use real keys with their own usage budgets).

## Acceptance Criteria

The deployment infrastructure is complete when:

- [ ] Three environments (production, staging, development) exist on Railway, Vercel, Supabase.
- [ ] CI workflow runs on every PR with lint, typecheck, unit tests, integration tests passing.
- [ ] Deploy workflow runs on every push to `main` and successfully deploys to Railway and Vercel.
- [ ] Database migrations apply via CI after code deploys.
- [ ] Cron workflows for both Castor Abbott pipelines (weekday + weekend) are configured and tested.
- [ ] Cron workflows for attribution job, cost summary, alert evaluation, learning analyzer are configured.
- [ ] All required secrets are stored in their respective provider consoles (Railway, Vercel, GitHub).
- [ ] Secret validation runs on app startup and fails fast on missing required secrets.
- [ ] The MindStudio GitHub PAT has been rotated (Phase 1 day 1 task).
- [ ] Pre-commit hook for secret scanning is configured.
- [ ] Local development setup works in under 30 minutes from clone.
- [ ] Local Supabase + seeded data + sample pipeline run all work via documented commands.
- [ ] Application-level backup job runs daily and writes to Vercel Blob.
- [ ] Disaster recovery runbook exists in `docs/runbooks/disaster-recovery.md`.
- [ ] Quarterly recovery drill is scheduled (first drill within 90 days of Phase 1 launch).
- [ ] Branch protection on `main` requires CI passing and at least one review.
- [ ] Provider abstraction in `@platform/distribution` makes Resend → SES migration possible without application code changes (per `06`).
- [ ] All 10 standard runbooks from `10_observability` exist in `docs/runbooks/`.

---

**Next:** Read `12_migration_plan.spec.md` for the day-by-day plan to migrate Castor Abbott from MindStudio to the new platform without missing a send.
