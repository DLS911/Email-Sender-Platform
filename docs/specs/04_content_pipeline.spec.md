---
spec: 04_content_pipeline
title: Content Generation Pipeline
version: 1.0
status: draft
audience: dev_team, agentic_orchestrator
dependencies:
  - 00_overview
  - 01_foundation
  - 02_data_model
  - 03_voice_system
consumed_by:
  - 05_brain_and_learning
  - 07_experiment_framework
  - 08_review_interface
  - 10_observability
purpose: Define every block in the content generation pipeline. Specify input/output contracts, model settings, voice module composition, retry policies, and orchestration logic for both weekday and weekend pipelines.
---

# Content Generation Pipeline

## What This Spec Covers

The pipeline that produces newsletters. Every block, every contract, every retry policy, every model setting. The orchestration logic that sequences blocks into pipelines. Both the weekday pipeline (Daily Grind) and the weekend pipeline (Saturday Morning Latte). The shared editorial layer (editor, peer review, score aggregator) that both pipelines use.

This spec is opinionated about the right way to structure each block because the existing MindStudio system's bugs are mostly block-level architectural problems (Gemini reasoning leaks because no JSON-mode discipline, context overflow because no truncation logic, race conditions because no atomic state). Specifying the right shape per block prevents an entire class of failures by construction.

## Pipeline Architecture

### The Block Concept

A block is a unit of work in the pipeline. It has:

- **A name** — `cover_story_research`, `tactic_writer`, `editor`, `persona_panel`, etc.
- **An input contract** — Zod schema. Validated on entry.
- **An output contract** — Zod schema. Validated on exit.
- **A model configuration** — primary provider/model/temperature, fallback provider/model/temperature, reasoning enabled/disabled, max tokens.
- **Voice module composition** — which modules from `@platform/voice-modules` get loaded into the system prompt.
- **A user prompt template** — the dynamic part of the prompt, parameterized on the block's input.
- **A retry policy** — how many retries on failure, what triggers fallback to secondary model.
- **Side effects** — what the block writes to the database, what events it emits.

Blocks are pure functions of their inputs from the caller's perspective. Internally they perform LLM calls and database operations, but the caller passes typed input and receives typed output. No global state, no implicit dependencies.

### Block Contract Skeleton

Every block follows the same shape:

```typescript
// In apps/pipeline/src/blocks/<edition>/<block-name>.ts

import { llmClient } from "@platform/llm-client";
import { composeVoice } from "@platform/voice-modules";
import { logger } from "@platform/observability";
import { getActiveVoiceConfig } from "@platform/db";
import { CoverStoryResearchInputSchema, CoverStoryResearchOutputSchema } from "@platform/schemas";

export async function coverStoryResearchBlock(
  input: CoverStoryResearchInput
): Promise<CoverStoryResearchOutput> {
  // 1. Validate input
  const validated = CoverStoryResearchInputSchema.parse(input);

  // 2. Load voice configuration
  const voiceConfig = await getActiveVoiceConfig(validated.brandId, "weekend");

  // 3. Compose system prompt from voice modules
  const systemPrompt = await composeVoice({
    modules: [
      ...voiceConfig.weekend.shared_modules,
      ...voiceConfig.weekend.voice_modules,
      voiceConfig.weekend.content_type_modules[validated.contentType],
    ],
    context: {
      blockName: "cover_story_research",
      runId: validated.runId,
      brandId: validated.brandId,
    },
  });

  // 4. Build user prompt
  const userPrompt = buildCoverStoryUserPrompt(validated);

  // 5. Call LLM with full safety wrapper
  // Model is resolved from platform_config at call time via the role.
  // No hardcoded model strings. Models are hot-swappable without code changes.
  const result = await llmClient.generate({
    modelRole: "weekend.research",
    systemPrompt,
    userPrompt,
    schema: CoverStoryResearchOutputSchema,
    maxRetries: 2,
    context: {
      blockName: "cover_story_research",
      runId: validated.runId,
      brandId: validated.brandId,
    },
  });

  return result;
}
```

Every block looks like this. The boilerplate is uniform; what differs is the input/output schemas, the voice modules composed, the user prompt template, and the model role declared. This uniformity is the point — a developer who learns to write one block knows how to write all of them.

**Critical: blocks declare a `modelRole`, not a specific model.** The wrapper resolves the role to provider/model/temperature/fallback/reasoning settings at call time by querying `platform_config`. This means:
- Models are swappable from the admin UI without redeploys.
- New model releases (e.g., Sonnet 5 when it ships) reach production via config update, not code change.
- A/B tests across models are config-driven.
- Provider outages can be routed around by changing one config row.
- Per-brand and per-environment overrides work naturally.

See `01_foundation` for the full role configuration schema and the default role-to-model mapping.

### Orchestration Pattern

Pipelines are TypeScript functions that compose blocks. No JSON DSL, no graph-based workflow engine. Just typed async code.

