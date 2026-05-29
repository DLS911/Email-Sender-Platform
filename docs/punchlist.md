# Daily Grind — Outstanding Punch List

Running list of things to address on the email pipeline. Check off when shipped.

Status legend: `TODO` · `IN PROGRESS` · `DONE`

Audit basis: read `03_voice_system.spec.md` in full + `04_content_pipeline.spec.md`
blocks (content_type_assigner, topic_proposer, research_agent, writer_agent,
opening_trifecta, score_aggregator) and cross-checked against the running code
on 2026-05-29. Items A-F below are genuine spec divergences. The remaining
specs (05 brain, 06 distribution, 07 experiments, 09 optimization, 10
observability) have NOT yet been audited block-by-block against the code.

---

## A. Format Style layer — the "different formats" — `TODO` (highest impact)

**Spec:** `04_content_pipeline.spec.md` block `content_type_assigner` (L433-458).
Every issue carries a **`formatStyle`: deep_dive | quick_hits | contrarian | story | data**,
separate from content type. Spec L458 verbatim: "A Tactic can be written as
deep_dive, quick_hits, contrarian, story, or data — five very different reading
experiences with the same content category. Tracking the format style separately
from the content type creates 50+ unique combinations across the week and
prevents structural repetition even when content type repeats."

**Current state:** `formatStyle` exists only as an *optional, ignored* string on
the topic_proposer output. The writer never receives it and never varies
structure by it. So every email is structurally identical regardless of
content type. This is what Austin meant by "it currently only does one format."

**Fix:** writer must branch its structure on formatStyle (5 genuinely different
layouts), and the assigner must pick + rotate formatStyle (exclude last 14 days,
pulled from brain — see item B).

---

## B. content_type_assigner as a deterministic block — `TODO`

**Spec:** L433-458. A PURE FUNCTION (no LLM) that picks
`contentType` + `subtype` + `formatStyle` + `hasDigitalGrind` from day-of-week
rules + brain-driven format rotation (last 14 days of format styles for this
content type are excluded).

**Current state:** content-type selection is folded into the LLM `topic_proposer`
with day-of-week hints. No separate deterministic assigner, no formatStyle
rotation, no subtype, no hasDigitalGrind.

**Fix:** extract a deterministic assigner that feeds the proposer/writer. Needed
for item A's rotation to be principled rather than random.

---

## C. Opening Trifecta = ship ONE of three, not stack all three — `TODO`

**Spec:** block `opening_trifecta` (L605-647) + PASS logic L388
(`trifecta_passed === true` required for weekday). Generate **3 candidate
openings** (The Number / The Unspoken / The Flip), persona-panel score each,
**publish the highest-scoring ONE**, log the other two for learning. Compute
`trifecta_passed` and fold it into the verdict.

**Current state:** the template stacks all three (Number + Unspoken + Flip) in
every issue, every time. We generate one of each inline, never score, never
choose, never compute `trifecta_passed` — the PASS clause silently skips. This
is the other half of "only does one format": the opening never varies.

**Fix:** generate 3 opening candidates, score via persona panel, ship the
winner, render only that one, log the rest, wire `trifecta_passed`.

---

## D. Special subtypes — `TODO`

**Spec:** `content_type_assigner` output `subtype: compliance | team_management
| tech_deep_dive | null` (L450), and writer "A Special must address its subtype
directly" (L603).

**Current state:** no subtype anywhere. A Special is generic.

---

## E. Digital Grind (Friday section) — `TODO`

**Spec:** `hasDigitalGrind: boolean` (true for Friday tactics, L453) and writer
output `digital_grind: object | null` (L592).

**Current state:** not in the writer output or the HTML template. Friday issues
are identical to other weekdays.

---

## F. Writer produces 3 headline candidates — `TODO`

**Spec:** writer_agent output `headline_options: string[] // 3 candidates`
(L567). The opening_trifecta block is built "for the writer's chosen headline,"
implying selection among candidates.

**Current state:** writer emits one headline; we only have a banned-pattern
rewrite, not 3-candidate generation/selection.

---

## G. Source quality tier (auto, not manual) — `TODO`

**Why:** URL verification (shipped, `fb28887`) guarantees a source is live +
deep + contains the cited stat (accuracy). It does NOT rank source *prestige*.
Jun 2 sourced The Number to `incomelaboratory.com` — live and relevant but an
SEO/content-marketing domain, not a top-tier publisher. Austin: Mark should NOT
grade sources by hand.

**Fix:** deterministic domain tier table (Tier 1 Kitces/Cerulli/SEC/FINRA/
InvestmentNews; Tier 2 ThinkAdvisor/FA-Mag/etc; Tier 3 everything else). Soft
preference — prefer Tier 1/2; if only Tier 3 survives URL verification, ship but
surface a `source_quality` warning in final_quality_gate. Must not over-drop to
sourceless.

---

## H. Tier 3 feedback loop — real engagement signal — `TODO`

**Why:** all quality gating today is AI predicting reader behavior. Ground truth
= real opens/clicks/forwards/unsubscribes + Mark's ratings.

**Current state:** `api/webhooks/resend/route.ts` receives Resend events but only
`logger.info`s them — nothing persisted, nothing reaches the brain.

**Fix:** persist events (`daily_grind_email_events`), aggregate per-issue rates,
feed back to brain + persona calibration. Optional: Mark thumbs up/down capture.

---

## I. Cluster repetition — possible regression — `TODO` (investigate)

**Observation (2026-05-29):** auto-run 05-22 → 06-01 skewed entirely into ONE
cluster (client profitability / segmentation / cost-to-serve). Check whether the
cluster guard + issue-summary memory weakened as the brain filled with similar
summaries, or whether the proposer kept self-justifying same-cluster picks.
NOTE: items A/B (real format + cluster variety machinery) may be the structural
fix for this.

---

## Not yet audited

Block-by-block code audit still owed against: `05_brain_and_learning`,
`06_distribution_platform`, `07_experiment_framework`, `09_optimization_policies`,
`10_observability`. There may be further divergences in those.
