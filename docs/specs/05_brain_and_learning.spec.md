---
spec: 05_brain_and_learning
title: Brain & Learning Loop
version: 1.0
status: draft
audience: dev_team, agentic_orchestrator
dependencies:
  - 00_overview
  - 01_foundation
  - 02_data_model
  - 04_content_pipeline
consumed_by:
  - 06_distribution_platform
  - 07_experiment_framework
  - 09_optimization_policies
  - 10_observability
purpose: Define the brain (concept storage, duplicate prevention, variety enforcement) and the closed feedback loop that turns sends into learning. The architectural distinction between framework concepts (reusable) and content concepts (locked-out) is hard-coded into the data model and is the system's defining capability.
---

# Brain & Learning Loop

## What This Spec Covers

The brain — the persistent memory of what the system has produced and what has worked. The architectural separation between framework concepts (reusable structural patterns) and content concepts (specific topics, destinations, recommendations that lock out for configurable windows). The variety enforcement layer that prevents the optimizer from collapsing into a local maximum. The closed feedback loop that turns every send into training data for the next generation cycle. The cross-brand knowledge layer that lets learning compound across the four brands without leaking brand-specific IP.

The spec also defines **learning loop modes** — a per-brand configuration that controls how aggressively the system learns from production. Different brands and different teams have different appetites for autonomous learning. Some want full closed-loop autonomy. Some want learnings surfaced for human review and explicit approval. Some don't want learning at all and prefer a clean generation system with no inference layer. The platform supports the full spectrum.

This is the spec that makes the platform a learning system rather than just a generation system. It's also the spec most likely to need iteration during the build because some of the architectural choices here (lookback windows, similarity thresholds, exploration budgets) are calibrations that will refine in production. The structure is fixed; the parameters are tunable through `platform_config`.

## Why This Is Different

Three things distinguish this brain from anything that exists in current content platforms:

**Most systems have one concept layer.** They track "what has been produced" and try to avoid reproducing it. They cannot distinguish the structural pattern (which should be reused) from the specific content (which should not). When their optimizers find a winning pattern, they reproduce the entire piece — same structure, same content, same readers — until the pattern stops winning. Then they're stuck with no fallback because the brain doesn't know what's reusable and what isn't.

**Most systems have no learning loop.** They generate content, send it, and the analytics dashboard reports what happened. The dashboard is for humans. The next generation cycle starts from scratch. Operators approximate learning manually with spreadsheets and gut feel.

**Most systems treat variety as emergent.** They assume that randomness in topic selection or some loose A/B test infrastructure produces enough variety. It doesn't. Without architectural variety enforcement, learning systems trend toward optimizer collapse — the local maximum gets exploited until the brand is unrecognizable.

This spec builds the alternative. Two-layer concept architecture. Closed feedback loop. Variety as a first-class constraint. Cross-brand learning with privacy isolation. None of these are research projects; they're well-defined engineering problems with implementations described below.

## The Two-Layer Concept Architecture

The most important architectural decision in this spec. Get this right and everything downstream works. Get it wrong and you've built another optimizer-collapse machine.

### Framework Concepts

A framework concept is a reusable structural pattern. It does not contain specific content. It describes *how* something is structured, framed, opened, closed, or sequenced.

Examples of framework concepts:

- **Opening pattern:** "Open with a contrarian stat that exposes the say/do gap, then twist the knife in the third sentence." This is a reusable structure. It can apply to fee compression, prospecting, niche selection, anything. The structure is portable.
- **Section flow:** "Famous option → better alternative → 3-4 specific advantages → booking intelligence → when it's worth it." This is the Type #2 Luxury Insider Intelligence flow. Portable across destinations.
- **Voice mechanism:** "Use the kitty litter test — at least one irreverent dig per piece." Portable across topics.
- **Closing pattern:** "End with a one-line mic drop that lands as conviction, not hedge."

Framework concepts have:
- A semantic embedding (for similarity queries)
- A framework family classification (`opening_pattern`, `closing_pattern`, `section_structure`, `voice_mechanism`)
- A status (`active`, `experimental`, `deprecated`)
- A performance score (computed from observed engagement when this framework is used)
- A use count and last-used timestamp
- Example realizations (past concrete uses, used as few-shot prompt examples)

Framework concepts are *not* locked out of reuse. A high-performing framework can be used many times. The system's optimization layer rewards their reuse — within the variety constraints.

### Content Concepts

A content concept is a specific topic, destination, recommendation, or factual claim. It contains the *what*, not the *how*.

Examples of content concepts:

- "Boise, Idaho whitewater learning trip"
- "Tactic: 15-minute pre-meeting client research ritual"
- "Cadillac CT5-V Blackwing as the unrecognized sports sedan"
- "The Costco Kirkland Reserve Stags Leap Cab insider tip"
- "The take that demographic niches have hit saturation"