```typescript
// In apps/pipeline/src/pipelines/weekend.ts

export async function runWeekendPipeline(brandId: string) {
  const run = await createPipelineRun(brandId, "weekend");

  try {
    // Acquire advisory lock so concurrent runs of the same brand block here
    await acquireBrandLock(brandId);

    const contentType = await contentTypeSelectorBlock({ brandId, runId: run.id });
    const destination = await destinationProposerBlock({ brandId, runId: run.id, contentType });
    const validated = await destinationValidatorBlock({ brandId, runId: run.id, destination });

    // Retry loop for destination if validation fails
    let retries = 0;
    let finalDestination = validated;
    while (!finalDestination.passed && retries < 3) {
      const next = await destinationProposerBlock({
        brandId, runId: run.id, contentType,
        avoidFormulas: finalDestination.exhaustedFormulas,
        avoidContentTypes: finalDestination.overusedTypes,
      });
      finalDestination = await destinationValidatorBlock({ brandId, runId: run.id, destination: next });
      retries++;
    }

    if (!finalDestination.passed) {
      throw new PipelineError("destination_validation_exceeded_retries", { run });
    }

    const research = await researchBlock({ brandId, runId: run.id, destination: finalDestination });
    const draft = await writerBlock({ brandId, runId: run.id, research, contentType });
    const factChecked = await factCheckerBlock({ brandId, runId: run.id, draft });
    const edited = await editorBlock({ brandId, runId: run.id, draft: factChecked, edition: "weekend" });

    // Quality gate with revision loop
    let qualityResult = await runQualityGate(brandId, run.id, edited, "weekend");
    let revisionCycle = 0;
    while (!qualityResult.passed && revisionCycle < 3) {
      const revised = await editorBlock({
        brandId, runId: run.id,
        draft: edited,
        edition: "weekend",
        revisionFeedback: qualityResult.recommendations,
      });
      qualityResult = await runQualityGate(brandId, run.id, revised, "weekend");
      revisionCycle++;
    }

    const html = await htmlGeneratorBlock({ brandId, runId: run.id, episode: edited });
    const episode = await persistEpisode({ brandId, runId: run.id, content: edited, html, qualityResult });

    await markRunCompleted(run.id, episode.id);
    return episode;

  } catch (err) {
    await markRunFailed(run.id, err);
    throw err;

  } finally {
    await releaseBrandLock(brandId);
  }
}
```

This shape is the orchestrator. The control flow is explicit: if/else branches, while loops, try/catch. No "graph compiler" interpreting a DSL. The TypeScript reads like a runbook.

The `runQualityGate` helper is itself a small composition of the persona panel block, the score aggregator block, and a deterministic pre-pass. That helper lives in `apps/pipeline/src/pipelines/quality-gate.ts` and is documented in the Shared Editorial Layer section below.

### Why Code-Based Orchestration

The MindStudio workflow is a JSON DSL. The new system is TypeScript. Three reasons:

**Type safety end-to-end.** A change to a block's output schema triggers a type error at every consumer. The compiler catches contract drift before the pipeline runs.

**Standard tooling works.** Debugger, profiler, IDE refactoring, code review, tests. None of these work on JSON DSLs. All of them work on TypeScript.

**Control flow is expressive.** The destination retry loop, the quality gate revision loop, the experiment branching — these are natural in code, awkward in DSLs. We have them naturally now and can add more without fighting the framework.

The cost is that the orchestrator is code, so changes require deploys. That's acceptable. Pipeline structure changes infrequently. Voice and prompts (which change frequently) are config and content, not code.

## Shared Editorial Layer

Both pipelines use the same editorial blocks after the writer produces a draft. Documenting these once.

### Block: `editor`

Applies the editorial discipline to a draft. Catches voice violations, structural issues, and language guide breaches. Optionally consumes revision feedback from the quality gate.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  draft: EpisodeDraft,                // Full episode content
  edition: "weekday" | "weekend",
  revisionFeedback: string[] | null,  // Specific issues to address
}
```

**Output schema:**
```typescript
{
  episode: EpisodeDraft,              // Edited episode
  edit_log: Array<{
    section: string,
    change: string,
    reason: string,
  }>,
  quality_flags: string[],            // Remaining concerns the editor couldn't fix
  word_counts: Record<string, number>,
}
```

**Voice modules composed:**
- `core/voice-rules`
- `core/llm-output-discipline`
- `core/editorial-quality`
- `brands/<brand>/shared/mark-persona`
- `brands/<brand>/shared/audience`
- `brands/<brand>/<edition>/voice-tone`
- `brands/<brand>/<edition>/language-guide` (weekday) or `brands/<brand>/<edition>/what-this-voice-isnt` (weekend)
- `brands/<brand>/<edition>/contrarian-positions` (weekday) — explicitly to enforce DO NOT SOFTEN

**Model role:** `editor.standard`. Default platform settings: Sonnet 4.5 at temperature 0, fallback to Opus 4, reasoning disabled. All settings overridable via `platform_config` without code changes.

**Retry policy:** 2 retries on schema validation failure. Auto-fallback to secondary on persistent malformed output. The editor must produce valid edited content; failure here cascades to a pipeline failure.

**Critical behaviors:**
- The editor preserves voice. It does not soften contrarian positions. The "DO NOT SOFTEN" directive in the voice modules is load-bearing.
- The editor's edit_log must reference specific sections and reasons. "General polish" is not acceptable — every change is justified.
- The editor flags things it cannot fix (e.g., "this tactic violates the no-scripted-referrals rule but rewriting it would require new content not in scope") rather than silently shipping voice violations.

**Pre-pass: deterministic hard-rules check before LLM editing.** Before the editor block runs, a deterministic regex pass catches:
- Em dashes (replace with comma, period, or rewrite)
- Banned phrases ("In today's...", "As we all know...", "leverage", "synergy", "hidden gem", etc.)
- Coffee puns/metaphors
- Author credibility violations ("In my practice", "When I run client meetings", "My clients tell me")

If the deterministic pre-pass produces edits, those edits are applied first and the editor block sees the cleaned version. The editor block can still flag issues, but it doesn't have to spend tokens on rule-based fixes that regex handles cheaply. This is a 70-80% reduction in editor block scope and significantly improves the editor's ability to focus on judgment-based decisions.

### Block: `persona_panel`

Parallel evaluation of the edited draft against 10 reader personas. Each persona is its own LLM call, run in parallel.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  episode: EpisodeDraft,
  contentType: string,
  edition: "weekday" | "weekend",
}
```

**Output schema:**
```typescript
{
  evaluations: Array<{
    persona_name: string,
    persona_segment: "highest_engagement" | "moderate_engagement" | "at_risk",
    love_probability: number,         // 0-100
    share_probability: number,
    unsubscribe_probability: number,
    flags: Array<{
      issue: string,
      severity: "high" | "medium" | "low",
    }>,
    trifecta_scores?: TrifectaScores,  // Weekday only
    raw_response: object,
  }>,
}
```

