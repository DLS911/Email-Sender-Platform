---
spec: 03_voice_system
title: Voice Module Architecture
version: 1.0
status: draft
audience: dev_team, agentic_orchestrator, editorial_team
dependencies:
  - 00_overview
  - 01_foundation
  - 02_data_model
consumed_by:
  - 04_content_pipeline
  - 05_brain_and_learning
  - 07_experiment_framework
  - 08_review_interface
purpose: Define how voice composes from modular pieces. Decompose the existing Castor Abbott system prompts into reusable, versioned modules. Establish the pattern for adding the other three brands' voices later.
---

# Voice Module Architecture

## What This Spec Covers

How voice gets specified, stored, versioned, and composed at runtime. The full decomposition of Castor Abbott's existing weekday and weekend voice into discrete modules. The composition layer that block writers use to assemble system prompts on demand. The pattern that the other three brands (Cortex, Fidelon, Treasure Financial) will follow when they're added.

This spec does not cover prompt engineering for individual blocks (that's `04_content_pipeline`) or persona definitions used in peer review (those are voice modules but documented inline with the rest). It covers the architecture and the Castor Abbott-specific module catalog.

## Why This Spec Exists

The current MindStudio system has voice scattered across multiple system prompts that overlap, duplicate, and drift. Trust Stacking is referenced in three places. Author credibility constraints appear in two. The "no em dashes" rule lives in five different files. When voice needs to be sharpened or corrected, you have to update all the copies.

The new system has voice in exactly one place per concept. A voice module is a single source of truth. Blocks compose the modules they need; they don't carry their own copies. Updating a module updates everything that uses it.

The architectural principle: **voice is data, not code.** Voice modules are version-controlled markdown files with structured metadata. They're loaded at runtime, composed into prompts, and tracked through the production pipeline. Changes to voice are PRs against the voice module repo, not edits to monolithic prompt strings.

## The Module Concept

A voice module is a self-contained piece of voice specification with one job. Examples:

- The Trust Stacking framework definition
- The "no em dashes" formatting rule
- The Saturday Morning Latte's car background and spectrum
- The Solo Operator persona profile
- The contrarian position on referrals

Each module is small (typically 50-500 words), focused, and independently versioned. A block that writes the Daily Grind's Tactic section composes maybe 8-12 modules. A block that writes the Saturday Latte's Cover Story composes maybe 10-14 modules. The block doesn't carry the voice itself; it declares what it needs.

This design has three benefits worth defending:

**Updates compound.** Sharpening the "fresh language" guidance once improves every block that composes it.

**Brands share what's shareable.** The "no em dashes" formatting rule is universal; every brand's editor uses the same module. The Trust Stacking framework is Castor Abbott-specific; only Castor Abbott blocks use it. The architecture makes both cases natural.

**Voice changes are auditable.** Every module is versioned. Every pipeline run records which version of which modules it used. When a future Mark looks at output from six months ago and asks "why did the system write it this way?", the answer is in the version history.

## File Structure

Voice modules live in the monorepo at `packages/voice-modules/`. The structure:

```
packages/voice-modules/
├── package.json
├── src/
│   ├── index.ts                          # Module loader, composer, registry sync
│   ├── core/                             # Universal modules used across brands and editions
│   │   ├── voice-rules.md                # Formatting rules (em dashes, passive, etc.)
│   │   ├── llm-output-discipline.md      # No preamble, JSON-only when applicable, etc.
│   │   └── editorial-quality.md          # Strong endings, fresh language pattern, surgical precision
│   ├── brands/
│   │   ├── castor-abbott/
│   │   │   ├── shared/                   # Modules used by both editions
│   │   │   │   ├── mark-persona.md       # Brand-level Mark (founder, not advisor)
│   │   │   │   ├── author-credibility.md # What Mark can/can't claim
│   │   │   │   └── audience.md           # Who reads this brand
│   │   │   ├── weekday/
│   │   │   │   ├── voice-tone.md         # Sharp colleague, first sentence punches
│   │   │   │   ├── trust-stacking.md     # The 8 principles
│   │   │   │   ├── physician-model.md    # Diagnose, clinical, GAP
│   │   │   │   ├── gap-framework.md      # Where now / where want / what's it costing
│   │   │   │   ├── three-torments.md     # Recency / Frequency / Intensity
│   │   │   │   ├── offers-vs-proposals.md
│   │   │   │   ├── contrarian-positions.md
│   │   │   │   ├── language-guide.md     # Never use / banned / always use / preferred
│   │   │   │   ├── synthesis.md          # Not regurgitation
│   │   │   │   └── content-types/
│   │   │   │       ├── tactic.md
│   │   │   │       ├── take.md
│   │   │   │       ├── story.md
│   │   │   │       ├── rant.md           # Friday Take
│   │   │   │       ├── special.md        # With subtypes
│   │   │   │       └── ancient-truth.md  # Proverbs
│   │   │   └── weekend/
│   │   │       ├── voice-tone.md         # Complete Mark, post-aspirational
│   │   │       ├── personal-context.md   # 4 kids 13-20, salt canal, fishing, skiing
│   │   │       ├── real-life-anchors.md  # What grounds every recommendation
│   │   │       ├── car-spectrum.md       # The Drive's full vehicle catalog
│   │   │       ├── unexpected-variable.md # The rubric for the nuanced take
│   │   │       ├── insight-layer.md      # Physics / wisdom / insider
│   │   │       ├── guardrails.md         # Mark loves / Mark hates lists
│   │   │       ├── what-this-voice-isnt.md # Curator language, status signaling, etc.
│   │   │       └── content-types/
│   │   │           ├── type-1-overlooked-destination.md
│   │   │           ├── type-2-luxury-insider.md
│   │   │           ├── type-3-peak-season.md
│   │   │           ├── type-4-food-first.md
│   │   │           ├── type-5-international-insider.md
│   │   │           ├── type-6-activity-mastery.md
│   │   │           ├── type-7-family-reality.md
│   │   │           ├── type-8-tactical-weekend.md
│   │   │           ├── type-9-logistics-hack.md
│   │   │           └── type-10-hyper-local.md
│   │   ├── cortex/                       # Phase 5+: voice modules for Cortex
│   │   ├── fidelon/                      # Phase 4: voice modules for Fidelon
│   │   └── treasure-financial/           # Phase 5: voice modules for Treasure
│   └── personas/                         # Persona profiles for peer review evaluation
│       ├── castor-abbott/
│       │   ├── solo-operator.md
│       │   ├── rising-star.md
│       │   ├── wirehouse-refugee.md
│       │   ├── fee-only-purist.md
│       │   ├── women-advisor.md
│       │   ├── next-gen-inheritor.md
│       │   ├── niche-specialist.md
│       │   ├── team-builder.md
│       │   ├── veteran.md
│       │   └── compliance-conscious.md
│       └── ... (other brands as they're added)
└── tests/
    ├── module-loader.test.ts
    ├── composer.test.ts
    └── registry-sync.test.ts
```

The structure mirrors the conceptual hierarchy: core modules at the top, brand-specific below, persona profiles separated because they're consumed differently (peer review iterates over personas; writers don't).