Content concepts have:
- A semantic embedding
- A surface form (human-readable name)
- A section name (`cover_story`, `tasting_menu_item`, `tactic`, `the_drive`)
- A `lookback_until` timestamp (computed at write time based on section's configured lookback window)
- A `hard_blocked` flag (for permanent exclusions)

Content concepts are locked out of reuse within their lookback window. After lookback expires, they become eligible again — but the system continues to track their past usage and avoid clustering.

### Why Hard Architectural Separation, Not Just a Flag

A naive design would have one `concepts` table with a `reusable: boolean` column. Resist this. The two layers want different operations:

- Framework concepts get queried by performance score (find highest-performing opening patterns for tactic content with Solo Operator audiences).
- Content concepts get queried by exclusion (find all destinations to *avoid* in the next cover story).
- Frameworks get attribution from many content uses (the same opening pattern appears in 30 episodes).
- Content concepts get attribution from one episode and then lock out.

These are different access patterns, different lifecycle semantics, different update logic. Putting them in one table forces the application code to constantly disambiguate. Putting them in separate tables makes the architecture visible and the code simple.

The `framework_content_usage` junction table (defined in `02_data_model`) is what links them — every section's generation records which framework concepts it used. When that section's performance data arrives, performance attributes to both layers: the content concept gets one observation, the framework concepts get aggregated observations across all their uses.

This is the engine that powers the closed feedback loop. Performance flows up to frameworks (durable learning) and is recorded at content (one-time learning, then locked out).

## Brain Operations

Three core operations: write concepts, query for duplicates, query for performance.

### Operation 1: Concept Extraction and Persistence

After a pipeline run produces a final episode, an extraction step identifies the concepts in each section and writes them to the brain.

**Trigger:** End of pipeline, after `quality_gate` passes (or after 3 revisions exhausted). Before the episode is queued for review.

**Process:**

1. For each section in the episode, the extractor identifies content concepts and framework concepts.
2. Content concepts: extracted from the section's substantive content (the destination, the tactic, the recommended item, the topic). One concept per section, in most cases. Tasting Menu has one content concept per item (typically 3).
3. Framework concepts: extracted by analyzing the section's structural and voice patterns. This is LLM-assisted. The extraction prompt looks at the section and identifies which patterns it embodies.
4. Each concept gets embedded via `text-embedding-3-large` (1536 dims).
5. Content concepts are inserted into `content_concepts` with `lookback_until = now() + lookback_window_for_section`.
6. Framework concepts: deduplicated against existing frameworks via similarity search (cosine threshold 0.92 — very high, because we want to recognize the same framework being used again, not introduce a new framework variant for every minor wording change). Existing matches get their `use_count` incremented and `last_used_at` updated. Genuinely new frameworks get inserted as `experimental` status.
7. `framework_content_usage` rows are created linking each content concept to the framework concepts it embodied.

**Block: `concept_extractor`**

```typescript
{
  brandId: string,
  runId: string,
  episodeId: string,
  episode: EpisodeDraft,
}
```

Output:

```typescript
{
  content_concepts_written: number,
  framework_concepts_matched: number,    // Existing frameworks confirmed
  framework_concepts_created: number,    // New experimental frameworks
  usage_links_created: number,
}
```

**Voice modules composed:** Just `core/llm-output-discipline` plus a concept-extraction-specific module that defines the framework concept schema and extraction guidelines. This is one of the few blocks that does not load the brand voice — the extractor is identifying patterns, not writing in voice.

**Model role:** `concept.extractor`. Default: Sonnet 4.5 at temperature 0, reasoning disabled. Hot-swappable.

**Critical behavior:** Concept extraction happens *after* the episode is finalized, not during writing. Writing-time extraction would commit concepts that the editor might rework. Post-edit extraction sees the actual published content.

### Operation 2: Duplicate-Prevention Queries

Before a writer or proposer block generates new content, the brain is queried to identify what to avoid.

**Pattern:**

```typescript
const exclusions = await brain.getExclusions({
  brandId: "castor_abbott",
  sectionName: "cover_story",
  contentType: "type_1",
});

// Returns:
{
  hardBlocked: ["lodge_cast_iron", "le_creuset", "four_thousand_weeks"],
  inLookback: [
    { surfaceForm: "Boise whitewater learning trip", embedding: [...], lookbackUntil: "..." },
    { surfaceForm: "Charleston food tour", embedding: [...], lookbackUntil: "..." },
    // ... last N concepts within lookback window
  ],
  exhaustedFormulas: [
    "overlooked_destination_off_season_anti_aspirational",  // Used 3+ times in last 12 weeks
  ],
  recentlyUsedContentTypes: ["type_1", "type_4", "type_1"],  // Last 12 weeks
}
```

The proposer block uses these exclusions in its prompt context: "Avoid these specific concepts; avoid these formulas; rotate away from recently-used content types."

The validator block uses the same data for the rejection logic: if the proposer returns a destination similar to anything in `inLookback` (cosine similarity > 0.85), the validator rejects.

**Implementation:** SQL query with vector similarity. No LLM call.

```sql
-- Hard-blocked
SELECT surface_form FROM content_concepts
WHERE brand_id = $1 AND section_name = $2 AND hard_blocked = true;

-- In lookback
SELECT surface_form, concept_embedding, lookback_until
FROM content_concepts
WHERE brand_id = $1 AND section_name = $2
  AND (lookback_until > now() OR hard_blocked = true);

-- Formula exhaustion (last 12 weeks)
SELECT positioning_formula, count(*) as use_count
FROM episodes
WHERE brand_id = $1 AND created_at > now() - interval '12 weeks'
GROUP BY positioning_formula
HAVING count(*) >= 3;
```

### Operation 3: Performance Queries

The learning loop queries the brain for what's working.

**Pattern:**

```typescript
const performance = await brain.getFrameworkPerformance({
  brandId: "castor_abbott",
  frameworkFamily: "opening_pattern",
  contentType: "tactic",
  audienceSegment: "highest_engagement",  // Optional: filter by which segment engaged
  recencyWindow: "90_days",
});

// Returns:
[
  {
    frameworkId: "...",
    frameworkName: "say_do_gap_with_knife_twist",
    useCount: 12,
    avgLoveRate: 71.4,
    avgClickThroughRate: 8.2,
    avgReplyRate: 1.4,
    confidence: 0.85,                       // Statistical confidence
    lastUsedAt: "2026-04-22",
  },
  // ... more frameworks ranked by composite performance score
]
```

The writer block can use these in its system prompt: "These framework patterns have performed well recently for tactic content with Solo Operators. Consider using them when natural — but variety enforcement may require otherwise."

**Implementation:** SQL aggregation against `send_events` joined through `sends → episodes → episode_sections → framework_content_usage → framework_concepts`. The query is non-trivial but well-bounded; cached for 1 hour at the brain layer.

## Lookback Windows: Configurable per Section

Different sections need different lockout windows. A specific cover-story destination probably shouldn't repeat for a long time. A tasting menu item can come back sooner because items are smaller and the audience won't notice as quickly. Some items (Lodge cast iron, Costco Kirkland Reserve) are evergreen recommendations and shouldn't be locked out at all.

Default lookback windows:

| Section | Default Lookback | Rationale |
|---------|------------------|-----------|
| `cover_story` | 270 days (9 months) | Major editorial focal point. Reuse sooner reads as repetitive. |
| `tasting_menu_item` | 90 days | Smaller items. Three per send = 156/year volume. Shorter lockout makes math work. |
| `hosts_corner` | 180 days | Cooking techniques. Long enough that reuse feels intentional, not lazy. |
| `the_drive` | 270 days | Vehicle recommendations. Audience notices repeats here. |
| `sunday_prep` | 90 days | Tactical hacks. Shorter window appropriate. |
| `tactic` | 180 days | Weekday tactics. Same logic as Hosts Corner. |
| `take` | 270 days | Editorial positions. Repeating a take too soon undermines authority. |
| `topic_concept` | 90 days | Underlying topic clusters. Shorter than specific takes. |

These are configurable per brand via `platform_config`:

```typescript
{
  key: "brain.lookback_windows.castor_abbott",
  value: {
    cover_story: { days: 270 },
    tasting_menu_item: { days: 90 },
    hosts_corner: { days: 180 },
    the_drive: { days: 270 },
    sunday_prep: { days: 90 },
    tactic: { days: 180 },
    take: { days: 270 },
    topic_concept: { days: 90 },
  },
}
```

Brand-specific tuning happens via `platform_config` overrides. Treasure Financial's audience reads at lower frequency, so its lookbacks might be shorter; Castor Abbott's audience is daily and notices repeats fast.

**Hard-blocked items** are never eligible for reuse regardless of window. The hard-blocked list is curated content concepts that should never appear again (Lodge cast iron, Le Creuset, scripted referral asks for weekday). Adding to the hard-block list is a manual operation through the admin UI.

## Variety Enforcement: The Three Layers

Variety is not emergent in this system. It's enforced at three structural layers, each with different mechanism and timing.

**Important: Layer 1 and Layer 3 run in all learning loop modes (including `disabled`).** They're operational hygiene, not learning. Layer 2 (Mandatory Exploration Budget) requires learning data to make sensible decisions about what to explore — in `disabled` and `observe_only` modes, Layer 2 falls back to round-robin rotation rather than performance-informed exploration. See "Learning Loop Modes" below.

### Layer 1: Framework-vs-Content Separation (Architectural)

Documented above. Frameworks reuse; content doesn't. This is the structural layer that prevents the most catastrophic optimizer-collapse failure mode (winning piece → reproduce same piece → audience notices → engagement crashes).

This layer requires no runtime logic. It's enforced by the data model. Runs in all modes.

### Layer 2: Mandatory Exploration Budget (Policy)

Even when frameworks have proven performance, the system reserves a configurable percentage of generation decisions for exploration. This prevents the second-order failure: winning frameworks → only winning frameworks ever used → eventual collapse as the audience saturates on those frameworks too.

In modes that have performance data (`semi_autonomous` and `fully_autonomous` after sufficient data accumulation), the exploration budget targets *under-tested* frameworks specifically. In modes without active performance influence (`disabled`, `observe_only`, `human_approved` for unapproved learnings), the budget falls back to round-robin rotation across the framework library, ensuring variety without performance bias.

**Configuration:**

```typescript
{
  key: "brain.variety.exploration_budget",
  brand_id: "castor_abbott",
  value: {
    minimum_pct_using_under_tested_frameworks: 20,
    minimum_pct_targeting_underserved_personas: 15,
    minimum_pct_using_experimental_frameworks: 10,
  },
}
```

**How it's enforced:**

When a writer block is about to generate, the orchestrator checks the recent generation history (last 4 weeks) and computes:
- What percentage used top-quartile frameworks vs. lower-quartile or experimental
- What percentage targeted highest-engagement personas vs. moderate or at-risk
- What percentage used experimental (status: `experimental`) frameworks

If any of these falls below the configured minimum, the orchestrator passes a *constraint* to the writer block: "This generation must use an under-tested framework" or "This generation should target an underserved persona segment." The writer's voice modules and content type modules constrain how it generates within that constraint.

This is policy, not optimization. The variety budget is set by humans (Mark, eventually brand admins) and enforced by the orchestrator. The learning loop operates *within* the budget, never against it.

### Layer 3: Cluster Prevention and Surprise Quotient (Runtime)

The third layer is runtime enforcement on individual generations. Three constraints:

**Cluster prevention:**
- No more than 2 consecutive sends in the same content type (per edition)
- No more than 2 consecutive sends in the same framework family (per content type)
- No more than 1 consecutive send targeting the same primary persona

These constraints are checked before generation begins. The proposer/topic-selector blocks see them as additional exclusions.

**Persona rotation:**
- Track which personas have been the "primary target" across recent sends
- Force rotation toward underserved personas at configurable intervals

The persona panel is calibrated against actual segment engagement. The "primary target" of a send is the persona segment whose love score most differentiated this send from the average. Over time, persona rotation ensures every segment gets content tuned to them.

**Surprise quotient:**
- A computed measure of how much the proposed generation differs from recent sends across multiple dimensions (content type, framework family, persona target, embedding-similarity to recent topics)
- Below a threshold, the system rejects its own plan and requires re-proposal

This is the "would this feel like more of the same?" check. If the proposed generation scores below the surprise threshold, the orchestrator rejects and the proposer is re-invoked with the failure context. Maximum 3 surprise-quotient retries before flagging for human review.

The surprise quotient threshold is configurable per brand. Brands with broader audiences and slower send cadence can have higher thresholds. Daily Grind subscribers see 5 sends per week; a sub-threshold day in their inbox is more noticeable than for a brand sending once a week.

## Learning Loop Modes

Not every brand wants the same level of autonomous learning. The platform supports five modes, configured per brand. The mode determines how aggressively the system learns from production data and how much human approval the learning loop requires.

### The Five Modes

**`disabled`** — No learning loop at all. The brain captures sends and events for archival purposes (operators may want analytics dashboards regardless), but performance attribution does not flow into framework scoring, persona calibration, or generation decisions. The learning analyzer does not run. Variety enforcement still operates at the structural level (cluster prevention, lookback windows, hard-blocked items, surprise quotient) — these are operational hygiene, not learning. Generation is purely informed by voice modules and brain duplicate-prevention. This is what current MindStudio-style systems do. Appropriate for: brands that want predictable, unchanging editorial behavior; teams uncomfortable with autonomous adaptation; the early weeks of a new brand's launch before there's enough data for learning to mean anything.

**`observe_only`** — The full learning infrastructure runs. Performance events are attributed. Performance scores are computed. The learning analyzer produces structured learnings. But none of it influences generation. The brain queries return performance data; writer blocks ignore it. Variety enforcement based on learning is suppressed. Frameworks do not auto-promote. Persona weights do not auto-adjust. The output is human-readable insights surfaced in the admin UI. The team reviews the insights and acts on them manually if they choose — by changing voice modules, adjusting platform_config, or moving the brand to a more autonomous mode. Appropriate for: teams that want the analytics value without the autonomous behavior; brands in their first 2-3 months of operation while operators learn what the system observes; teams with strong editorial conviction who want to make all editorial calls themselves.

**`human_approved`** — The learning loop generates structured learnings and queues every actionable one for explicit human approval. Even low-risk learnings (auto-promote experimental → active when criteria met) require a brand admin to click approve. Approved learnings then influence the next generation cycle and feed into future analysis. Rejected learnings are logged with the rejection reason and excluded from re-proposal for a configurable cooling-off period. Appropriate for: regulated environments where every autonomous action needs an audit trail with human signoff; teams that want learning but require deliberation; brands in months 3-6 of operation, transitioning from observe-only as confidence builds.

**`semi_autonomous`** — Default mode for Castor Abbott in Phase 3+. Low-risk learnings apply automatically; high-risk learnings require human approval.

  *Low-risk (auto-applied):*
  - Promotion of experimental frameworks to active status when criteria are met
  - Variety budget enforcement adjustments (e.g., increasing exploration in response to detected clustering)
  - Persona weight adjustments based on calibration drift
  - Cluster prevention triggering when consecutive content type usage hits the limit

  *High-risk (require human approval):*
  - Deprecation of active frameworks
  - Changes to voice module composition in `brand_voice_configs`
  - Changes to exploration budget thresholds
  - Changes to lookback windows
  - New persona introduction
  - Persona deprecation

  Appropriate for: brands with established editorial maturity and a brand admin actively engaged with the system; brands where speed of iteration matters; the steady-state operating mode for most production brands after a calibration period.

**`fully_autonomous`** — All learnings apply automatically when the analyzer's confidence threshold is met. No human approval required for any category. The system can deprecate frameworks, adjust voice configs, change exploration budgets, introduce new personas — all autonomously. Audit log captures every autonomous action; brand admins can review historically but don't gate decisions in real-time. Appropriate for: brands operating at scale with high send volume; mature brands where the cost of human review delay outweighs the value of human deliberation; advanced operators who trust the calibration data and want maximum velocity.

### Configuration

Mode is a per-brand `platform_config` row:

```typescript
{
  key: "brain.learning_mode",
  brand_id: "castor_abbott",
  environment: "production",
  value: {
    mode: "semi_autonomous",
    enabled_at: "2026-04-29T...",
    enabled_by: "user_uuid",
    cooling_off_period_days: 14,         // Rejected learnings can't be re-proposed for this long
    confidence_thresholds: {
      auto_apply: 0.85,                  // Min confidence for auto-apply in semi/fully autonomous modes
      require_approval: 0.65,            // Min confidence to even surface a learning in human_approved
      observation_only: 0.50,            // Min confidence to surface in observe_only mode
    },
  },
}
```

Mode changes are logged in `audit_log` with `actor_type = "human"`, `actor_id = brand_admin_user_id`, `action = "change_learning_mode"`, capturing both the old and new mode.

### Architectural Separation: What Always Runs vs. What's Mode-Gated

This separation matters and is worth being explicit about.

**Always runs regardless of mode:**
- Concept extraction and persistence (the brain captures everything for forensic and replay purposes)
- Duplicate prevention queries (lookback windows, hard-blocks, similarity exclusions)
- Cluster prevention (structural variety hygiene)
- Surprise quotient checks
- Persona panel evaluation during generation (this is the synthetic prediction layer, not learning from real data)
- Send event ingestion (we always capture events even if we don't act on them)

**Mode-gated:**
- Performance attribution from events to concepts (`disabled` mode skips this)
- Framework performance score computation (`disabled` mode skips this)
- The learning analyzer's runs (`disabled` mode skips this)
- The brain returning performance signals to writer blocks (everything below `semi_autonomous` suppresses this)
- Auto-application of learnings (only in `semi_autonomous` for low-risk and `fully_autonomous` for all)
- Persona panel calibration adjustments (`disabled` and `observe_only` skip this; static weights are used)

The principle: structural quality enforcement (variety, hygiene, duplicate prevention) is platform behavior and runs everywhere. Learned-signal influence is opt-in per brand.

### Mode Transitions

Brands can move between modes at any time. Transitions handle the data correctly:

**Moving to a more autonomous mode** (e.g., `observe_only` → `semi_autonomous`): The system begins applying learnings going forward but does not retroactively apply pending learnings without explicit approval. The brand admin reviews the learning queue at transition time and approves any backlog they want to apply.

**Moving to a less autonomous mode** (e.g., `semi_autonomous` → `human_approved`): Already-applied learnings stay applied (they're part of the system state now). Future learnings that would have been auto-applied now queue for approval instead.

**Moving to `disabled`** from any other mode: The brain stops emitting performance signals to writer blocks immediately. The learning analyzer stops running. Existing performance data is preserved but inactive. Re-enabling later picks up where it left off.

### Default Mode per Brand

Phase 1 launch defaults:

| Brand | Phase 1 Default | Rationale |
|-------|-----------------|-----------|
| Castor Abbott | `disabled` | Phase 1 is foundation; no learning loop exists yet. Moves to `observe_only` in Phase 2, `semi_autonomous` in Phase 3. |
| Cortex | `disabled` | Same as Castor Abbott; will follow Castor Abbott's mode transitions. |
| Fidelon | `human_approved` | Most regulated brand. Even after maturity, may stay in `human_approved` indefinitely. |
| Treasure Financial | `observe_only` | B2C audience; team wants to observe behavior before allowing autonomous adaptation. |

These are starting points. Each brand's mode is independently configurable and can change as operators gain confidence with the system.

### Why Five Modes, Not Two

The naive design is on/off. I'd argue against it. The intermediate modes serve real distinct use cases:

- `observe_only` lets a team adopt the analytics value of the learning infrastructure without committing to autonomous adaptation. This is the natural starting mode for any new brand.
- `human_approved` is the regulated-industry mode. Some brands (especially Fidelon-adjacent ones) will live here permanently because their compliance posture requires human signoff on every consequential change.
- `semi_autonomous` is the steady state for most operational brands. Low-risk autonomy + human gates for high-risk changes is the sensible operating point.
- `fully_autonomous` is for brands that have earned trust through observed history and want maximum iteration speed.

Five modes also means upgrading is a small step rather than a leap. Going from `disabled` directly to `fully_autonomous` is a big commitment. Going `disabled` → `observe_only` → `human_approved` → `semi_autonomous` → `fully_autonomous` over six months as confidence builds is a sensible adoption path.



## The Closed Feedback Loop

The architectural achievement of this platform: send produces engagement data, engagement data feeds back into the brain, the brain informs the next generation cycle. No human-in-the-middle for the data flow itself; humans approve sends and policies, agents and structured data handle the loop.

**This entire section describes how the loop works when enabled. The Learning Loop Modes section above determines which parts of this loop run for a given brand.** In `disabled` mode, none of this section's machinery runs. In `observe_only` mode, everything runs except the brain serving performance signals to writer blocks. In `human_approved`, all of it runs but every actionable learning queues for approval. In `semi_autonomous` and `fully_autonomous`, the loop runs with progressively more autonomy.

### Flow Overview

```
┌─────────────────┐
│   Generate      │  Pipeline produces episode (using brain queries to inform choices)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Review        │  Human approves/edits/rejects in review UI
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Send          │  Resend delivers to subscribers
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Events        │  Webhooks fire for delivered, opened, clicked, replied, etc.
└────────┬────────┘     Events ingested into send_events table
         │
         ▼
┌─────────────────┐
│   Attribute     │  Events linked to episode → sections → content concepts → framework concepts
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Aggregate     │  Performance metrics computed per concept, per framework, per persona
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Learn         │  Learning analyzer produces structured learnings
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Inform        │  Brain serves performance data to next generation cycle
└─────────────────┘
```

The full event ingestion architecture is in `06_distribution_platform`. This spec covers the attribution, aggregation, and learning layers.

### Event Attribution

Every send_event row carries `send_id` (which links to `episodes`). A click event also carries `click_section` (parsed from the tracking parameter in the email URL).

When events arrive, an attribution job runs (via Postgres trigger or scheduled job) that:

1. For each click event with a non-null `click_section`, locate the corresponding `episode_section`.
2. Look up which `framework_concepts` were used in that section via `framework_content_usage`.
3. Insert performance observations: one for the content concept, one or more for the framework concepts.

For non-click events (open, reply, complaint, unsubscribe), attribution is at the episode level — these signal interest in the whole send, not a specific section.

### Performance Observations

A `performance_observations` table records every attribution event. (Defined here because it's brain infrastructure rather than distribution infrastructure.)

```sql
CREATE TABLE performance_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  observation_type text NOT NULL,                -- "open", "click_section", "reply_engaged", "unsubscribe", etc.
  episode_id uuid REFERENCES episodes(id),
  section_name text,                             -- For section-attributed events
  content_concept_id uuid REFERENCES content_concepts(id),
  framework_concept_ids uuid[],                  -- Multiple frameworks per section
  persona_targeted text,                         -- Which persona was the primary target
  segment text,                                  -- "highest_engagement", "moderate", "at_risk"
  observed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT performance_observations_type_valid CHECK (
    observation_type IN ('open', 'click_section', 'reply_engaged', 'reply_complaint', 'unsubscribe', 'forward')
  )
);

CREATE INDEX idx_performance_observations_brand_concept ON performance_observations(brand_id, content_concept_id);
CREATE INDEX idx_performance_observations_brand_framework ON performance_observations(brand_id, observation_type, observed_at DESC);
```

Aggregation queries against this table produce the performance scores read by the brain's `getFrameworkPerformance` operation.

### Performance Score Computation

A scheduled job (every 6 hours) recomputes performance scores for active framework concepts. The score is a composite:

```
score = (love_rate * 0.4)
      + (click_through_rate * 0.3)
      + (reply_rate * 0.2)
      + (unsubscribe_safety_factor * 0.1)
```

Where each component is normalized to 0-100 and based on observations from the framework's recent uses. The `unsubscribe_safety_factor` is `100 - normalized_unsubscribe_rate` — frameworks that drive unsubscribes get penalized.

The composite weights are configurable via `platform_config`:

```typescript
{
  key: "brain.performance_weights",
  value: {
    love_rate: 0.4,
    click_through_rate: 0.3,
    reply_rate: 0.2,
    unsubscribe_safety: 0.1,
  },
}
```

These weights are global by default; brands can override. Brands optimizing for engagement might weight click-through higher; brands optimizing for thought-leadership reach might weight reply-rate higher.

**Statistical confidence:** A framework with 2 uses has unreliable performance data. The score includes a confidence value based on sample size (use count × recency-weighted observations). Frameworks below a confidence threshold are flagged as "tentative" and don't influence variety enforcement decisions until they have enough data.

### The Learning Analyzer

A daily scheduled job runs after performance scores are recomputed. It analyzes recent performance and produces structured learnings.

**Block: `learning_analyzer`**

```typescript
{
  brandId: string,
  analysisWindow: "7_days" | "30_days" | "90_days",
}
```

Output:

```typescript
{
  learnings: Array<{
    id: string,
    statement: string,             // Human-readable observation
    evidence: string,              // What data supports this
    confidence: number,            // 0-1
    actionable: boolean,           // Can the system do something with this?
    proposed_action: string | null,
    requires_human_approval: boolean,
    learning_type: "framework_promotion" | "framework_deprecation" | "persona_calibration" | "lookback_adjustment" | "exploration_signal" | "narrative",
  }>,
  generated_at: string,
}
```

Example learnings:

- "Framework `say_do_gap_with_knife_twist` has been used 12 times in 90 days with avg love rate 73% (vs. brand average 62%). Recommend promoting from `experimental` to `active`. Confidence: 0.91. Actionable. Requires human approval."
- "Solo Operator persona has been the primary target on 7 of last 14 sends. Persona rotation budget violated. Next 2 sends should target Wirehouse Refugee or Niche Specialist. Confidence: 1.0. Actionable. Auto-enforced by orchestrator."
- "Tasting Menu items in the 'Worth Drinking' category are clustering on Costco wines (4 of last 8). Diversify in next sends. Confidence: 0.95. Actionable. Will be enforced by cluster prevention layer."
- "Reply rate has dropped 22% over the last 3 weeks. No clear cause in framework or persona analysis. Possible audience saturation or seasonal effect. Flagging for human review. Confidence: 0.6. Not actionable autonomously."

**Voice modules composed:** Learning analyzer doesn't compose brand voice — it's analyzing data, not writing. It loads `core/llm-output-discipline` plus a learning-analyzer-specific module that defines the learning schema and analytical guidelines.

**Model role:** `learning.analyzer`. Default: Sonnet 4.5 at temperature 0, reasoning enabled (this is one of the few blocks where reasoning is genuinely useful — the analyzer is doing inference, not structured generation).

The output gets persisted to a `learnings` table (definition deferred to the dev team's choice on schema), surfaced in the admin UI, and — for autonomous-actionable learnings — fed into the orchestrator's next-cycle context.

## Cross-Brand Pattern Transfer

Phase 5 capability. Schema is in place from day one (the `cross_brand_patterns` table in `02_data_model`); the implementation lands in Phase 5.

### What Transfers

Some learnings are durable across brands; others aren't. The architectural firewall exists to enable the former while blocking the latter.

**Transfers:**
- Subject line *patterns* (specific wordings about contrarian framings, question hooks, numbered list approaches)
- Send-time optimization (Tuesday 6:30 AM consistently outperforms 7:30 AM for B2B audiences)
- Section-level engagement patterns (Cover Stories with 3 inline links outperform those with fewer)
- Framework-family performance signals (opening patterns of type X tend to engage; closing patterns of type Y reduce unsubscribes)

**Does not transfer:**
- Specific voice choices (Castor Abbott's contrarian positions are not Treasure Financial's)
- Brand-particular content (Castor Abbott's audience cares about Trust Stacking; Treasure Financial's doesn't)
- Persona-specific signals (each brand has its own personas with different engagement profiles)

### How Isolation Is Enforced

The `cross_brand_patterns` table is *not* joined to specific brands. Source brands are counted (minimum 2 required for a pattern to be promoted to cross-brand status) but not identified. Each row represents an aggregated, anonymized pattern.

A query for cross-brand learnings looks like:

```sql
SELECT pattern_type, pattern_description, performance_metric, performance_value, confidence_level
FROM cross_brand_patterns
WHERE pattern_type = 'subject_line'
  AND performance_value > 0.6
  AND source_brand_count >= 2;
```

No brand IDs in the query. No way to determine which brands contributed. The pattern is the learning; the source is anonymized.

A separate `cross_brand_pattern_sources` table can exist for audit purposes (which brands fed into which patterns) but is access-controlled to platform admins only. Brand admins cannot query it. RLS enforces this.

### Pattern Promotion to Cross-Brand

A pattern becomes cross-brand when:

1. At least 2 different brands have demonstrated similar pattern performance (cosine similarity > 0.85 on pattern descriptions, with consistent performance signal).
2. The combined sample size meets a confidence threshold.
3. The performance signal is consistent (not just present in one brand's outliers).

Promotion is automatic when the criteria are met. A scheduled job runs nightly and identifies patterns ready for promotion. The platform admin gets a notification; the patterns become available to all brands' generation pipelines.

### Consumption by Brand Pipelines

When a writer or proposer block runs, it queries both brand-specific brain data *and* cross-brand patterns. Cross-brand patterns are presented as additional context: "Across the platform, subject lines of pattern X have outperformed pattern Y by 18% over the last 90 days. Consider this when relevant."

Cross-brand patterns are advisory, not mandatory. The brand's own brain takes precedence. Cross-brand patterns inform but don't override.

## The Framework Library

Frameworks earn promotion. They start as `experimental`, get used a small number of times, and either prove themselves into `active` status or get deprecated.

### Framework Lifecycle

**Status: `experimental`**
- Newly extracted framework (system has seen this pattern but doesn't have data yet)
- Eligible for use under the exploration budget (the 10% reserved for experimental frameworks)
- Counted toward variety enforcement
- Performance is tracked but doesn't yet drive recommendations

**Status: `active`**
- Promoted from experimental after demonstrating consistent performance (>= 5 uses, performance score above brand median)
- Eligible for use anywhere the writer block decides
- Influences variety enforcement and recommendations

**Status: `deprecated`**
- Demoted from active after demonstrating consistent underperformance, or manually deprecated
- Not eligible for new use
- Past uses remain in the data for replay and analysis

### Promotion and Deprecation

Both happen via the learning analyzer's recommendations, which produce `learnings` rows. Promotions and deprecations of *active* status frameworks require human approval (a brand admin reviewing the learning and approving). Promotion from `experimental` to `active` happens automatically when criteria are met.

Why the asymmetry: deprecating an active framework is a reversible but consequential change (it stops appearing in generation, audience may notice). Promoting an experimental framework is low-risk (it just starts being eligible for use). Auto-promoting low-risk changes; requiring approval for high-risk changes.

### New Framework Discovery

The concept extractor doesn't only recognize existing frameworks — it can also identify new ones. When a section's structural pattern doesn't match any existing framework above the 0.92 similarity threshold, the extractor proposes a new framework with `status: 'experimental'`.

Most generations will use existing frameworks. New framework discovery happens when:
- A writer creatively combines techniques in a way that's structurally distinct from anything in the library
- An experiment introduces a genuinely new pattern
- Mark or a brand admin manually creates a framework via the admin UI based on observation

The library grows over time. After a year of operation, expect 50-200 active frameworks per brand, with new ones appearing at maybe 1-3 per week.

## Persona Panel Calibration

The 10-persona panel produces predictions. Real engagement produces ground truth. Calibration compares them and adjusts persona weights and definitions accordingly.

### What Gets Calibrated

For each persona, calibration tracks:
- **Prediction accuracy:** Does this persona's love score predict actual engagement of subscribers in their segment? Compute Pearson correlation between persona scores and observed segment performance over a rolling 90-day window.
- **Prediction bias:** Does this persona systematically over-predict or under-predict?
- **Flag relevance:** When this persona flags something, does the flagged issue correlate with actual unsubscribes or low engagement in their segment?

Personas with prediction accuracy r ≥ 0.6 are well-calibrated. Personas with r < 0.4 need definition refinement (the persona profile is generating predictions that don't match how real subscribers in that segment behave).

### How Calibration Adjusts the System

Two ways:

**Persona weight adjustment in the score aggregator.** Personas with stronger correlation get more weight in pass/fail decisions. Personas with weaker correlation get less weight (their flags are still logged but influence less).

**Persona profile refinement (human-in-loop).** When a persona has consistent low correlation, the learning analyzer surfaces it: "Wirehouse Refugee predictions don't match observed engagement among that segment. Consider revising the persona profile." A brand admin reviews the discrepancy and updates the persona module via PR.

### New Persona Discovery

Just as new frameworks can emerge, new personas can emerge from the data. Clustering analysis on subscriber engagement patterns can identify groups whose behavior doesn't fit any existing persona. The learning analyzer surfaces these as candidate new personas.

Adding a new persona is a deliberate act, not automatic. It requires:
1. Defining the persona profile (a human writes the module)
2. Adding the persona to the brand voice config
3. Testing the persona's predictions against held-out subscriber data

This is a rare event (maybe once or twice a year per brand). The architecture supports it but doesn't automate it.

## Open Decisions for the Dev Team

- **Specific embedding model:** Spec assumes `text-embedding-3-large` (1536 dims). `text-embedding-3-small` is acceptable; Voyage AI is acceptable. Decision goes in an ADR.
- **Specific similarity thresholds:** 0.85 for content duplicate detection, 0.92 for framework matching. These are starting points based on calibration against historical Latte data. Expect tuning in production.
- **Specific aggregation window for performance scores:** 90 days as default. Some metrics may want shorter (subject line tests refresh faster) or longer (framework performance needs more data). Implementation can use multiple windows.
- **Whether the learning analyzer block runs daily, hourly, or per-event:** Daily for v1. Hourly when the system is more mature. Per-event is overkill.
- **Specific schema for the `learnings` table:** Deferred to dev team. A simple shape suffices: id, brand_id, statement, evidence, confidence, status (open/applied/dismissed), created_at, applied_at, applied_by.
- **Whether to use Postgres triggers or scheduled jobs for attribution:** Triggers are tighter; scheduled jobs are simpler. Lean toward scheduled jobs (every 5 minutes) unless real-time attribution becomes a requirement.

## Acceptance Criteria

The brain and learning loop is complete when:

- [ ] `framework_concepts` and `content_concepts` tables exist with all columns and indexes from `02_data_model`.
- [ ] `framework_content_usage` junction table exists.
- [ ] `cross_brand_patterns` and `performance_observations` tables exist.
- [ ] The `concept_extractor` block is implemented and runs after pipeline completion.
- [ ] Embedding generation works via the configured embedding model (default text-embedding-3-large).
- [ ] Brain queries (`getExclusions`, `getFrameworkPerformance`) are implemented and tested.
- [ ] Lookback windows are configured per section in `platform_config` and respected by exclusion queries.
- [ ] Hard-blocked items list is initialized with the existing system's permanent exclusions (Lodge cast iron, etc.) for Castor Abbott.
- [ ] The variety enforcement layer is implemented: cluster prevention, persona rotation, surprise quotient checks integrated into the pipeline orchestrator.
- [ ] The exploration budget is enforced at the orchestrator level with configurable percentages per brand.
- [ ] Performance attribution from `send_events` to concepts works end-to-end (verified with synthetic event data in tests).
- [ ] Performance score computation runs as a scheduled job every 6 hours.
- [ ] The `learning_analyzer` block is implemented and produces structured learnings.
- [ ] Cross-brand pattern infrastructure is in place (table, RLS, query API). Actual cross-brand learning logic deferred to Phase 5.
- [ ] Framework lifecycle (experimental → active → deprecated) works with both auto-promotion and human-approval gates.
- [ ] Persona calibration metrics are computed and surfaced in the admin UI (UI itself in `08_review_interface`).
- [ ] An end-to-end test verifies the closed loop: synthetic events for an episode → attribution → performance update → next pipeline run sees updated performance data.
- [ ] An integration test verifies the optimizer-collapse failure mode does not occur: even when one framework dominates performance, the variety enforcement layer ensures non-trivial use of other frameworks.

**Mode-specific acceptance:**

- [ ] All five learning loop modes (`disabled`, `observe_only`, `human_approved`, `semi_autonomous`, `fully_autonomous`) are implemented and individually testable.
- [ ] An integration test for each mode verifies correct behavior: in `disabled`, no performance attribution runs; in `observe_only`, attribution runs but learnings don't influence generation; in `human_approved`, every actionable learning queues for approval; in `semi_autonomous`, low-risk learnings auto-apply but high-risk require approval; in `fully_autonomous`, all learnings auto-apply at confidence threshold.
- [ ] Mode transitions are tested: moving from `disabled` to `observe_only`, `observe_only` to `human_approved`, etc. — each transition handles existing data correctly without data loss or stale-state behavior.
- [ ] Layer 1 (framework-vs-content separation) and Layer 3 (cluster prevention, surprise quotient) variety enforcement run correctly even in `disabled` mode.
- [ ] Mode changes are written to `audit_log` with old and new mode values and the brand admin who initiated the change.
- [ ] The four brands' Phase 1 default modes (Castor Abbott `disabled`, Cortex `disabled`, Fidelon `human_approved`, Treasure Financial `observe_only`) are seeded into `platform_config`.

---

**Next:** Read `06_distribution_platform.spec.md` for the Resend integration, subscriber management, compliance, and webhook event ingestion.