**Execution model:** Promise.all over the 10 persona modules. Each persona evaluation is an independent LLM call with its own retry policy. A failure in one persona evaluation does not fail the others; failed persona evaluations are excluded from the aggregate with a logged warning.

**Voice modules per persona evaluation:**
- `core/llm-output-discipline`
- `personas/<brand>/<persona-name>` (the specific persona being evaluated as)
- `brands/<brand>/<edition>/voice-tone` (so the persona understands what voice it's evaluating)

**Model role:** `persona.evaluator`. Default platform settings: Sonnet 4.5 at temperature 0, fallback to Opus 4, reasoning disabled. The panel produces structured scoring; reasoning leaks would corrupt the JSON. All settings overridable via `platform_config`.

**User prompt template:** The episode content rendered as plaintext, followed by the structured request: "Evaluate this newsletter as the persona defined above. Return your scoring as JSON matching the schema."

**Retry policy:** 1 retry on schema failure per persona. If a single persona fails twice, log and exclude. The aggregate still runs with 9 evaluations.

### Block: `score_aggregator`

Aggregates persona scores into pass/fail decision. Categorizes flags. Generates revision recommendations.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  episodeId: string,
  contentType: string,
  edition: "weekday" | "weekend",
  evaluations: PersonaEvaluation[],   // From persona_panel block
}
```

**Output schema:**
```typescript
{
  love_rate: number,
  share_rate: number,
  churn_risk: number,
  passed: boolean,
  hard_stops_triggered: string[],
  benchmark_comparison: {
    love_rate: { actual: number, target: number, met: boolean },
    share_rate: { actual: number, target: number, met: boolean },
    churn_risk: { actual: number, max: number, met: boolean },
  },
  trifecta_passed: boolean | null,    // Weekday only
  segment_breakdown: Record<string, SegmentScores>,
  common_flags: Array<{
    flag: string,
    count: number,
    personas: string[],
    priority: "PATTERN" | "CONSIDER" | "IGNORE",
  }>,
  revision_recommendations: string[],
}
```

**Execution model:** Pure function. No LLM call. Implemented as TypeScript code following the rubric in the existing `score_aggregator.flow.md`.

This is a deliberate architectural choice. The aggregator was an LLM call in MindStudio because everything was an LLM call. It doesn't need to be. The math is deterministic: average scores, apply weights, check against thresholds, categorize flags. Doing this in code is faster, cheaper, more reliable, and easier to test than asking a model to do arithmetic.

**Benchmark thresholds per content type** (preserved from existing system):

| Content Type | Love Rate | Share Rate | Churn Risk |
|--------------|-----------|------------|------------|
| Tactic       | ≥ 65%     | ≥ 45%      | ≤ 10%      |
| Take         | ≥ 58%     | ≥ 40%      | ≤ 12%      |
| Story        | ≥ 50%     | ≥ 35%      | ≤ 15%      |
| Special      | ≥ 55%     | ≥ 38%      | ≤ 12%      |
| Weekend      | ≥ 52%     | ≥ 35%      | ≤ 12%      |

**Hard stops** (only two trigger automatic fail):
- Any single persona unsubscribe_probability > 40
- Any segment average love_rate < 25

**Flag categorization rules:**

`PATTERN` — Track across issues, not a this-issue fix:
- "Content skews masculine"
- "Recommendations not novel enough"
- "No family-friendly content"

`CONSIDER` — Worth a light touch in the revision pass:
- "Voice formula element weak"
- "Could add more depth to recommendation"
- "Opening hook could punch harder"

`IGNORE` — Persona preference conflicts with content type or design:
- "No business utility" on weekend content
- "Too adventurous" from Compliance-Conscious
- "Too basic" from Veteran on solid recommendations

**Pass/fail logic:**
```
PASS = love_rate >= target AND share_rate >= target AND churn_risk <= max
       AND no hard stops triggered
       AND (edition === "weekend" OR trifecta_passed === true)
```

The trifecta check applies only to weekday content. See the Opening Trifecta block below.

### Block: `html_generator`

Renders the approved episode JSON into production HTML. Pure function. No LLM call.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  episode: EpisodeDraft,
  edition: "weekday" | "weekend",
}
```

**Output schema:**
```typescript
{
  html: string,
  preview_text: string,                // First ~150 chars for inbox preview
  word_count: number,
  estimated_read_time_minutes: number,
}
```

**Implementation:** React Email components. Each section has a typed component. The generator composes the components, passes the section data, and renders to HTML string.

**Why React Email instead of LLM-generated HTML:** Email HTML rendering is constrained (inline styles, table layouts, no flexbox/grid, email client compatibility). Asking an LLM to produce production-ready email HTML wastes tokens on a problem that's better solved with deterministic templating. React Email components encode the email client constraints once; every email gets correct rendering.

**Design system from `html_generator.flow.md`** is preserved as a Tailwind config equivalent in the React Email components. Colors (`#c4a882` gold, `#2d2926` dark brown, `#faf9f7` light bg, `#4a4540` body, `#9a8b7a` muted, `#e8e4de` border), typography, layout dimensions, signoff styles. The components live in `apps/pipeline/src/email-templates/` with one component per section type and shared layout components for headers, footers, dividers.

## Weekday Pipeline (The Daily Grind)

The weekday pipeline produces five episodes per week (Monday through Friday). Content type is determined by day of week with rotation rules:

- Monday: tactic
- Tuesday: take
- Wednesday: tactic
- Thursday: story OR special (alternates; if special, rotates through compliance/team_management/tech_deep_dive subtypes)
- Friday: tactic (with extra Digital Grind section)

### Block: `content_type_assigner` (weekday)