## Module File Format

Every module is a markdown file with YAML frontmatter. The frontmatter provides structured metadata; the body is the prompt content.

Example: `packages/voice-modules/src/brands/castor-abbott/weekday/trust-stacking.md`

```markdown
---
module_id: castor-abbott/weekday/trust-stacking
version: 1
category: framework
brand: castor_abbott
edition: weekday
description: Mark's proprietary trust-building methodology. The 8 principles that define how a financial advisor builds genuine authority with prospects and clients.
status: active
created_at: 2026-04-29
last_updated: 2026-04-29
---

## Trust Stacking™

Mark's proprietary methodology. The core principles:

1. **Be trustworthy before being liked.** Don't try to be their friend first. Be credible.
2. **Be competent before offering help.** Prove you understand before you prescribe.
3. **Be a professional when prospects hide behind mistakes.** A pro finds the problem and asks uncomfortable questions.
4. **Bring people to a clear decision point.** Make sure they know exactly what they're deciding.
5. **Sales is leadership, not "selling".** You're guiding, not convincing.
6. **You can't fake greatness.** Everyone knows instantly when they're with a professional.
7. **Trust is purchased.** Through long hours working on your psychology so you can get out of the way of your ego.
8. **Care more about what they want.** More than you want a "sale."

When writing content that touches client acquisition, prospecting, or relationship-building: Trust Stacking is the spine. Tactics that violate these principles fail review regardless of conventional industry merit.
```

The frontmatter fields:

- **`module_id`**: Globally unique identifier. Format: `<brand-or-core>/<edition-if-applicable>/<module-name>`. Used as the registry key and in code references.
- **`version`**: Integer. Increments on every meaningful content change. Past versions remain accessible for replay.
- **`category`**: One of `core`, `framework`, `tone`, `language`, `context`, `content_type`, `persona`, `editorial`. Used for filtering and reporting.
- **`brand`**: The brand this module belongs to, or `null`/`shared` for cross-brand modules.
- **`edition`**: `weekday`, `weekend`, `both`, or `null` for non-edition-specific.
- **`description`**: One-sentence semantic summary. Used in module discovery and registry.
- **`status`**: `active`, `experimental`, `deprecated`. Deprecated modules can still be loaded for replay but emit warnings.
- **`created_at` / `last_updated`**: Standard timestamps.

Body is markdown. The composer extracts the body and prepends it (with appropriate section breaks) into the system prompt being assembled.

## The Composition Layer

Voice modules are loaded and composed by `@platform/voice-modules`. The public API:

```typescript
import { composeVoice, loadModule } from "@platform/voice-modules";

// Compose a system prompt from a list of module IDs
const systemPrompt = await composeVoice({
  modules: [
    "core/voice-rules",
    "core/editorial-quality",
    "castor-abbott/shared/mark-persona",
    "castor-abbott/shared/author-credibility",
    "castor-abbott/weekday/voice-tone",
    "castor-abbott/weekday/trust-stacking",
    "castor-abbott/weekday/gap-framework",
    "castor-abbott/weekday/contrarian-positions",
    "castor-abbott/weekday/language-guide",
    "castor-abbott/weekday/content-types/tactic",
  ],
  context: {
    blockName: "tactic_writer",
    runId: "...",
    brandId: "castor_abbott",
  },
});
```

The composer:

1. Loads each module from disk (cached in memory after first load).
2. Validates that requested modules exist and are not deprecated (deprecated modules emit warnings but still load).
3. Concatenates module bodies in the order specified, separated by `---` dividers.
4. Records which modules at which versions were composed for this run (logged to `block_executions.input_payload.voice_modules`).
5. Returns the assembled system prompt as a string.

Module ordering matters. The composer assembles in the order provided. Convention is most-general-first: core rules → brand persona → edition voice → frameworks → language guide → content type. The blocks declare their composition order.

Composition is deterministic and replayable. Given the same module IDs at the same versions, the output is identical. This makes prompt regression testing straightforward — golden snapshots can verify that voice changes are intentional, not accidental.

## Module Versioning Strategy

Modules are versioned at the file level via the `version` frontmatter field. Versioning rules:

**When to bump version:**
- Substantive change to the module's content, intent, or rules
- Removal or addition of a principle, rule, or example
- Renaming or restructuring the module's body

**When NOT to bump version:**
- Typo fixes
- Formatting cleanup (whitespace, markdown rendering issues)
- Frontmatter-only changes that don't affect prompt content

**Past versions are preserved.** Historical versions live in git history (the canonical source) and are referenced by past `block_executions.input_payload.voice_modules` records. Replay of an old run loads the version that was active at the time, not the current version.

**Active version is the latest committed.** No "draft" or "staging" versions in the file system. Branch-based workflow handles staging — voice changes go through PRs and only land on `main` after review.

**Voice config refers to module IDs, not versions.** A `brand_voice_config` row says "use `castor-abbott/weekday/trust-stacking`," not "use version 3 of it." The composer resolves to the latest version at compose time. This is deliberate: voice configs describe *what* gets used; git describes *what version*.

