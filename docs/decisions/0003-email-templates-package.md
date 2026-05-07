# ADR 0003 — `@platform/email-templates` package

**Status:** accepted
**Date:** 2026-05-05
**Decision-maker:** dev team

## Context

Spec 01 lists 9 packages under `packages/`. None of them owns the rendering of HTML emails for distribution. Spec 04 § Block Specs and spec 06 § Distribution both reference HTML output but neither claims a home for the rendering code.

The pipeline's `assemble_html` block needs to produce ready-to-send HTML + plain text from a typed episode shape. That logic is shared across brands and editions, has no I/O, and benefits from typed contracts at the boundary.

## Decision

Add `packages/email-templates/` as a 10th package.

- Pure functions: `renderWeekday(input) → { html, text, subject, preheader }` and `renderWeekend(input)`.
- Inline-CSS, table-based HTML for email-client compatibility.
- All user content escaped at render time (XSS-resistant).
- `withTracking()` helper appends utm + section params to outbound links so click webhooks can be attributed to specific sections.
- No external dependency on React Email — a template-literal builder is enough at this scale and avoids the React Server Component / runtime cost.

The `assemble_html` pipeline block calls these functions; the review UI's `/episodes/[id]/preview` page renders them in an iframe for human review.

## Consequences

- One more package to maintain. Acceptable — the rendering logic was going to live somewhere; a dedicated package keeps it cleanly testable.
- Switching to React Email later is a non-breaking change because the public surface is `(input) → { html, text, subject, preheader }`. Internal rendering can swap without touching callers.
- No CSS-in-JS or React DOM in the email path — important because the email runtime is a worker, not a browser.

## Alternatives considered

- **React Email.** More expressive, but heavier and adds a React renderer dependency to the worker. Reconsider if email designs become complex enough to justify components.
- **MJML.** Robust template DSL with great client compat, but introduces a build step and a non-TypeScript template format. Cuts against the "voice is data, code is code" boundary.
- **Inline rendering inside `assemble_html` block.** Would block reuse from the review UI preview path and from any future archive page.

## References

- `packages/email-templates/`
- `apps/review-ui/src/app/episodes/[id]/preview/page.tsx`
- `docs/specs/04_content_pipeline.spec.md` (block specs)
- `docs/specs/06_distribution_platform.spec.md`