Determines what to write today based on day of week and recent history.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  date: string,  // ISO date
}
```

**Output schema:**
```typescript
{
  contentType: "tactic" | "take" | "story" | "special",
  subtype: "compliance" | "team_management" | "tech_deep_dive" | null,
  formatStyle: "deep_dive" | "quick_hits" | "contrarian" | "story" | "data",
  hasDigitalGrind: boolean,  // True for Friday tactics
}
```

**Implementation:** Pure function. No LLM call. The day-of-week rules are deterministic. Format style rotation pulls from the brain to avoid recent repetition (last 14 days of format styles for this content type are excluded from selection).

The format style is the *how* layer that pairs with the content type *what* layer. A Tactic can be written as deep_dive, quick_hits, contrarian, story, or data — five very different reading experiences with the same content category. Tracking the format style separately from the content type creates 50+ unique combinations across the week and prevents structural repetition even when content type repeats.

### Block: `topic_proposer` (weekday)

Proposes a topic for today's content given the assigned type and the brain's recent history.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  contentType: string,
  subtype: string | null,
  formatStyle: string,
  recentTopics: string[],  // Last 90 days of topic concepts
}
```

**Output schema:**
```typescript
{
  topic: string,                       // Concise topic statement
  topic_concept: string,               // 1-2 sentence semantic concept summary
  rationale: string,                   // Why this topic, why now
  source_signals: string[],            // News, conversations, observations driving the choice
}
```

**Voice modules composed:**
- `core/llm-output-discipline`
- `brands/castor-abbott/shared/audience`
- `brands/castor-abbott/weekday/voice-tone`
- `brands/castor-abbott/weekday/contrarian-positions`

**Model role:** `weekday.topic_proposer`. Default platform settings: Sonnet 4.5 at temperature 0.4 (slight temperature for variety in proposed topics), fallback to Opus 4. All settings overridable via `platform_config`.

**Side effect:** Embeds the proposed `topic_concept` and queries the brain for similar past topics. If similarity to recent topic exceeds threshold, the block re-runs with the colliding topic added to the avoidance list. Maximum 3 re-runs before throwing.

### Block: `research_agent` (weekday)

Gathers material for the writer based on the proposed topic.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  topic: string,
  topicConcept: string,
  contentType: string,
  subtype: string | null,
}
```

**Output schema:**
```typescript
{
  primary_research: {
    angle: string,                     // The contrarian or unique angle
    key_facts: string[],               // Supporting facts with sources
    advisor_examples: string[],        // Anonymized examples (no Mark-as-advisor framing)
    counterintuitive_insight: string,  // The thing most people miss
  },
  worth_knowing: Array<{
    headline: string,
    summary: string,                   // 1-2 sentences
    source_url: string,
    statistic_or_data: string | null,  // First item must have this
  }>,
  ancient_truth: {
    proverb_reference: string,         // "Proverbs 27:17" format
    proverb_text: string,              // ESV
    business_application: string,      // 40-60 words
  },
}
```

**Voice modules composed:**
- `core/llm-output-discipline`
- `brands/castor-abbott/shared/mark-persona`
- `brands/castor-abbott/shared/author-credibility`
- `brands/castor-abbott/weekday/synthesis`
- `brands/castor-abbott/weekday/contrarian-positions`
- `brands/castor-abbott/weekday/content-types/<content-type>`

**Model role:** `weekday.research`. Default platform settings: Sonnet 4.5 at temperature 0, fallback to Opus 4, reasoning disabled. All settings overridable via `platform_config`.

**Critical behavior:** The research block does not produce final copy. It produces structured research the writer block uses. The separation matters because research and writing are different cognitive tasks; combining them in one block creates worse output than splitting them.

### Block: `writer_agent` (weekday)

Transforms research into draft sections.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  topic: string,
  contentType: string,
  subtype: string | null,
  formatStyle: string,
  research: WeekdayResearchOutput,     // From research_agent
}
```

**Output schema:**
```typescript
{
  headline_options: string[],          // 3 candidates
  first_pull: {
    content: string,                   // 250-350 words
    visual_element: {
      type: "stat_box" | "comparison_box" | "script_box" | "tactic_box",
      data: object,                    // Type-specific structure
    },
  },
  worth_knowing: Array<{
    headline: string,
    summary: string,
    url: string,
    visual_data: object | null,        // First item only
  }>,
  tactic: {
    title: string,
    body: string,
    implementable_this_week: boolean,  // Self-attested
  },
  grounds_for_thought: string,         // Under 25 words
  ancient_truth: {
    reference: string,
    text: string,
    application: string,               // 40-60 words
  },
  digital_grind: object | null,        // Friday only
  word_counts: Record<string, number>,
}
```

**Voice modules composed:** The full weekday voice stack. See `03_voice_system` for the active config.

**Model role:** `weekday.writer`. Default platform settings: Sonnet 4.5 at temperature 0.3 (slight temperature to avoid mechanical-feeling prose), fallback to Opus 4. All settings overridable via `platform_config`.

**Retry policy:** 2 retries on schema failure. Auto-fallback after retries exhausted.

**Critical behavior:** The writer block respects content type structure. A Tactic must be implementable this week (not someday/theoretical). A Take must take a position (no hedging). A Story must let the lesson emerge from the narrative. A Special must address its subtype directly. The content type module loaded into voice enforces this; the schema's `implementable_this_week` boolean enforces self-attestation.

### Block: `opening_trifecta` (weekday)

