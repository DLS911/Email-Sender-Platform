# Daily Grind — Outstanding Punch List

Running list of things to address on the email pipeline. Newest context at top of each item. Check off when shipped.

Status legend: `TODO` · `IN PROGRESS` · `DONE`

---

## 1. Source quality tier (auto, not manual) — `TODO`

**Why:** URL verification (shipped, commit `fb28887`) guarantees a source is *live, deep, and contains the cited stat* — accuracy. It does NOT rank source *prestige*. The Jun 2 test sourced The Number to `incomelaboratory.com` (a real, live, relevant page that genuinely contained the 74% stat — but an SEO/content-marketing domain, not a top-tier publisher).

**Constraint from Austin:** Mark should NOT have to grade each email by how reputable its sources are. The system must handle prestige automatically.

**Fix:** Domain tier table (deterministic lookup, no AI):
- Tier 1 (preferred): Kitces, Cerulli, SEC, FINRA, InvestmentNews, J.D. Power, Federal Reserve research, Schwab Advisor Services
- Tier 2 (acceptable): ThinkAdvisor, FA-Mag, Financial Planning, AdvisorHub, RIA Channel/Intel, PlanAdviser
- Tier 3 (down-rank / warn): everything else (content marketing, generic blogs, SEO pages)

Apply as a **soft preference, not a hard drop** — research/writer should prefer Tier 1/2 sources; if only Tier 3 survives URL verification, ship it but surface a `source_quality` warning in `final_quality_gate` so the trace flags it. Must not over-drop and leave an issue sourceless.

---

## 2. Opening Trifecta selection block — MISSED SPEC STEP — `TODO`

**Spec:** `docs/specs/04_content_pipeline.spec.md` block `opening_trifecta` (lines 605-647), PASS logic line 388 (`trifecta_passed === true` required for weekday).

**What the spec calls for:**
1. Generate **3 distinct** Opening Trifecta candidates (Number / Unspoken / Flip), temperature 0.5 for genuine variety.
2. Persona panel evaluates each candidate → score aggregator computes per-trifecta engagement projection.
3. Publish the **highest-scoring** trifecta. Log the other two for learning (closed feedback loop).
4. Compute `trifecta_passed` and fold it into the PASS verdict.

**What we actually do:** writer generates exactly ONE trifecta inline. No candidates, no scoring, no `trifecta_passed`. The PASS logic silently skips the trifecta clause.

**Fix:** Add the trifecta candidate-generation + persona-scored selection step. Decide whether to run it as a pre-writer block (spec ordering) or post-draft A/B on the trifecta fields only (cheaper). Wire `trifecta_passed` into score_aggregate verdict.

---

## 3. Tier 3 feedback loop — real engagement signal — `TODO`

**Why:** Everything gating quality today (persona panel love rate, voice fit) is AI predicting reader behavior. The only ground truth is real opens/clicks/forwards/unsubscribes + Mark's own ratings. Without it we can't tell if the persona panel is calibrated.

**Current state:** `apps/review-ui/src/app/api/webhooks/resend/route.ts` receives Resend events (delivered/opened/clicked/bounced/complained) but only `logger.info`s them — nothing is persisted, nothing reaches the brain.

**Fix:**
- Persist webhook events to a table (e.g. `daily_grind_email_events`) keyed by issue_date + subscriber.
- Aggregate per-issue open/click/forward/unsubscribe rates.
- Feed those back into the brain so topic_proposer + persona calibration learn from reality.
- Optional: a lightweight way for Mark to thumbs up/down a shipped issue → store as the human-rating signal.

---

## 4. Cluster repetition — possible regression — `TODO` (investigate)

**Observation (2026-05-29):** the auto-generated run for 2026-05-22 → 2026-06-01 skewed heavily into ONE theme cluster — client profitability / segmentation / cost-to-serve:
- 05-22 "Your cost-to-serve is $8,000. Your client pays $3,200."
- 05-25 "The three-week test that predicts client retention"
- 05-26 "You're spending 80% of time on 20% of referrals"
- 05-27 "42% of clients generate 10% of revenue"
- 05-28 "44% of firms have client agreement gaps"
- 05-29 "Pull three files. Your service model is fiction."
- 06-01 "The audit that reveals which clients will leave"

**Question:** Is the cluster check + issue-summary memory actually preventing adjacent-cluster repetition, or did it weaken once the brain memory filled with similar summaries? Pull the topic_proposer traces for that range and check whether `recentClusters` / `thisIssueCluster` were being honored, or whether the proposer kept self-justifying same-cluster picks.

---
