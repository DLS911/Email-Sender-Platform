# CLAUDE.md — session operating manual

Read this first at the start of every Claude Code session in this repo.

## Always read

1. `AGENTS.md` (root) — agent navigation, house conventions
2. `docs/specs/00_overview.spec.md` — system overview
3. The spec(s) for the work package you're touching (per the dependency table in `AGENTS.md`)

Do **not** load all 13 specs every session. Token-efficient loading is mandatory: load only what your work depends on.

## House rules (cannot drift)

- TypeScript strict mode. No `any` except at well-defined external boundaries.
- Named exports only — no default exports (except where a framework requires them, e.g. Next.js `page.tsx`).
- File names: `kebab-case`. Types: `PascalCase`. Functions/vars: `camelCase`. Constants: `SCREAMING_SNAKE_CASE`.
- Functions under 50 lines. If over 100, split.
- Errors are typed — extend `PlatformError`, carry stable `code` string. No bare `throw new Error(...)`.
- Every LLM call goes through `@platform/llm-client`. No direct SDK imports outside that package.
- Every block declares a model **role**, not a model string. Roles resolve from `platform_config` at call time.
- Every LLM output is validated against a Zod schema in `@platform/schemas`.
- No code outside `packages/distribution/src/providers/resend.ts` imports the `resend` npm package.
- Every brand-scoped table has `brand_id`. RLS enforces access. App code uses helpers that auto-inject brand filters.
- Migrations are forward-only. No down migrations.
- Every consequential event is logged via `@platform/observability` with structured JSON.
- Voice module changes are PRs against the repo, not edits in the UI. Bump `version` in frontmatter on substantive changes.

## Voice and tone

The system prompts that produce newsletter content are written in Mark's voice — direct, opinionated, no hedging. Match that voice in code comments, ADRs, runbooks, PR descriptions. No corporate speak. No "perhaps consider." Write what to do.

## When you're stuck

- Ambiguity is in scope → check the spec's "Open Decisions for the Dev Team" section, document your call in `docs/decisions/`, move on.
- Ambiguity is covered elsewhere → follow cross-references like `(see 03_voice_system.spec.md § Voice Module Composition)`.
- Genuine gap → surface it in PR or team channel. Don't guess.

## Repo-specific notes

- **Repo:** `DLS911/Email-Sender-Platform`
- **GitHub account with push access:** `DLS911`
- **Local clone:** `/Users/austinford/cowork/email-sender-platform`
- **Vercel root directory:** `apps/review-ui` (the Next.js admin)
- **Railway:** deferred until Phase 1 Week 4. Do not add Railway-specific config until then.
- **Supabase:** Phase 0 ops task; project URL goes in `.env.local`.

## Don't do these

- Don't add features not in the spec. Out-of-scope is explicit per spec.
- Don't bypass the LLM client wrapper.
- Don't hardcode model strings — use roles.
- Don't commit secrets. Pre-commit hook should catch it; don't rely on the hook alone.
- Don't ship code that adds undocumented features. Propose spec changes through PR review.
