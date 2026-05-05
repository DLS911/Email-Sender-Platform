---
spec: 07_experiment_framework
title: Experiment Framework
version: 1.0
status: draft
audience: dev_team, agentic_orchestrator
dependencies:
  - 00_overview
  - 01_foundation
  - 02_data_model
  - 04_content_pipeline
  - 05_brain_and_learning
  - 06_distribution_platform
consumed_by:
  - 08_review_interface
  - 09_optimization_policies
  - 10_observability
purpose: Define the experimentation primitives. Framework experiments vs content experiments as architecturally distinct classes. Statistical design (sample sizing, holdback, confidence). The 50-variant micro-test pattern. Integration with the learning loop. The agent-facing API for proposing experiments and the human-facing approval workflow.
---

# Experiment Framework

## What This Spec Covers

The experimentation system. What can be tested, how tests are structured, how variants are allocated, how winners are determined, how results feed back into the brain. The architectural distinction between **framework experiments** (testing reusable patterns, producing durable learning) and **content experiments** (testing specific content choices, producing one-time learning).

Also: the 50-variant micro-test pattern that doesn't exist in current content platforms — the ability to test 50 versions against a small audience slice, observe engagement, and roll out the winner to the full list. This is the operational capability that produces compounding signal at velocity.

This spec does not cover the autonomous decisions about *which* experiments to run (that's `09_optimization_policies`) or the admin UI for managing experiments (that's `08_review_interface`).

## Why This Matters

Experimentation in current content platforms is approximately at the level of "subject line A vs subject line B," run manually, results judged by gut. That's not experimentation; it's variation testing. A learning system requires real experimentation infrastructure — hypotheses, statistical confidence, controlled exposure, automatic winner declaration, durable learning extraction.

Three things make this spec's experiment framework genuinely different:

**The framework-vs-content split is hard-coded.** Most experimentation tools treat all variants identically. Ours treats "test 5 different opening framework structures" as fundamentally different from "test 5 different topics." The first produces learning that compounds across all future generations; the second produces learning relevant only to that send. Different lifecycle, different statistical treatment, different feedback into the brain.

**Experiments can be agent-proposed.** A human operator can propose experiments, but so can the learning analyzer. When the analyzer notices a pattern worth testing, it can write a structured experiment proposal. Whether that experiment actually runs depends on the brand's optimization policies. The infrastructure supports both human-driven and agent-driven experiment proposal natively.

**The 50-variant micro-test is a primitive operation.** Not a hack assembled from manual subject line tests. The platform supports "split this list into 50 variant groups, send each a variant, measure engagement over a 4-hour window, declare the winner, send the winner to the remaining 95% of the list" as a single operation defined declaratively.

## Core Concepts

### Experiment

A defined test with hypothesis, variants, success metric, sample requirements, and lifecycle. Defined in the `experiments` table (see `02_data_model`).

### Variant

A specific version being tested within an experiment. Each experiment has 2 or more variants. Defined in the `experiment_variants` table.

### Allocation

How traffic (subscribers) gets distributed across variants. Allocation is defined per-experiment as percentages summing to 100. The system can enforce equal allocation (50/50, 33/33/33), uneven allocation (90/10 for low-risk dominant testing), or progressive allocation (start with small variant exposure, increase if no negative signal).

### Holdback

The portion of the list excluded from the experiment. Used to measure overall effect — does any variant beat the no-experiment baseline? Optional but recommended for high-stakes experiments.

### Success Metric

The single metric the experiment is judged on. Open rate, click-through rate, click-to-open rate, reply rate, click_section attribution rate, downstream conversion (where applicable). One metric per experiment; mixed-metric experiments produce ambiguous results.

### Confidence Threshold

The statistical confidence required to declare a winner. Default 95% (Bayesian probability that variant A's metric exceeds variant B's). Configurable per experiment.

### Lifecycle

```
[proposed] → [approved] → [running] → [concluded] | [cancelled]
```

**`proposed`** — Created (by human or agent), awaiting approval. May or may not be auto-approved depending on optimization policies.

**`approved`** — Approved to run. Variants are defined, allocation is set, ready to launch when scheduling allows.