Generates the Opening Trifecta — three candidate openings (Number, Unspoken, Flip) for the writer's chosen headline. The aggregator decides which one ships.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  episode: EpisodeDraft,
  selectedHeadline: string,
}
```

**Output schema:**
```typescript
{
  the_number: {
    text: string,
    statistic_used: string,
    statistic_source: string,
  },
  the_unspoken: {
    text: string,                      // The thing the industry won't say
    relevance: string,
  },
  the_flip: {
    text: string,                      // The reframe
    conventional_view: string,
    flipped_view: string,
  },
}
```

**Voice modules composed:**
- Full weekday voice stack
- Plus an opening-trifecta-specific module: `brands/castor-abbott/weekday/opening-trifecta-rules`

**Model role:** `weekday.opening_trifecta`. Default platform settings: Sonnet 4.5 at temperature 0.5 (higher temperature because we want three genuinely distinct options, not minor variations), fallback to Opus 4. All settings overridable via `platform_config`.

**Selection logic:** After the persona panel evaluates the full draft including trifecta options, the score aggregator computes per-trifecta-option engagement projections and selects the highest-scoring option. The selected option's text becomes the published opening; the other two are logged for learning.

This is a small but meaningful piece of the closed feedback loop. Three candidate openings tested against the persona panel produces durable signal about which trifecta type works best for which content type and audience segment over time.

### Weekday Pipeline Orchestration

```typescript
export async function runWeekdayPipeline(brandId: string, date: string) {
  const run = await createPipelineRun(brandId, "weekday");

  try {
    await acquireBrandLock(brandId);

    // Content assignment
    const assignment = await contentTypeAssignerBlock({ brandId, runId: run.id, date });

    // Topic and research
    const topicProposal = await topicProposerBlock({
      brandId, runId: run.id,
      contentType: assignment.contentType,
      subtype: assignment.subtype,
      formatStyle: assignment.formatStyle,
      recentTopics: await getRecentTopics(brandId, 90),
    });

    const research = await researchAgentBlock({
      brandId, runId: run.id,
      topic: topicProposal.topic,
      topicConcept: topicProposal.topic_concept,
      contentType: assignment.contentType,
      subtype: assignment.subtype,
    });

    // Initial draft
    const draft = await writerAgentBlock({
      brandId, runId: run.id,
      topic: topicProposal.topic,
      contentType: assignment.contentType,
      subtype: assignment.subtype,
      formatStyle: assignment.formatStyle,
      research,
    });

    // Opening Trifecta with selected headline
    const trifecta = await openingTrifectaBlock({
      brandId, runId: run.id,
      episode: draft,
      selectedHeadline: draft.headline_options[0],  // Picked by writer; aggregator confirms
    });

    const draftWithTrifecta = mergeTrifectaIntoDraft(draft, trifecta);

    // Editorial pass with deterministic pre-pass
    const preCleanedDraft = applyHardRulesPrePass(draftWithTrifecta);
    const edited = await editorBlock({
      brandId, runId: run.id, draft: preCleanedDraft, edition: "weekday",
    });

    // Quality gate with revision loop
    let qualityResult = await runQualityGate(brandId, run.id, edited, "weekday", assignment.contentType);
    let revisionCycle = 0;
    let currentDraft = edited;

    while (!qualityResult.passed && revisionCycle < 3) {
      currentDraft = await editorBlock({
        brandId, runId: run.id,
        draft: currentDraft,
        edition: "weekday",
        revisionFeedback: qualityResult.revision_recommendations,
      });
      qualityResult = await runQualityGate(brandId, run.id, currentDraft, "weekday", assignment.contentType);
      revisionCycle++;
    }

    if (!qualityResult.passed) {
      logger.warn("weekday_pipeline_quality_gate_max_revisions", { runId: run.id, qualityResult });
      // Continue to publish — flagged for human review in queue
    }

    // Render and persist
    const html = await htmlGeneratorBlock({ brandId, runId: run.id, episode: currentDraft, edition: "weekday" });
    const episode = await persistEpisode({
      brandId, runId: run.id, content: currentDraft, html, qualityResult,
      status: qualityResult.passed ? "pending_review" : "pending_review_with_warnings",
    });

    await markRunCompleted(run.id, episode.id);
    return episode;

  } catch (err) {
    await markRunFailed(run.id, err);
    throw err;
  } finally {
    await releaseBrandLock(brandId);
  }
}
```

The pipeline always produces an episode in `pending_review` status. The review UI is the gate to actually sending. Quality failures don't block production; they raise warnings for human attention.

## Weekend Pipeline (Saturday Morning Latte)

The weekend pipeline produces one episode per week (Saturday). It has a richer pre-research stage because content type variety is enforced at the structural level (10 distinct types) and destination/concept duplication has historically been the biggest editorial failure mode.

### Block: `content_type_selector` (weekend)

Picks one of the 10 content types based on recent usage history.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
}
```

**Output schema:**
```typescript
{
  contentType: "type_1" | "type_2" | ... | "type_10",
  contentTypeName: string,             // Human-readable
  rationale: string,                   // Why this type, given recent history
}
```

**Implementation:** Pure function. Looks up content type usage over the last 12 weeks. Filters out any type used 3+ times in that window. Selects from remaining types, weighted by recency (less recent = higher weight). No LLM call.

The "used 3+ times in 12 weeks" rule is preserved from the existing system. It's the right shape: enforces variety without preventing high-performing types from being available, and the lookback is long enough that no single type dominates.

### Block: `destination_proposer` (weekend)

Proposes a destination/topic for the selected content type.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  contentType: string,
  avoidConcepts: string[],             // Recent destination concepts to skip
  avoidFormulas: string[],             // Formulas to avoid (passed in on retry)
  attemptNumber: number,               // 1-3
}
```

**Output schema:**
```typescript
{
  destination: string,                 // "Ouray, Colorado" or "Tokyo's Daikanyama district"
  destination_concept: string,         // 1-2 sentence semantic summary
  positioning_angle: string,           // The narrative framing
  research_directive: string,          // What the research block should focus on
}
```

**Voice modules composed:**
- `core/llm-output-discipline`
- `brands/castor-abbott/weekend/voice-tone`
- `brands/castor-abbott/weekend/personal-context`
- `brands/castor-abbott/weekend/content-types/<type>`

**Model role:** `weekend.destination_proposer`. Default platform settings: Sonnet 4.5 at temperature 0.7 (higher temperature for genuine destination diversity), fallback to Opus 4. All settings overridable via `platform_config`.

**Critical behavior:** This block proposes; the validator decides. It's intentionally separated so the validator can reject without re-running the full destination generation; the proposer can be re-invoked with avoidance constraints.

### Block: `destination_validator` (weekend)

Checks the proposed destination against the brain. Three failure modes: hard duplicate, concept duplicate, formula exhaustion.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  destination: string,
  destinationConcept: string,
  contentType: string,
}
```