If a brand needs to pin to a specific version (say, Cortex wants Castor Abbott's Trust Stacking module but only the v1 wording, not the v3 evolution), that's a fork — a Cortex-specific copy of the module. Pinning via config would create version-coupling complications that aren't worth solving.

## Module Registry

The `voice_module_registry` table (defined in `02_data_model`) tracks active modules at the database level. A CI job reads `packages/voice-modules/src/` and syncs the registry on every deploy.

Registry sync logic:

1. Walk the file tree, parse frontmatter from each `.md` file.
2. For each module: upsert a row keyed on `module_id`. Update `current_version`, `category`, `brand_id`, `description`, `status` from frontmatter.
3. For modules in the registry but no longer in the file tree: mark as `deprecated` (do not delete; old configs may reference them).
4. Fail the build if frontmatter is malformed or required fields are missing.

The registry exists for two purposes: discoverability (the review UI can show "what voice modules exist for this brand") and validation (a `brand_voice_config` referencing a non-existent module ID gets caught at config-write time, not at runtime).

## Castor Abbott Voice: The Full Decomposition

This section catalogs every voice module for the Castor Abbott brand and describes what each contains. The dev team uses this as the implementation checklist for Phase 1.

### Core Modules (universal, shared across brands)

**`core/voice-rules`**
The hard formatting rules. No em dashes (use commas, periods, parentheses). No passive voice. Active voice only. Short paragraphs (2-3 sentences max). One idea per paragraph. Specific over generic. No hedge words ("I think," "maybe," "sort of"). No corporate speak ("leverage," "optimize," "synergy"). These rules apply everywhere, every brand, every edition.

**`core/llm-output-discipline`**
Output discipline for LLM-generated content. Return only the requested format (JSON when requested, markdown when requested). No preamble ("Here's the content you requested..."). No postamble ("Let me know if you'd like adjustments..."). No meta-commentary about the generation process. The output is the deliverable, not a conversation about the deliverable.

**`core/editorial-quality`**
The cross-brand editorial discipline. Strong endings (the last line lands, doesn't retreat). Fresh language (the voice is the pattern, not the words). Surgical precision (every word earns its place; if removing it doesn't change the meaning, remove it). Synthesis over regurgitation (filter inputs through the brand's worldview, don't just summarize them).

### Castor Abbott Shared Modules

**`brands/castor-abbott/shared/mark-persona`**
Mark as the brand persona. Founder of Castor Abbott, lead generation business serving financial advisors. Decade of work with 1000+ advisors. Pattern recognition across the industry. Practitioner who has built something that works, not a generic content creator. This module establishes who's "speaking" but does not address tone — that's edition-specific.

**`brands/castor-abbott/shared/author-credibility`**
The hard constraint on what Mark can and can't claim. Mark is NOT a practicing financial advisor. He runs a lead generation business. He has worked with over 1000 advisors and firm leaders over the last 10 years.

ALLOWED: "An advisor I work with told me..." / "The advisors I know who do this well..." / "I've seen this work for dozens of practices..." / "When I talk to top advisors, they say..."

NOT ALLOWED: "When I run client meetings..." / "In my practice..." / "My clients tell me..." / Any implication Mark manages money or gives financial advice.

This module is loaded into every block that produces Castor Abbott content. Violations are flagged by the editor block.

**`brands/castor-abbott/shared/audience`**
Who reads Castor Abbott. Independent RIAs, wirehouse refugees, fee-only planners, team builders. Tired of generic industry content that writes "at" them instead of "with" them. Can smell commission-breath and sales tactics from a mile away. Want to be challenged, not coddled. Appreciate contrarian thinking backed by experience. Building practices, not just collecting clients.

This module is consumed by writer blocks (so they write *to* this audience) and by persona panel blocks (so personas have shared context).

### Weekday-Specific Modules (The Daily Grind)

**`brands/castor-abbott/weekday/voice-tone`**
The weekday register. Sharp colleague, not guru or teacher. Opinionated but fair. Confident without being arrogant. First sentence must punch — no throat-clearing. Visceral language allowed and encouraged (demons, torments, GAP, commission-breath, buying unit). Self-aware humor (wry, never forced, never punny). Reframing before advising — the reframe IS the advice. Moral clarity without dogma. Diagnose; do not lecture.

What weekday voice does NOT sound like: generic sales coach ("here are 5 tips to boost your referrals!"), corporate content mill ("in today's competitive landscape..."), preachy or self-righteous ("you should NEVER..."), hedge-y ("you might want to consider...").

**`brands/castor-abbott/weekday/trust-stacking`**
The full Trust Stacking™ framework. The 8 principles. When applicable: any content touching client acquisition, prospecting, relationship-building. Tactics that violate the principles fail review.

**`brands/castor-abbott/weekday/physician-model`**
The Physician Model. Diagnose before prescribing. Be clinical during discovery ("Got it" — neutral acknowledgment). Save empathy for after you understand. Your job is to expose the GAP between where they are and where they want to be.

**`brands/castor-abbott/weekday/gap-framework`**
The GAP Framework. Where are they now? Where do they want to be? What is it COSTING them to stay where they are? Your role: expose the GAP, not "sell" the solution.

**`brands/castor-abbott/weekday/three-torments`**
Three Levels of Torment for understanding client pain. Recency ("What happened?" — Is this pain present NOW?). Frequency ("How long has this been going on?" — Is this recurring?). Intensity ("What does this really cost you?" — Mole problem or cancer problem?). Used in any tactic about discovery, qualification, or client conversations.

**`brands/castor-abbott/weekday/offers-vs-proposals`**
Offers vs. Proposals. An offer is a response, not a proposal asking for a response. Don't convince a market to be interested. Answer an existing pain that is Recently, Frequently, and Intensely experienced. Find out what they are buying and sell them what they are buying.

**`brands/castor-abbott/weekday/contrarian-positions`**
The contrarian positions, as a single module. On Referrals (never scripted asks; be referable and memorable). On Sales (never commission-breath, never urgency manipulation, never "closing techniques"; sales is leadership). On Compensation Transparency (not anti-commission; anti-hidden-commission). On Marketing (never cold outreach scripts, never garbage leads; build trust at scale). On Features & Benefits (lead with their hell, close with your prescription). On Being a Professional (do the inner work; can't fake greatness).

These positions override generic industry advice. If content contradicts them, the editor flags for revision.

**`brands/castor-abbott/weekday/language-guide`**
Never use / banned constructions / always use / preferred vocabulary. The full rules. Never use: corporate speak, hedge language, "reach out," "best practices," "simple/easy" (dismissive), "hack/trick" (cheapens). Banned constructions: "In today's [anything]...", "As we all know...", "Here's the thing..." (throat-clearing), starting with "So,", "At the end of the day...", lists of 7+ items. Always use: specific numbers, names, examples; "you" to address the reader; short paragraphs; active voice. Preferred: GAP, diagnose, prescription, clinical, professional, "what happened?", "what is it costing you?", "back of the napkin math," contrarian.

**`brands/castor-abbott/weekday/synthesis`**
The synthesis principle. Tactics don't all come from Mark's trainings. The world is full of brilliant ideas, frameworks, and approaches. The job is synthesis: find great tactics from across the industry and beyond, filter through Mark's philosophy and voice, pressure-test against contrarian positions, translate into language advisors can use immediately. Synthesis is NOT copying industry content and changing words.

**`brands/castor-abbott/weekday/content-types/*`**
One module per content type with structural and tonal guidance specific to that type. The Tactic (must be implementable this week, specific language they can use, show the thinking, connect to client decision). The Take (start with conventional wisdom, subvert it, clear position, end with reframe not tips). The Story (specific moment, specific person anonymized, lesson emerges from story not stated, before/after). The Rant / Friday Take (righteous anger channeled into clarity, name the problem, do the math, offer alternative). The Special with subtypes (compliance, team_management, tech_deep_dive). The Ancient Truth (Proverbs only, application earned not forced, let proverb do heavy lifting).

### Weekend-Specific Modules (Saturday Morning Latte)

**`brands/castor-abbott/weekend/voice-tone`**
The weekend register. Complete Mark, not just professional Mark. Post-aspirational. Has arrived. Sharp but warmer. Sounds like a smart friend who's done the homework sharing what he actually chooses, not a lifestyle blogger or a curator. Permission-giving rather than aspirational. The test: would you actually say this to a friend over beers?

What weekend voice does NOT sound like: travel magazine ("a hidden gem awaits..."), luxury curator ("for the discerning palate..."), influencer ("you NEED to try this..."), life coach ("here's your permission to..."), AI following a checklist.

**`brands/castor-abbott/weekend/personal-context`**
Who Mark is at home. Wife and four kids he loves more than air. Kids ages 13-20 — teenagers and young adults, NOT toddlers. No booster seats, no "little ones," no toddler references. Deep, lifelong friends. Feels God's presence in mountains and deep sea fishing in the ocean where you can't see land. Loves Jesus. Loves country. Loves people. Can't stand politicians (regardless of party). Lives on a deep water salt canal that leads to the ocean. Fishing boat in the backyard. Family skis a month out west every year — through the trees, steeps, powder, moguls, all of it.

This is the life the weekday tactics are building toward. The weekend voice draws from this context constantly.

**`brands/castor-abbott/weekend/real-life-anchors`**
What grounds every recommendation. 4 kids 13-20 (teenagers with opinions, college visits, kids who might actually hang out if you create the right environment). Wife as partner and co-parent. Family table — all 6, lingering after dinner. Friends in community — golf cart down the road, Friday pizza nights, not isolated. Coastal Florida — salt water canal, fishing boat, hauling fish, deep ocean, sand bars in summer. Skiing out west — month every year. Competence over consumption — the practicality IS the flex. Cost of ownership — what it costs to run, not just buy.

Every weekend recommendation should ground in one or more of these anchors. Generic recommendations that float without context fail review.

**`brands/castor-abbott/weekend/car-spectrum`**
The Drive's vehicle catalog, with Mark's car background. Grew up memorizing 0-60 times, Car and Driver, Road & Track. Wrenched on Porsches, Audis, Mustangs, BMWs, VWs, Mitsubishis, Mazdas, Volvos, Fords, Lincolns, Subarus. Currently: Lincoln Navigator, golf cart. Previously: 4 Porsches (924, 944, 968, Cayenne Turbo), Audi S4, Audi S6 Avant, BMW X3M Competition.

The full spectrum: Icons (used 911 manual, M3, Giulia QV, Shelby GT350). Sports Sedans (CT5-V Blackwing, M5, AMG E63 S). Wagons (RS6 Avant, AMG E63 S Wagon, V60 Polestar). Weekend Cars (used 911, Miata, M2, Cayman GT4). Practical with Soul (Stelvio QV, X3M, Macan GTS, Raptor, TRX, Power Wagon).

The discipline: don't pick practical SUVs every time. The car must have soul — built by people who drive, not spreadsheets. End with conviction, not hedge.

**`brands/castor-abbott/weekend/unexpected-variable`**
The rubric for the nuanced take in Tasting Menu and recommendations. The insight isn't the product. It's what to actually think about when deciding. Examples (illustrative, not exhaustive): Coolers (obvious: ice retention; actual: will you use it enough to justify it?). Power tools (obvious: power; actual: weight and fatigue over a full day). Wine country (obvious: quality of wine; actual: do you have to perform expertise?). Dutch ovens (obvious: cooking performance; actual: trapping steam for bread).

Wrong (binary): "Skip the Yeti. The Igloo is just as good for less."
Right (nuanced): "We live on salt water, fish a lot, take it everywhere. 600 lbs of fish in summer heat. Nothing thawed. Cry-once purchase. But most people don't use a cooler enough to justify it. If you're buying it for the sticker on your truck, skip it. If you're actually hauling fish? Get it."

**`brands/castor-abbott/weekend/insight-layer`**
Every recommendation needs more than "buy this." It needs one of: Physics (teach WHY it works — "Pizza stones don't retain enough heat. Steel transfers energy faster"), Wisdom (reveal the deeper truth — "If you build spaces where kids want to hang out, you will never wonder where they are"), Insider (level the playing field — "Most people walk right past the Costco wine section. Mistake. When they release that Kirkland Reserve from Stags Leap, buy every bottle"). The recommendation that lacks a payload reads as content marketing; the one that has it reads as a friend sharing.

**`brands/castor-abbott/weekend/guardrails`**
Mark loves (don't trash): Peloton Power Zone training (the hidden gem, not the leaderboard stuff), Yeti coolers (for heavy users), Costco Kirkland wines and spirits, Lodge cast iron, pizza steel.

Mark hates (don't recommend): Traeger pellet smokers (the secret is in the wood), pizza stones (everybody has one), bread machines (everybody had one in 2003), scripted referral asks.

This list will grow as new guardrails emerge from production. Adding to it is a PR against this module.

**`brands/castor-abbott/weekend/what-this-voice-isnt`**
The negative space. Never write: "for the discerning palate," "where successful people go to be seen," "a hidden gem only locals know," "a curated selection of," "elevate your weekend with," "the sophisticated choice," "self-care," "unplug," "disconnect," "work-life balance" (it's all one life). Anything that sounds like a wellness influencer. Humble-brags disguised as gratitude.

These phrases signal insecurity. Mark has conviction. He's done the work. He doesn't need to soften his takes.

**`brands/castor-abbott/weekend/content-types/*`**
One module per weekend content type, mirroring the 10 types from the existing system. Each module specifies the structural framework (place-based discovery, property comparison, tactical strategy, multi-stop journey, etc.) and the elements to include. The voice modules above provide the *how*; the content type modules provide the *what structure*.

### Persona Modules (used by peer review)

The 10 personas live in `packages/voice-modules/src/personas/castor-abbott/`. Each is a single module with the persona profile, baseline engagement rate, content preferences, flag triggers, and segment classification. Detailed persona definitions are not duplicated here — they exist in the existing system prompts and get ported as-is to module form.

The peer review block iterates over these modules in parallel, one persona per evaluation, scoring per the rubric in `04_content_pipeline`.

## Brand Voice Config: How Modules Get Selected

The `brand_voice_configs` table stores per-brand module selections. Castor Abbott's active config (illustrative):

```json
{
  "weekday": {
    "shared_modules": [
      "core/voice-rules",
      "core/llm-output-discipline",
      "core/editorial-quality",
      "brands/castor-abbott/shared/mark-persona",
      "brands/castor-abbott/shared/author-credibility",
      "brands/castor-abbott/shared/audience"
    ],
    "voice_modules": [
      "brands/castor-abbott/weekday/voice-tone",
      "brands/castor-abbott/weekday/trust-stacking",
      "brands/castor-abbott/weekday/physician-model",
      "brands/castor-abbott/weekday/gap-framework",
      "brands/castor-abbott/weekday/three-torments",
      "brands/castor-abbott/weekday/offers-vs-proposals",
      "brands/castor-abbott/weekday/contrarian-positions",
      "brands/castor-abbott/weekday/language-guide",
      "brands/castor-abbott/weekday/synthesis"
    ],
    "content_type_modules": {
      "tactic": "brands/castor-abbott/weekday/content-types/tactic",
      "take": "brands/castor-abbott/weekday/content-types/take",
      "story": "brands/castor-abbott/weekday/content-types/story",
      "rant": "brands/castor-abbott/weekday/content-types/rant",
      "special": "brands/castor-abbott/weekday/content-types/special",
      "ancient_truth": "brands/castor-abbott/weekday/content-types/ancient-truth"
    },
    "persona_modules": [
      "personas/castor-abbott/solo-operator",
      "personas/castor-abbott/rising-star",
      "personas/castor-abbott/wirehouse-refugee",
      "personas/castor-abbott/fee-only-purist",
      "personas/castor-abbott/women-advisor",
      "personas/castor-abbott/next-gen-inheritor",
      "personas/castor-abbott/niche-specialist",
      "personas/castor-abbott/team-builder",
      "personas/castor-abbott/veteran",
      "personas/castor-abbott/compliance-conscious"
    ]
  },
  "weekend": {
    "shared_modules": [
      "core/voice-rules",
      "core/llm-output-discipline",
      "core/editorial-quality",
      "brands/castor-abbott/shared/mark-persona",
      "brands/castor-abbott/shared/audience"
    ],
    "voice_modules": [
      "brands/castor-abbott/weekend/voice-tone",
      "brands/castor-abbott/weekend/personal-context",
      "brands/castor-abbott/weekend/real-life-anchors",
      "brands/castor-abbott/weekend/unexpected-variable",
      "brands/castor-abbott/weekend/insight-layer",
      "brands/castor-abbott/weekend/guardrails",
      "brands/castor-abbott/weekend/what-this-voice-isnt"
    ],
    "section_modules": {
      "the_drive": "brands/castor-abbott/weekend/car-spectrum"
    },
    "content_type_modules": {
      "type_1": "brands/castor-abbott/weekend/content-types/type-1-overlooked-destination",
      "type_2": "brands/castor-abbott/weekend/content-types/type-2-luxury-insider",
      "...": "..."
    },
    "persona_modules": [
      "...same 10 personas, plus weekend-specific evaluation guidance via the persona modules themselves..."
    ]
  }
}
```

Note that `author-credibility` is in the weekday `shared_modules` but not the weekend list. The Saturday Latte voice is personal Mark, who *is* married and *does* live on a salt canal — author credibility constraints don't apply the same way. This is intentional, and a small but important piece of voice architecture.

## How Blocks Use Voice Modules

Each block in the content pipeline declares the modules it composes. From `04_content_pipeline` (referenced for context):

```typescript
// In apps/pipeline/src/blocks/weekday/tactic-writer.ts
import { composeVoice } from "@platform/voice-modules";
import { tacticWriterSchema } from "@platform/schemas";
import { llmClient } from "@platform/llm-client";

export async function tacticWriterBlock(input: TacticWriterInput) {
  const voiceConfig = await getActiveVoiceConfig(input.brandId, "weekday");

  const systemPrompt = await composeVoice({
    modules: [
      ...voiceConfig.weekday.shared_modules,
      ...voiceConfig.weekday.voice_modules,
      voiceConfig.weekday.content_type_modules.tactic,
    ],
    context: {
      blockName: "tactic_writer",
      runId: input.runId,
      brandId: input.brandId,
    },
  });

  return await llmClient.generate({
    primary: { provider: "anthropic", model: "claude-sonnet-4.5" },
    fallback: { provider: "anthropic", model: "claude-opus-4" },
    systemPrompt,
    userPrompt: buildTacticUserPrompt(input),
    schema: tacticWriterSchema,
    context: { ... },
  });
}
```

The block doesn't carry voice. It declares what voice it needs and lets the composer assemble it. Updating Trust Stacking once updates every block that composes Trust Stacking.

## Adding a New Brand: The Pattern

When Cortex, Fidelon, or Treasure Financial onboards, the pattern is:

1. Create `packages/voice-modules/src/brands/<brand-id>/` with `shared/`, edition subdirectories as needed, and `content-types/` if the brand has structured content types.
2. Author the voice modules. Reuse `core/` modules unmodified. Author brand-specific modules from scratch (don't copy Castor Abbott's — that defeats the purpose).
3. Author the brand's persona panel in `packages/voice-modules/src/personas/<brand-id>/`. The personas are different — Treasure Financial's audience is retail investors, not advisors, so the personas are different humans with different concerns and engagement patterns.
4. Create the `brand_voice_configs` row pointing to the modules.
5. Run the registry sync to update `voice_module_registry`.
6. Wire up the block compositions in `apps/pipeline/src/blocks/<brand-or-shared>/`.
7. Run a test pipeline against fixture data. Verify the output is on-voice for the new brand.

Step 7 is the only step that requires real human judgment. Steps 1-6 are mechanical and an agentic dev team can execute them given the brand's voice specification.

The Castor Abbott implementation in Phase 1 produces the patterns the other brands inherit. Phase 4 (Fidelon) will stress-test whether the pattern handles the B2B/B2C dual-track properly. If it doesn't, that's the moment to refactor — before brands 3 and 4 follow the same pattern.

## Cross-Brand Sharing: What Stays Shared

Modules in `core/` are universal — every brand uses them. No exceptions in v1.

Brand-specific modules do not get cross-brand reuse. If two brands have similar concepts (Fidelon and Castor Abbott both have a "voice tone" module), they're different files. This is deliberate: brand voice is the most precious asset on the platform, and cross-brand copying creates drift, dilution, and accidental homogenization.

The exception: if Mark himself is the persona for multiple brands (which is possible for Castor Abbott and Cortex given audience overlap), the personal-context module could potentially be shared. This decision is deferred to when Cortex onboards in Phase 5. Until then, assume brand isolation.

## Open Decisions for the Dev Team

- **Specific markdown parser:** `gray-matter` for frontmatter parsing is the de facto standard. Acceptable.
- **Module body format beyond markdown:** Not expanding scope. Markdown only.
- **Whether to support module-level conditional logic** (e.g., "include this paragraph only when content_type is 'rant'"): Not in v1. If a module needs conditional content, split it into two modules.
- **Whether voice modules are git-only or also database-stored:** Git-only as canonical. The registry table is a derived view, not the source.
- **Whether the review UI can edit modules directly:** Not in v1. Module changes go through PRs. Editing through a UI introduces governance complications without clear benefit at this scale.

## Acceptance Criteria

The voice system is complete when:

- [ ] `packages/voice-modules/` exists with the directory structure documented above.
- [ ] All Castor Abbott modules listed in this spec exist as `.md` files with valid frontmatter and meaningful content ported from the existing system prompts.
- [ ] The composer (`composeVoice`) is implemented, tested, and used by at least one block.
- [ ] The CI registry sync job updates `voice_module_registry` from the file tree on every deploy and fails the build on malformed frontmatter.
- [ ] A PR template for voice module changes exists in `.github/PULL_REQUEST_TEMPLATE/voice-module.md` with checklist (version bumped if substantive, description accurate, status correct).
- [ ] An ADR documents the decision to use markdown + frontmatter rather than (e.g.) JSON or YAML.
- [ ] At least one prompt regression test exists that loads a known module composition and snapshots the output system prompt.
- [ ] Castor Abbott's `brand_voice_configs` row is populated with the v1 module list.

---

**Next:** Read `04_content_pipeline.spec.md` for the block specifications, orchestration logic, and weekday + weekend pipeline definitions.