**`running`** — Currently executing. Variants are in flight or in measurement window.

**`concluded`** — Measurement complete. Winner declared (if confidence threshold met). Results recorded.

**`cancelled`** — Aborted before completion. May happen if early signal is catastrophic (one variant driving high unsubscribes, etc.).

## The Two Classes of Experiment

### Framework Experiments

A framework experiment tests a reusable structural pattern. The variants are different *frameworks*, not different content.

Example: "Test 5 different opening framework structures (data-led, story-led, contrarian, anecdote, definition) on the next First Pull. Same underlying topic. Same underlying voice. Different opening pattern. Measure engagement among Solo Operators specifically. Identify the winning framework."

Why these matter: the winner produces *durable* learning. The winning framework can be applied to next month's tactic, next quarter's take, the take after that. The learning compounds. One experiment produces signal that improves dozens of future generations.

**Lifecycle considerations:**
- Sample size requirements are higher. Framework patterns need to be tested across multiple content instantiations to establish reliable signal. A single 50-variant test on one topic is suggestive; the same pattern winning across 5 different topics with 50 variants each is conclusive.
- Winners get promoted in the framework library (`05_brain_and_learning`). Performance scores update.
- Framework experiments often have longer measurement windows (4-week rolling rather than 4-hour immediate) because compound signal takes time to surface.
- The brain's `framework_concepts` table is the natural target for framework experiment learning.

### Content Experiments

A content experiment tests a specific content choice. The variants are different *content*, not different patterns.

Example: "Test 3 different topics for tomorrow's Tactic. Same opening framework, same voice, same target persona. Different specific content. Measure click-through rate and reply rate. Pick the winning topic for the live send."

Why these matter: real-time content optimization. The winner ships as the actual published content; the losers get logged as evaluated alternatives. Signal is one-time — the winning topic doesn't get sent again because content concepts lock out for their lookback window.

**Lifecycle considerations:**
- Sample size is whatever the immediate audience supports. The 50-variant micro-test pattern fits here.
- Winners affect the immediate send. Losers go to `content_concepts` with their lookback timer started.
- Measurement windows are short (typically 1-4 hours for engagement signal, 24 hours for full evaluation).
- The brain learns about content preferences but not durable patterns. Content experiments produce performance observations that inform persona calibration but don't update framework rankings directly.

### Why Treating These Differently Matters

Naive experimentation infrastructure treats every variant test as equivalent. A 50-variant subject line test produces the same kind of "winner" as a 50-variant framework test. They're recorded the same way, judged the same way, communicated the same way.

This conflation is what produces optimizer collapse in current platforms. The same "winning" subject line gets reused because the system doesn't know it's content (one-time) vs. framework (reusable). The same "winning" topic gets reused because the system doesn't enforce that content locks out.

By baking the distinction into the data model and the experiment framework, we make the right thing easy and the wrong thing difficult. A framework experiment automatically updates the framework library. A content experiment automatically writes to `content_concepts` with lookback. No manual disambiguation required.

## Experiment Types Supported in v1

| Type | Class | Example |
|------|-------|---------|
| `subject_line` | content | Test 5 subject lines for the same send |
| `subject_line_pattern` | framework | Test 5 subject line *patterns* (question, contrarian, numbered, declarative, named) |
| `send_time` | framework | Test 4 different send times for the same brand |
| `cta` | content | Test 3 CTA copies for the same send's call-to-action |
| `cta_pattern` | framework | Test 3 CTA *patterns* (urgency, curiosity, value, social proof) |
| `opening_framework` | framework | Test 5 opening framework structures with same content |
| `closing_framework` | framework | Test 5 closing framework patterns |
| `topic` | content | Test 3 topics for tomorrow's Tactic |
| `section_order` | framework | Test rearranging Worth Knowing before vs after Tactic |
| `persona_target` | framework | Test which persona segment a given content type best serves |

Each type has a typed schema for `variant_definition` (the JSONB column in `experiment_variants`). The schema is enforced at experiment creation. Mismatched variants (e.g., different schemas for variants of the same experiment) fail validation.

## The 50-Variant Micro-Test Pattern

The defining capability. A single declarative experiment that:

1. Splits 5% of the brand's active list into 50 random variant groups (or any 2-50 variant count).
2. Sends each group its assigned variant.
3. Waits for a measurement window (typically 1-4 hours).
4. Computes the success metric per variant.
5. Identifies the winner (or top-N) based on the configured criteria.
6. Sends the winner to the remaining 95% of the list.
7. Records the experiment with full results.
8. Feeds learning into the brain (framework or content depending on experiment class).

### Declarative Definition

```typescript
const experiment: Experiment = {
  brand_id: "castor_abbott",
  name: "Subject line micro-test for tomorrow's tactic",
  experiment_type: "subject_line",
  experiment_class: "content",
  hypothesis: "Question-style subject lines outperform declarative for tactic content among Solo Operators",
  success_metric: "click_through_rate",
  measurement_window_hours: 4,
  test_audience_pct: 5.0,       // 5% gets variants
  variant_count: 50,             // 50 different variants
  rollout_strategy: "winner_to_remaining",  // Winning variant rolls out to remaining 95%
  confidence_threshold: 0.85,    // Lower threshold OK for content experiments
  minimum_per_variant: 100,      // Need at least 100 recipients per variant for valid signal
  fallback_strategy: "send_default",  // If no clear winner, send a pre-specified default variant
};
```

The platform's experiment runner orchestrates everything from this declaration. The human (or agent) that proposed it doesn't manage individual variants or recipient assignments.

### Variant Definition

For a 50-variant experiment, variants can be:

**Manually specified** (small variant counts, typically 2-10):
```typescript
const variants = [
  { name: "v1", definition: { subject_line: "The 15-minute ritual that separates closers from pitchers" } },
  { name: "v2", definition: { subject_line: "Why your discovery calls are losing winnable deals" } },
  // ...
];
```

**LLM-generated** (large variant counts, typically 20-50):
```typescript
const variantSpec = {
  count: 50,
  generator_role: "subject_line_variant_generator",
  base_content: episode,
  variant_dimension: "subject_line_pattern",   // Vary along this dimension
  diversity_constraint: "high",                // Force genuinely different variants
};

// Variants are generated via the LLM client at experiment launch time
const variants = await generateVariants(variantSpec);
```

