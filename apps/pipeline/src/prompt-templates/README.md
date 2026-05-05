# Prompt Templates

This directory contains the typed user-prompt builders for every block in the content pipeline. Each file exports a function that takes block-specific input and produces the user message the LLM receives.

## Architecture Context

Each pipeline block has two LLM-input layers:

1. **System prompt** — composed at runtime from voice modules (`voice-modules/` directory) by the brand voice loader. The system prompt is brand-level and edition-level; it doesn't change between runs of the same block for the same brand.
2. **User prompt** — composed by the typed template in this directory. The user prompt is run-specific. It carries the block's specific input (research data, draft text, persona being evaluated, etc.).

The split matters because:

- **System prompt benefits from prompt caching.** Voice modules are large and stable; they're cached by the LLM provider. User prompts are dynamic and not cached. Putting voice modules in the system prompt and run-specific data in the user prompt is what makes the cost economics work at scale.
- **Voice modules are content; prompt templates are code.** Voice modules can be edited by editorial; prompt templates require dev review. The split protects the boundary.
- **Run-specific data has typed shape.** The TypeScript types in this directory enforce input shape. Voice modules are unstructured markdown.

## File Convention

Each file in `blocks/` exports:

```typescript
export type BlockNameInput = { ... };           // typed input shape
export function buildBlockNamePrompt(input: BlockNameInput): string;  // user message builder
```

The function is pure — same input always produces same output. No I/O, no LLM calls, no async. The function builds a string from the input.

## Voice Module Loading

The brand voice loader (defined in spec 03) handles system-prompt composition. The prompt template functions in this directory do NOT load voice modules. They produce user messages only.

When a block runs:

1. Brand voice loader resolves `brand_id + edition + block_name` → list of voice modules
2. Voice modules concatenated into system prompt with caching markers
3. Prompt template called with run-specific input → user message
4. Both passed to the LLM call

## Block Naming

Block names mirror the architecture spec's pipeline structure:

- `research_*` — research blocks (one per edition × content type combination, plus shared)
- `topic_proposer` — selects content type and topic for an issue
- `concept_check` — validates against framework_concepts and content_concepts
- `draft_*` — writer blocks (weekday and weekend)
- `style_pass` — applies style guide constraints to draft
- `editor_pass` — editorial review and revision
- `persona_evaluate` — single persona's response simulation (called 10 times in parallel)
- `score_aggregate` — combines persona evaluations into pass/fail decision
- `fact_check` — verifies factual claims against research source
- `assemble_html` — renders final HTML for email send

The full list is in this directory's `blocks/` subfolder. Some blocks are shared across editions; some are edition-specific.

## Shared Helpers

`_shared/` contains helpers used by multiple block templates:

- `formatters.ts` — common text formatting (lists, sections, etc.)
- `template_helpers.ts` — reusable template fragments

## Type Conventions

Types are defined in each block's file. They're not exported to a central types directory because:

- Each block's input is specific to that block
- Centralizing creates coupling that makes block evolution harder
- The brand voice loader and pipeline orchestrator each have their own types defined elsewhere (see spec 02 data model and spec 04 pipeline)

When a type is genuinely shared (e.g. the shape of a research result), it's defined in a single block's file and imported by others. The convention is to define the shape in the block that produces it and import where consumed.