**Output schema:**
```typescript
{
  passed: boolean,
  failure_reason: "hard_duplicate" | "concept_duplicate" | "formula_exhaustion" | null,
  exhaustedFormulas: string[],         // Formulas overused in recent issues
  overusedTypes: string[],             // Content types overused
  similar_concepts: Array<{
    concept_id: string,
    similarity_score: number,
    used_at: string,
  }>,
}
```

**Implementation:**
1. Hard duplicate check: exact string match against `content_concepts.surface_form` for this brand and `cover_story` section in the lookback window.
2. Concept similarity check: embed `destinationConcept`, query `content_concepts` for cosine similarity, threshold at 0.85.
3. Formula check: query past episodes' content type + positioning angle combinations, flag if same combination occurred more than twice in the last 12 weeks.

No LLM call. Pure database queries.

**Why thresholds at 0.85:** Tested against historical Latte data, this catches the "different city, same narrative formula" failures (the Beaufort/Charleston/Savannah trio) without producing false positives on coincidentally similar destinations.

### Block: `research_latte` (weekend)

Type-specific research for the validated destination. The research framework varies by content type — see existing `research_latte.flow.md` for the 10 frameworks. Each framework lives as a separate voice module.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  destination: string,
  destinationConcept: string,
  contentType: string,
  positioningAngle: string,
  researchDirective: string,
}
```

**Output schema:** Variable per content type. Common base fields plus type-specific extensions:
```typescript
{
  cover_story_research: {
    type: string,
    payload: object,                   // Type-specific structure
    sources: Array<{ url: string, title: string, snippet: string }>,
  },
  tasting_menu: Array<{
    category: "drinking" | "reading" | "trying" | "watching" | "visiting" | "cooking" | "skipping",
    item_name: string,
    item_concept: string,
    point_of_view: string,
    url: string,
    is_contrarian: boolean,
  }>,
  hosts_corner: {
    technique: string,
    move_concept: string,
    why_it_works: string,
    insight_type: "physics" | "wisdom" | "insider",
    move_url: string,
  },
  the_drive: {
    vehicle: string,
    vehicle_concept: string,
    spectrum_category: "icon" | "sports_sedan" | "wagon" | "weekend_car" | "practical_with_soul",
    angle: string,
    url: string,
  },
  sunday_prep: {
    technique: string,
    body: string,                      // 50-75 words
  },
  sunday_reset: {
    quote: string,
    attribution: string,
  },
  sabbath: {
    scripture_reference: string,
    scripture_text: string,
    reflection: string,
  },
}
```

**Voice modules composed:**
- `core/llm-output-discipline`
- `brands/castor-abbott/shared/mark-persona`
- `brands/castor-abbott/weekend/voice-tone`
- `brands/castor-abbott/weekend/personal-context`
- `brands/castor-abbott/weekend/real-life-anchors`
- `brands/castor-abbott/weekend/unexpected-variable`
- `brands/castor-abbott/weekend/insight-layer`
- `brands/castor-abbott/weekend/guardrails`
- `brands/castor-abbott/weekend/car-spectrum` (for the_drive section only)
- `brands/castor-abbott/weekend/content-types/<type>` (for cover_story specifically)

**Model role:** `weekend.research`. Default platform settings: Sonnet 4.5 at temperature 0.2, fallback to Opus 4, reasoning disabled. All settings overridable via `platform_config`.

**Critical behavior:** Each section has its own concept extracted (cover_story_concept, tasting_menu items each get concepts, hosts_corner_concept, drive_concept, etc.). All concepts are written to `content_concepts` after the writer block produces final content — not at research time. Writing at research time would commit concepts that the writer might rework.

### Block: `writer_latte` (weekend)

Transforms research into the full weekend draft.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  destination: string,
  contentType: string,
  research: WeekendResearchOutput,
}
```

**Output schema:** Full weekend episode JSON with all sections. See `episode_sections` schema in `02_data_model`.

**Voice modules composed:** Full weekend voice stack including the content-type-specific module.