The LLM-generated approach lets the platform produce diverse variant pools efficiently. A `subject_line_variant_generator` block (model role configurable per `01_foundation`'s pattern) takes the base content and generates the requested number of variants along the specified dimension. The generated variants are validated for diversity (no near-duplicates) and quality (no malformed strings, length within constraints) before launch.

### Recipient Allocation

The 5% test audience gets randomly assigned to variants. Random allocation is per-subscriber, hash-based on `(experiment_id, subscriber_id)` so allocation is deterministic and reproducible.

```typescript
function assignVariant(experimentId: string, subscriberId: string, variantCount: int): int {
  const hash = sha256(`${experimentId}:${subscriberId}`);
  return parseInt(hash.slice(0, 8), 16) % variantCount;
}
```

Why hash-based: deterministic. If allocation is recomputed (e.g., a subscriber is added to the test audience after initial allocation), the same subscriber gets the same variant. This matters for A/B test integrity and for replay/audit.

### Measurement Window

After variants are sent, the platform waits for the configured measurement window (default 4 hours for content experiments, 24-72 hours for framework experiments). Engagement events flow in via the webhook ingestion (per `06_distribution_platform`). The platform aggregates per-variant performance.

At the end of the window:

1. Compute success metric per variant.
2. Apply minimum-recipient threshold per variant (variants with < `minimum_per_variant` recipients are excluded — too small a sample for reliable signal).
3. Apply statistical analysis (Bayesian by default) to identify the variant with the highest probability of being the true winner.
4. If confidence threshold is met, declare winner. If not, log "no winner" and apply the fallback strategy.

### Statistical Method

**Bayesian preferred for v1.** Frequentist (traditional p-value) is acceptable; Bayesian gives a more intuitive "probability of being best" interpretation that's easier to explain in the admin UI.

Default Bayesian setup:
- Beta prior for click-through experiments (uniform Beta(1,1) prior is fine for v1)
- Posterior updated with observed clicks/impressions per variant
- "Probability of being best" computed as sampling from posteriors and counting wins

A library like `@stdlib/stats` handles the math; we don't reinvent statistical primitives. Implementation choice deferred — pick a maintained library and document in an ADR.

### Rollout

When a winner is declared, the platform sends the winning variant to the remaining 95% of the list (subscribers not in the test audience). This is a regular send execution — same `sends` row pattern, just with `experiment_id` and `variant_id` populated.

If no winner is declared (insufficient confidence), the fallback strategy executes:

- `send_default` — Send a pre-specified default variant
- `send_top_score` — Send whichever variant scored highest, even without confidence
- `cancel_send` — Cancel the send entirely (rare; only for catastrophic experiments)
- `human_decide` — Pause and queue for human decision in the admin UI

## Statistical Design Per Experiment Class

### Content Experiments

- Confidence threshold: 0.85 default (lower because the cost of being wrong on one send is small)
- Minimum sample per variant: 100 recipients (provides reasonable signal for engagement metrics)
- Measurement window: 1-4 hours (most click-through happens in the first 2 hours of email life)
- Holdback: optional (typically not needed for content experiments)

### Framework Experiments

- Confidence threshold: 0.95 default (higher because winners get promoted to the framework library, affecting many future generations)
- Minimum sample per variant: 500-1000 recipients (need more signal because variance is higher across content instantiations)
- Measurement window: 24 hours minimum, often 4 weeks rolling (for compound signal)
- Holdback: required (5-10% of audience excluded from the experiment to measure absolute effect, not just relative variant performance)

### Why the Asymmetry

Content experiments affect one send. If we get a content experiment wrong, the next send fixes it. The cost of false confidence is small.

Framework experiments affect future framework selection across many sends. A framework promoted on weak signal gets used in dozens of generations before its underperformance becomes obvious. The cost of false confidence is large. Higher thresholds and longer windows are the price of avoiding bad framework promotion.

## Experiment Proposal: Human and Agent

Experiments can be proposed by humans (through the admin UI) or by agents (via the learning analyzer producing experiment proposals as a class of learning).

### Human-Proposed

Through the admin UI:

1. Click "New experiment"
2. Select experiment type (content or framework class)
3. Define hypothesis, variants, success metric, allocation, measurement window
4. Submit for approval

Approval is automatic for some experiment types (e.g., subject line content experiments are low-risk and within-policy by default). High-risk experiments (e.g., voice module changes) require explicit approval per the optimization policies in `09`.

### Agent-Proposed

The learning analyzer produces experiment proposals when it detects testable hypotheses:

```typescript
{
  learning_type: "experiment_proposal",
  statement: "Question-style subject lines have shown 22% higher click-through in observational data over the last 60 days. Recommend a controlled experiment to validate.",
  evidence: {
    observed_lift: 0.22,
    sample_size: 47,
    confidence: 0.78,        // Below confidence threshold for direct application; suggests experiment
  },
  proposed_experiment: {
    experiment_type: "subject_line_pattern",
    experiment_class: "framework",
    hypothesis: "Question-style subject lines outperform declarative for tactic content",
    success_metric: "click_through_rate",
    variant_count: 4,
    test_audience_pct: 10.0,
    measurement_window_hours: 72,
    confidence_threshold: 0.95,
  },
  requires_human_approval: true,  // Per learning mode
}
```

Whether the proposed experiment runs depends on the brand's learning loop mode and optimization policies:

- In `disabled` or `observe_only` mode, the proposal surfaces in the admin UI but doesn't auto-run
- In `human_approved` mode, every agent-proposed experiment requires explicit approval
- In `semi_autonomous` mode, low-risk experiments auto-approve (subject line content tests); high-risk experiments queue for approval
- In `fully_autonomous` mode, agent-proposed experiments auto-approve when confidence and policy thresholds are met

This makes the experiment framework agent-native. Most learning systems require humans to translate insights into experiments. Ours lets the analyzer do the translation directly, with humans in the loop where the policy demands.

## Block: `experiment_runner`

The orchestrator block that executes an approved experiment.

**Input schema:**
```typescript
{
  experimentId: string,
  brandId: string,
  triggeredAt: string,
}
```

**Behavior:**

1. Load experiment definition.
2. Verify status is `approved` (not `running`, `concluded`, `cancelled`).
3. Update status to `running`, set `started_at`.
4. Generate variants (manual definitions exist, or LLM-generated based on `variant_spec`).
5. Validate variants (diversity, quality, schema match).
6. Insert `experiment_variants` rows.
7. Compute test audience (random sample of `test_audience_pct` of active subscribers for the brand).
8. Allocate test audience to variants (hash-based deterministic allocation).
9. For each variant: create a `sends` row with `experiment_id` and `variant_id` populated.
10. Schedule sends for immediate execution.
11. Schedule the measurement window completion job (e.g., a delayed job that runs after `measurement_window_hours` to evaluate results).
12. Return the running experiment status.

**Voice modules composed:** None directly — this block doesn't generate content. It generates structure and triggers downstream blocks. Variant generation (when LLM-based) happens in a separate `variant_generator` block per the experiment type.

**Model role:** None (orchestrator is pure code with downstream LLM calls).

### Variant Generator Blocks

Per experiment type, a variant generator block exists when LLM-based variant generation is needed. Examples:

- `subject_line_variant_generator` — generates N diverse subject line variants
- `cta_variant_generator` — generates N diverse CTA copies
- `opening_framework_variant_generator` — generates N opening pattern variants

Each follows the standard block contract from `04_content_pipeline`. Voice modules composed include the brand's voice modules plus a variant-generation-specific module that emphasizes diversity.

**Model role:** `experiment.variant_generator`. Default: Sonnet 4.5 at temperature 0.7 (high temperature for diversity), fallback to Opus.

## Block: `experiment_evaluator`

Runs at the end of the measurement window to evaluate results and declare winner.

**Input schema:**
```typescript
{
  experimentId: string,
  brandId: string,
}
```

**Behavior:**

1. Load experiment and variants.
2. For each variant, query `send_events` to compute success metric:
   - For `click_through_rate`: count unique clickers / sent
   - For `open_rate`: count unique openers / sent
   - For `reply_rate`: count replies / sent
   - For `click_section`: count clicks attributed to specific section / sent
3. Apply minimum-sample threshold; exclude variants below threshold.
4. Apply statistical analysis to identify winner (Bayesian probability-of-being-best computation).
5. Check confidence against threshold.
6. If winner declared:
   - Update experiment status to `concluded` with `winning_variant_id` set.
   - Trigger rollout (send winning variant to remaining audience if `rollout_strategy = winner_to_remaining`).
   - Update `experiment_variants.is_winner` for winning variant.
   - Persist `results_summary` (statistical breakdown, sample sizes, observed metrics).
7. If no winner:
   - Apply fallback strategy.
   - Log no-winner outcome with full statistical detail.
8. Feed results into the brain (per learning loop mode):
   - Framework experiments: update framework concept performance scores.
   - Content experiments: write performance observations.
9. Audit log the conclusion.

**Implementation:** Pure code. No LLM call. Statistical libraries handle the math.

## Integration with the Learning Loop

Experiment results are not separate from the brain's performance attribution; they feed into the same data model.

### For Framework Experiments

When a framework experiment concludes, the winning framework's performance score updates. If the framework was `experimental` and now meets promotion criteria, it becomes `active` (per `05_brain_and_learning` rules).

Example: A subject line pattern experiment with 4 variants concludes. The "question style" variant wins with 95% confidence. The system:

1. Identifies the framework concept ID for "question_style_subject_line" in `framework_concepts`.
2. Updates the framework's performance score with the experiment's observed metrics.
3. If status was `experimental`, increments evidence count. Promotion to `active` happens via the standard promotion criteria.
4. The next pipeline runs that consult framework performance see the updated score.

### For Content Experiments

When a content experiment concludes, the winning content gets persisted to `content_concepts` with `lookback_until` set. The losing variants also get persisted (as alternatives that were evaluated, not used). Performance observations are recorded for the winner.

Example: A topic experiment with 3 variants concludes. The "fee compression vs. flat fee" topic wins. The system:

1. The winning topic ships in the live send.
2. The topic concept gets written to `content_concepts` with `lookback_until = now() + 90 days`.
3. The other two topics also get written to `content_concepts` (so they don't get re-proposed) with shorter `lookback_until = now() + 30 days` (since they were tested but not used; the cooling-off can be shorter).
4. Performance observations record the engagement on the winner.

## Multi-Brand Experiments

Phase 5+ capability. Cross-brand framework experiments — testing a pattern across multiple brands simultaneously to produce stronger signal.

**Constraints:**
- Only allowed for framework experiments (content can't transfer)
- Each brand's audience treatment is statistically independent
- Results are aggregated through `cross_brand_patterns` (per `05_brain_and_learning` privacy rules)
- Requires explicit approval per participating brand

Schema is in place from day one. Implementation deferred. The architecture supports it; the v1 build doesn't include it.

## Open Decisions for the Dev Team

- **Specific Bayesian library:** Recommend `@stdlib/stats` or similar. Decided in ADR.
- **Whether to support sequential testing (vs. fixed-window):** Sequential testing (where the experiment can conclude early if confidence is reached) is more efficient. Fixed-window is simpler. v1 fixed-window; sequential as Phase 2+ enhancement.
- **Whether holdbacks are stored as a separate variant or as a flag on subscribers:** Lean toward a special "control" variant with explicit "no experiment" treatment, for symmetry with regular variants.
- **Maximum variant count:** Spec says 50; could go higher with caveats about minimum-per-variant. Don't enforce a hard cap; let the minimum-sample logic produce sane behavior.
- **Whether to support experiments that span multiple sends:** Some framework experiments might want to test across 5 consecutive Tactic sends rather than 5 variants in one send. Not in v1; would require significant lifecycle additions.
- **Whether agent-proposed experiments require an `agent_id` field:** Yes, recommend it for audit. Per-agent experiment proposal patterns become observable.
- **How to handle subscriber unsubscribes mid-experiment:** Subscribers who unsubscribe between variant assignment and the measurement window should still have their assignment recorded but be excluded from rollout.

## Acceptance Criteria

The experiment framework is complete when:

- [ ] `experiments` and `experiment_variants` tables exist with all columns and indexes from `02_data_model`.
- [ ] All 10 experiment types listed in this spec have validated variant schemas.
- [ ] The `experiment_runner` block is implemented and tested with manual variant definitions.
- [ ] LLM-based variant generation works for at least subject lines and CTAs.
- [ ] Hash-based deterministic allocation produces consistent assignments across recomputation.
- [ ] The `experiment_evaluator` block computes success metrics correctly for all supported metric types.
- [ ] Bayesian statistical analysis is implemented and tested with synthetic data.
- [ ] Confidence thresholds are configurable per experiment with documented defaults per class.
- [ ] Minimum-sample thresholds correctly exclude underpowered variants.
- [ ] Winner rollout sends the winning variant to remaining audience.
- [ ] All four fallback strategies work (send_default, send_top_score, cancel_send, human_decide).
- [ ] Framework experiment results update `framework_concepts` performance scores.
- [ ] Content experiment results write to `content_concepts` with appropriate `lookback_until`.
- [ ] Agent-proposed experiments arrive correctly through the learning analyzer's output.
- [ ] Approval gates work per the brand's learning mode and optimization policies.
- [ ] An end-to-end test verifies the 50-variant micro-test pattern: 50 subject line variants generated → sent to 5% test audience → measured at 4 hours → winner declared with sample data → rolled out to remaining 95%.
- [ ] An integration test verifies framework experiment promotion: experimental framework wins → score updates → promotion to active triggers correctly.
- [ ] An integration test verifies content experiment lockout: winning topic locks out for 90 days; losing topics lock out for 30 days; subsequent topic proposers correctly exclude all three.
- [ ] Experiments respect the brand's learning loop mode: in `disabled` mode no experiments auto-run, in `observe_only` agent proposals surface but don't run autonomously, in `semi_autonomous` low-risk experiments auto-run.
- [ ] All experiment lifecycle transitions write to `audit_log`.

---

**Next:** Read `08_review_interface.spec.md` for the Next.js admin UI — review queue, edit-before-send, performance dashboard, experiment management, model configuration.
