# ADR 0002 — Vercel monorepo deploy strategy

**Status:** accepted
**Date:** 2026-05-05
**Decision-maker:** dev team

## Context

Vercel deploys the Next.js admin UI (`apps/review-ui`). The repo is a pnpm monorepo with shared packages under `packages/`. We need a setup that:

1. Lets Vercel install dependencies from the monorepo root.
2. Builds only the `review-ui` workspace.
3. Doesn't require a separate publish step for internal packages.

## Decision

Use Vercel's **Root Directory** feature pointed at `apps/review-ui`, with a `vercel.json` in that directory specifying:

- `installCommand`: `cd ../.. && pnpm install --frozen-lockfile`
- `buildCommand`: `cd ../.. && pnpm --filter review-ui build`
- `outputDirectory`: `.next`

Internal packages are imported as TypeScript source via Next.js's `transpilePackages` — no per-package build step. This keeps the dev loop fast.

`ignoreCommand` skips builds when a PR doesn't touch `apps/review-ui` or `packages/`. Saves Vercel build minutes during pure-pipeline or pure-spec changes.

## Consequences

- Vercel deploys are isolated to the review UI.
- Pipeline + webhook-handler apps don't deploy to Vercel — they run on Railway (deferred until Phase 1 Week 4).
- Preview URLs work for every PR.
- Deploy time is dominated by `pnpm install` and Next.js build; both fit in Vercel's free tier limits.

## Alternatives considered

- **Per-package npm publishes.** Would let Vercel install internal packages from the registry. Heavy ceremony for no benefit at one-team scale.
- **Vercel Turborepo template.** Adds Turborepo. We chose not to take that dependency in ADR 0001.
- **Self-host Next.js on Railway.** More control but more ops. Vercel's Next.js integration is best-in-class and free at our scale.

## References

- `infra/vercel/README.md`
- `apps/review-ui/vercel.json`
- `docs/specs/11_deployment.spec.md`