**Model role:** `weekend.writer`. Default platform settings: Opus 4 at temperature 0.4 (the Latte is the brand's most demanding voice; the larger model is worth the cost), fallback to Sonnet 4.5. All settings overridable via `platform_config` — if Opus becomes overkill or new models replace it, swap without redeploying.

**Critical behavior:** The writer block preserves destination, venue, and factual specifics from research. It does not invent or substitute. The "preserve content" directive in the voice modules and the schema validation enforce this.

### Block: `fact_checker` (weekend)

Verifies links, venues, product codes, and factual claims before editorial polish.

**Input schema:**
```typescript
{
  brandId: string,
  runId: string,
  draft: EpisodeDraft,
}
```

**Output schema:**
```typescript
{
  draft: EpisodeDraft,                 // Corrected if needed
  corrections: Array<{
    section: string,
    field: string,
    original: string,
    corrected: string,
    reason: string,
  }>,
  unverifiable_claims: Array<{
    section: string,
    claim: string,
    why_unverifiable: string,
  }>,
}
```

**Implementation:** Hybrid. Deterministic for link checks (HTTP HEAD requests against URLs, expecting 200/301/302 within timeout). LLM-assisted for content claims (venue still open, product code valid, statistic source legitimate).

**Model role for LLM-assisted parts:** `weekend.fact_checker`. Default platform settings: Sonnet 4.5 at temperature 0, fallback to Opus 4, reasoning disabled, schema-strict. All settings overridable via `platform_config`. Reasoning explicitly disabled because this block was the source of the Gemini reasoning leak in the existing system; the role configuration prevents reasoning leaks by construction.

This block was the source of the Gemini reasoning leak in the existing system. Switching to Claude Sonnet at temp 0 with reasoning explicitly disabled prevents that failure mode by construction.

**Critical behavior:** The fact checker makes surgical corrections, not rewrites. The voice and structure are preserved; only verifiable factual content changes. If a claim is unverifiable but plausibly correct, it's flagged in `unverifiable_claims` rather than removed — the editor decides what to do with it.

### Weekend Pipeline Orchestration

```typescript
export async function runWeekendPipeline(brandId: string) {
  const run = await createPipelineRun(brandId, "weekend");

  try {
    await acquireBrandLock(brandId);

    // Content type selection (no LLM call)
    const typeSelection = await contentTypeSelectorBlock({ brandId, runId: run.id });

    // Destination proposal + validation loop
    let attempt = 1;
    let avoidConcepts = await getRecentConcepts(brandId, "cover_story", 270);
    let avoidFormulas: string[] = [];
    let proposed: DestinationProposal;
    let validated: DestinationValidation;

    do {
      proposed = await destinationProposerBlock({
        brandId, runId: run.id,
        contentType: typeSelection.contentType,
        avoidConcepts,
        avoidFormulas,
        attemptNumber: attempt,
      });
      validated = await destinationValidatorBlock({
        brandId, runId: run.id,
        destination: proposed.destination,
        destinationConcept: proposed.destination_concept,
        contentType: typeSelection.contentType,
      });
      if (!validated.passed) {
        avoidFormulas = [...avoidFormulas, ...validated.exhaustedFormulas];
        attempt++;
      }
    } while (!validated.passed && attempt <= 3);

    if (!validated.passed) {
      logger.warn("weekend_destination_validation_exhausted", { runId: run.id, validated });
      // Proceed with the last proposal anyway, flagged for review
    }

    // Research and writing
    const research = await researchLatteBlock({
      brandId, runId: run.id,
      destination: proposed.destination,
      destinationConcept: proposed.destination_concept,
      contentType: typeSelection.contentType,
      positioningAngle: proposed.positioning_angle,
      researchDirective: proposed.research_directive,
    });

    const draft = await writerLatteBlock({
      brandId, runId: run.id,
      destination: proposed.destination,
      contentType: typeSelection.contentType,
      research,
    });

    // Fact check before editorial
    const factChecked = await factCheckerBlock({ brandId, runId: run.id, draft });

    // Editorial pass with deterministic pre-pass
    const preCleanedDraft = applyHardRulesPrePass(factChecked.draft);
    const edited = await editorBlock({
      brandId, runId: run.id, draft: preCleanedDraft, edition: "weekend",
    });

    // Quality gate with revision loop
    let qualityResult = await runQualityGate(brandId, run.id, edited, "weekend", "weekend");
    let revisionCycle = 0;
    let currentDraft = edited;

    while (!qualityResult.passed && revisionCycle < 3) {
      currentDraft = await editorBlock({
        brandId, runId: run.id,
        draft: currentDraft,
        edition: "weekend",
        revisionFeedback: qualityResult.revision_recommendations,
      });
      qualityResult = await runQualityGate(brandId, run.id, currentDraft, "weekend", "weekend");
      revisionCycle++;
    }

    // Render and persist
    const html = await htmlGeneratorBlock({ brandId, runId: run.id, episode: currentDraft, edition: "weekend" });
    const episode = await persistEpisode({
      brandId, runId: run.id, content: currentDraft, html, qualityResult,
      status: "pending_review",
    });

    // Write all concept embeddings to brain after successful generation
    await persistContentConcepts(brandId, episode.id, currentDraft);

    await markRunCompleted(run.id, episode.id);
    return episode;

  } catch (err) {
    await markRunFailed(run.id, err);
    throw err;
  } finally {
    await releaseBrandLock(brandId);
  }
}
```

The crucial difference from MindStudio: concept persistence happens *after* successful generation, not partway through. The advisory lock ensures no concurrent run reads stale state. Together these eliminate the race condition that produced five Savannah Lattes.

## The Hard Rules Pre-Pass

A deterministic check that runs before the editor block. Catches mechanical issues without spending tokens.

**Implementation:** Pure TypeScript. No LLM call. A series of regex and rule-based checks applied to every section's text content.

**Rules enforced:**

| Rule | Action |
|------|--------|
| Em dashes (`—`) | Replace with comma + space, period, or rewrite (longer regex with context) |
| `—` immediately preceded by closing punctuation | Always rewrite (rare case) |
| Banned weekday phrases ("In today's", "As we all know", "leverage", "synergy", etc.) | Flag with replacement suggestion; editor block decides |
| Banned weekend phrases ("for the discerning palate", "hidden gem", "elevate your", "curated", etc.) | Flag with replacement suggestion |
| Author credibility violations ("In my practice", "When I run client meetings", "My clients tell me") | Always flag; editor must rewrite |
| Coffee puns | Flag with note "remove coffee metaphor" |
| Lists with 7+ items | Flag for consolidation |
| Paragraphs > 3 sentences (weekday) | Flag for breaking up |
| Hedge words in opinion sections ("I think", "maybe", "sort of", "perhaps") | Flag with note "remove hedge" |

The pre-pass produces:

```typescript
{
  cleanedDraft: EpisodeDraft,           // With auto-fixable rules applied
  flagsForEditor: Array<{
    section: string,
    issue: string,
    suggestion: string,
    severity: "must_fix" | "should_fix" | "consider",
  }>,
}
```

The editor block receives the cleaned draft plus the flags. The editor doesn't have to spend tokens identifying em dashes — it spends tokens on the judgment-based decisions the regex can't make.

This is a 70-80% reduction in editor block scope and significantly better quality, because the model is focused on what it's actually good at.

## Block Configuration Summary

A summary table of all blocks for the dev team's quick reference. Each block declares a model role; actual provider/model/temperature settings live in `platform_config` and are hot-swappable.

| Block | Pipeline | Model Role | Default Primary | Default Temp |
|-------|----------|------------|-----------------|--------------|
| `content_type_assigner` | weekday | — (pure fn, no LLM) | — | — |
| `topic_proposer` | weekday | `weekday.topic_proposer` | Sonnet 4.5 | 0.4 |
| `research_agent` | weekday | `weekday.research` | Sonnet 4.5 | 0 |
| `writer_agent` | weekday | `weekday.writer` | Sonnet 4.5 | 0.3 |
| `opening_trifecta` | weekday | `weekday.opening_trifecta` | Sonnet 4.5 | 0.5 |
| `content_type_selector` | weekend | — (pure fn, no LLM) | — | — |
| `destination_proposer` | weekend | `weekend.destination_proposer` | Sonnet 4.5 | 0.7 |
| `destination_validator` | weekend | — (pure fn, no LLM) | — | — |
| `research_latte` | weekend | `weekend.research` | Sonnet 4.5 | 0.2 |
| `writer_latte` | weekend | `weekend.writer` | Opus 4 | 0.4 |
| `fact_checker` | weekend | `weekend.fact_checker` | Sonnet 4.5 | 0 |
| `editor` | both | `editor.standard` | Sonnet 4.5 | 0 |
| `persona_panel` (×10) | both | `persona.evaluator` | Sonnet 4.5 | 0 |
| `score_aggregator` | both | — (pure fn, no LLM) | — | — |
| `html_generator` | both | — (pure fn, no LLM) | — | — |

The "Default" columns describe the platform's Phase 1 launch configuration. None of these are pinned in code. All are config rows in `platform_config` that the dev team or Mark can update through the admin UI without a deploy.

Reasoning is disabled by default for every role. Fallback for every role defaults to Opus 4 (or Sonnet 4.5 for the `weekend.writer` role where Opus is primary).

Notable choices:

**Reasoning is disabled everywhere by default.** This is deliberate. Reasoning leaks into structured output (the Gemini Hosts Corner bug, repeatedly). For pipeline use, reasoning is more risk than benefit. The role-based config means if a future block needs reasoning for genuine quality reasons, it's a config update, not a code change.

**Sonnet 4.5 is the default for most roles.** Opus is the fallback or used for the most demanding voice (`weekend.writer`). The cost difference matters at four brands × multiple sends per week × multiple blocks per send. Sonnet is good enough for 90% of blocks; using Opus across the board would be wasteful.

**Temperature is generally low.** Most blocks produce structured output where determinism matters. Higher temperatures appear only where genuine variety is the goal: destination proposing (0.7), opening trifecta candidates (0.5), topic proposing (0.4), weekend writer (0.4).

**Pure functions wherever possible.** Content type selectors, validators, score aggregators, HTML generators — none of these need LLM calls. Doing them in code is faster, cheaper, more reliable, and easier to test. The principle is: use LLMs for judgment and language; use code for math and structure.

**Hot-swappable from day one.** When new models ship (Sonnet 5, Opus 5, GPT-5, Gemini 3), evaluation goes like this: route a percentage of traffic on the relevant role to the new model via a brand-specific or environment-specific override, observe quality scores and costs over a week, decide. No code changes. No deploys. Config updates with full audit trail in `audit_log`.

## Open Decisions for the Dev Team

- **Specific React Email components library:** Build custom or adopt a library. React Email has decent defaults; custom components per section type are the right call.
- **Specific implementation of advisory locks:** Postgres `pg_advisory_lock` via Supabase client. Implementation detail.
- **Whether to retry persona panel evaluations on schema failure:** Spec says 1 retry, then exclude. Could be more aggressive (2-3 retries) at the cost of latency. Acceptable to tune.
- **HTML preview in pipeline output for review UI:** The pipeline produces final HTML; the review UI may also want a preview render with edit annotations. Implementation detail in `08_review_interface`.
- **Whether to support partial pipeline replay** (re-run from a specific block, not the start): Useful for debugging. Not in v1 spec; can be added.

## Acceptance Criteria

The content pipeline is complete when:

- [ ] All 13 blocks listed in the configuration summary table are implemented in `apps/pipeline/src/blocks/`.
- [ ] Every block declares a `modelRole` rather than hardcoded model strings. Code review enforces this.
- [ ] All Phase 1 model roles (the 10 listed in `01_foundation`) have config rows in `platform_config` for the production environment.
- [ ] The LLM client wrapper resolves roles correctly (brand+env override → platform default → throw).
- [ ] An integration test verifies that updating a role config row changes the model used in the next pipeline run, with no code change.
- [ ] An integration test verifies that brand-specific role overrides work (e.g., Castor Abbott uses one model, Treasure Financial uses another, for the same role).
- [ ] Each block has unit tests for input validation, output schema validation, and at least one happy-path scenario.
- [ ] Each block emits structured logs at start and completion via `@platform/observability`. Logs include both the role name and the resolved provider/model that was actually used.
- [ ] Each block writes a `block_executions` row with full metadata, including resolved provider/model for replay safety.
- [ ] The weekday pipeline runs end-to-end against fixture data and produces a valid episode.
- [ ] The weekend pipeline runs end-to-end against fixture data and produces a valid episode.
- [ ] The hard rules pre-pass is implemented and tested with at least 30 example inputs covering all rule categories.
- [ ] Advisory locks work correctly: a second concurrent pipeline run for the same brand blocks until the first completes.
- [ ] The destination retry loop correctly cycles through up to 3 attempts when validator rejects.
- [ ] The quality gate revision loop correctly cycles through up to 3 attempts when score aggregator rejects.
- [ ] An integration test confirms that the Gemini-style reasoning leak failure mode does not occur with the current model + reasoning configuration.
- [ ] An integration test confirms that the Savannah-five-times race condition does not occur under concurrent invocation.

---

**Next:** Read `05_brain_and_learning.spec.md` for the brain (concept storage and duplicate prevention) and the closed feedback loop that turns sends into learning.
