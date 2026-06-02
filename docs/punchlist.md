# Daily Grind / Latte — Spec Divergence Punch List

Full block-by-block audit of all behavioral specs vs. the running code, completed
2026-05-29. Status legend: `TODO` · `IN PROGRESS` · `DONE`.

**Architecture note:** the specs describe an idealized monorepo (`apps/pipeline/`,
`packages/*`). The real implementation is consolidated in `apps/review-ui/src/lib/`
+ Supabase. Items below are FUNCTIONAL gaps (behavior the spec requires that does
not happen), not architectural-purity differences. Several spec'd DB tables
physically exist from the initial scaffold but are **dead** (no live code reads/
writes them): `framework_concepts`, `subscribers`, `suppression_list`, `sends`,
`send_events`, `experiments`, `experiment_variants`, `optimization_policies`,
`pipeline_runs`, `block_executions`.

---

## TIER 0 — Compliance / safety (address before any real subscriber list)

Currently low real-world risk because the only recipients are 3 internal Castor
Abbott addresses (Mark, Matt, Carmine). Becomes a hard blocker the moment a real
advisor is added.

### J. Unsubscribe + suppression — MISSING — `TODO` (CAN-SPAM hazard)
Spec 06. No subscribe/confirm/unsubscribe route exists. Email footer links are
static placeholders (`daily-grind-cron.ts:492` → `/unsubscribe?test=true`). No
`List-Unsubscribe` header in `sendOne`. The `suppression_list` table exists but
is never queried. **A recipient cannot unsubscribe, and nothing stops us emailing
a suppressed address.**

### K. Bounce / complaint suppression — MISSING — `TODO`
Spec 06. The Resend webhook verifies signatures and normalizes
`bounced`/`complained` events, then **only logs them** (`webhooks/resend/route.ts:28-37`).
No subscriber state change, no suppression. A hard-bounced or complained address
keeps getting emailed every cycle → sender-reputation decay.

### M. No alerting — MISSING — `TODO`
Spec 10. There is zero alerting. A "pipeline failed, no issue produced" or a cost
spike is silent — visible only by reading logs. No `alerts` table, no eval job,
no Slack/email notify. The spec's core safety property is absent.

---

## TIER 1 — Content quality / variety (what Mark actually sees)

### A+B+C. Format variety — DONE (`d2ae3fc`, `04cba8c`, `dde5a9f`, `be23e786`, `e8d9023`)
- **A**: formatStyle drives writer structure with 5 genuinely divergent shapes
  (deep_dive 2-3 long steps; quick_hits 6-8 one-liners; contrarian 3 belief→
  backfire→replacement; story 2 narrative beats with mid-scene open + return;
  data 4-5 figure-led steps). Format style is the structural authority and
  overrides the content-type step-count.
