# ADR 0001 — Foundation stack

**Status:** accepted
**Date:** 2026-05-05
**Decision-maker:** dev team

## Context

We're building a multi-brand agentic content + distribution + learning platform that replaces a brittle MindStudio workflow. The choice of language, runtime, monorepo tooling, and lint/format tools shapes every line of code that follows.

Spec `01_foundation` prescribes the substrate. This ADR records the concrete choices made within those prescriptions.

## Decision

- **Language + runtime:** TypeScript on Node 22 LTS. ESM only. No CommonJS in new code.
- **Monorepo tooling:** pnpm workspaces (`pnpm@9.12.0`).
- **Lint + format:** Biome. One config in `biome.json` covers both formatting and linting.
- **TypeScript config:** strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Each package has its own `tsconfig.json` extending `tsconfig.base.json`.
- **No barrel files.** Each package has one `src/index.ts` exporting only what's intended for external use. Internal imports use deep paths.
- **No default exports** in shared packages. Apps that wrap framework requirements (Next.js page/layout files) keep their default exports — Biome override handles that.
- **HTTP server for webhook handler:** Hono. Lightweight, runs anywhere (Node, edge, Cloudflare Workers, Deno).
- **Frontend framework:** Next.js 15 (App Router) + React 19 for `apps/review-ui`. Vercel deploys.

## Consequences

- Velocity on cross-package changes is high. A schema edit lands in one PR with all consumers updated.
- Build artifacts are TypeScript source — Next.js's `transpilePackages` handles internal packages without a per-package build step. The pipeline worker uses `tsx` in dev and `tsc` for production builds.
- Biome means faster CI than ESLint+Prettier. Single config means one less file to maintain.
- pnpm's strict hoisting catches missing peer deps that npm silently ignores.

## Alternatives considered

- **Yarn workspaces.** Acceptable but slower than pnpm and weaker hoisting. No reason to choose it.
- **Turborepo.** Adds build orchestration we don't need yet at one-monorepo, low-package-count scale. Revisit if CI build time becomes a problem.
- **ESLint + Prettier.** Slower, two configs, two CI invocations. Biome is strictly better at this scale.
- **Express for webhook handler.** Heavier, Node-only. Hono is more flexible.

## References

- `docs/specs/01_foundation.spec.md`
- `docs/specs/AGENTS.md` — house conventions