- **B**: pickFormatStyle deterministic rotation with date-seeded tie-break;
  format_style_assign runs BEFORE topic_proposer (spec-aligned ordering); the
  proposer is now FORMAT-AWARE and picks a topic + paired contentType
  (story→story/take, quick_hits→tactic, etc.) — DOW affinity defers to format
  on conflict. Verified: story format produced genuine narrative prose
  ("Solo practitioner, mid-40s ... mentioned during their annual review ...
  the way you mention the weather"); quick_hits produced 8 one-sentence steps.
- **C**: trifecta-scorer Haiku block (~5s, ~$0.005) scores Number/Unspoken/Flip
  on hook+share+voice, picks the winner, template renders only that ONE.
  Verified June 10: unspoken won 9.0/10, HTML has exactly 1 label and 0 of
  the other two. Other 2 preserved in JSON for trace/learning per spec.



### A. Format Style layer — MISSING — `TODO` (highest content impact)
Spec 04:433-458. Every issue should carry a `formatStyle`
(deep_dive | quick_hits | contrarian | story | data) separate from content type:
"50+ unique combinations across the week." In code it's an *optional, ignored*
field on the proposer; the writer never varies structure. Every email is
structurally identical. This is "it only does one format."

### C. Opening Trifecta = ship ONE of three — MISSING — `TODO`
Spec 04:605-647 + PASS L388. Should generate 3 candidate openings (Number /
Unspoken / Flip), persona-score, ship the winner, log the rest, set
`trifecta_passed`. We stack all three in every issue and never compute
`trifecta_passed`. The opening never varies.

### B. content_type_assigner (deterministic) — MISSING — `TODO`
Spec 04:433-458. Should be a pure function picking
contentType + subtype + formatStyle + hasDigitalGrind with 14-day format
rotation from the brain. Currently folded into the LLM topic_proposer with none
of the rotation/subtype/digital-grind outputs.

### D. Special subtypes — MISSING — `TODO`
Spec 04:450,603. `compliance | team_management | tech_deep_dive` subtype; a
Special must address it directly. No subtype anywhere.

### E. Digital Grind (Friday section) — MISSING — `TODO`
Spec 04:453,592. `hasDigitalGrind` / `digital_grind`. Absent from writer + HTML
template; Friday issues identical to other days.

### F. Writer 3 headline candidates — MISSING — `TODO`
Spec 04:567. Writer should emit `headline_options: string[]` (3). We emit one
(plus a banned-pattern rewrite).

### G. Source quality tier — DONE (`f34604b`, `9ca07b2`)
URL verification (shipped `fb28887`) guarantees accuracy (live + deep + contains
the stat) but not prestige. Add a deterministic domain tier table (Tier 1
Kitces/Cerulli/SEC/FINRA/InvestmentNews; Tier 2 ThinkAdvisor/FA-Mag; Tier 3
else). Soft preference + `source_quality` warning; never over-drop to sourceless.
Mark must not grade sources by hand.

### I. Cluster repetition — `TODO` (investigate)
05-22→06-01 auto-run skewed entirely into client-profitability/segmentation.
Likely fixed structurally by A + B (real format/cluster variety machinery) — but
confirm the cluster guard didn't regress as brain memory filled with similar
summaries.

---

## TIER 2 — Learning loop (turns it from "generator" into "improving system")

### L. Brain semantic dedup — DONE (`bbb3ae5`, `8c58ed1`)
Root cause was twofold: (1) migration 0008 (match_content_concepts /
recent_content_concepts RPCs) was never applied to prod — APPLIED 2026-05-29 via
Management API; (2) findSimilarConceptsForTexts was never called. Now the
topic_proposer runs a dedup loop: propose → embed "topic — angle" →
match_content_concepts (cosine ≥0.82 over 538 stored concepts) → block & re-run
if too similar (max 3), else accept; ships least-similar with warning on
exhaustion. New topic_dedup_check trace stage. Verified 2026-06-03: dedup ran,
topic cleared as fresh. ALSO fixed a fatal interaction: writer URL hallucination
+ url_verify bundle-shrink was throwing and killing whole issues — replaced with
non-fatal repairWorthKnowingUrls (drop invalid, backfill from verified research).



### H. Engagement feedback loop — BROKEN — `TODO`
Specs 05 + 06. All quality gating is AI predicting reader behavior; the system
consumes **zero real outcome signal**. Resend events are logged but never
persisted; no `send_events`, no attribution, no `performance_observations`, no
scoring job. Fix: persist webhook events → aggregate per-issue open/click/
forward/unsubscribe → feed brain + persona calibration. Optional: Mark thumbs
up/down capture. (Overlaps J/K — same webhook is the entry point.)

### L. Brain framework layer + real dedup enforcement — MISSING/DEAD — `TODO`
Spec 05. (1) The two-layer brain (framework vs content concepts) is unbuilt —
`framework_concepts`/`framework_content_usage` tables exist but no code writes
them; only content-concept text summaries are stored. (2) The pgvector
similarity/dedup function (`findSimilarConceptsForTexts`, `match_content_concepts`
RPC) is **dead code — never called** in the live pipeline. Dedup today is just
recent-concept text dropped into the proposer prompt as soft advice; no
`lookback_until` / `hard_blocked` enforcement. This is likely the real root of
item I (cluster repetition).

---

## TIER 3 — Spec'd capabilities not yet needed (future)

### N. Experiment framework — ABSENT — `TODO` (future)
Spec 07. No experiment runtime at all: no variant allocation, no measurement, no
winner declaration, no 50-variant micro-test. `experiments`/`experiment_variants`
tables + `@platform/experiments` types exist but are unused stubs. The admin
`rewrite-issue` tone A/B is a manual content-replace tool, not wired to tracking.

### O. Optimization policy engine — ABSENT — `TODO` (future)
Spec 09. No `evaluatePolicy` engine, no seeded policies, no approval queue, no
escalation. `@platform/policies` is a type stub. "Approval" today = implicit human
review of the single draft. Persona `churnWeight` is a hardcoded constant, never
auto-tuned.

### P. Observability forensic store + replay completeness — PARTIAL — `TODO` (future)
Spec 10. `pipeline_runs`/`block_executions` are empty stubs; the trace is a
per-issue `generation_meta.pipeline` JSON blob → no cross-run SQL (failures by
reason, cost trends, retry rates), no indexed forensics. Replay is incomplete:
voice-module/config versions are NOT recorded and the model is a hardcoded
constant rather than a resolved role, so "what produced this issue 6 months ago"
can't be fully reconstructed. Cost/latency tracking + the single-issue trace UI
ARE implemented.

---

## Confirmed NOT gaps
- Voice frameworks (Trust Stacking, GAP, Physician Model, Three Torments, Offers
  vs Proposals, contrarian positions, language guide, synthesis) ARE composed
  into the writer (~39K tokens, `composeWeekdayWriterVoice`).
- Send scheduling (timezone + send-hour + weekday/Saturday gates) IMPLEMENTED.
- Per-recipient send idempotency (last_sent_issue_date guard) IMPLEMENTED
  (though `force=1` bypasses it).
- Per-issue cost + latency tracking IMPLEMENTED (estimated pricing).
- Single-issue pipeline trace + drift + quality-gate + viewer UI IMPLEMENTED.
- Concept extraction after each issue runs (content concepts only).
