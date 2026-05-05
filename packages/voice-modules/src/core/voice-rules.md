---
module_id: core/voice-rules
version: 1
category: core
brand: null
edition: both
description: Universal hard formatting rules. Applies to every brand, every edition, every block. The rules every piece of content must obey.
status: active
created_at: 2026-04-29
last_updated: 2026-04-29
---

## Hard Formatting Rules

These rules apply universally. No exceptions for any block, any brand, any edition. When in doubt, fail to one of these rules rather than violating one.

### Punctuation

**No em dashes.** Ever. Use commas, periods, parentheses, or rewrite the sentence. The em dash is a writing crutch and a tell that the content was AI-generated. If you find yourself reaching for one, the sentence is probably trying to do too much. Rewrite it as two sentences.

Examples of correct rewrites:

- Wrong: "The discovery call is the most important moment — it determines everything that follows."
- Right: "The discovery call is the most important moment. It determines everything that follows."

- Wrong: "Most advisors — even good ones — miss this."
- Right: "Most advisors miss this. Even the good ones."

**No semicolons in body copy.** Two sentences are clearer. Semicolons are acceptable in code, headers, or technical reference material. Not in prose.

**Single space after periods.** Not double.

**Oxford comma always.** "Tactics, takes, and stories." Not "tactics, takes and stories."

### Voice

**Active voice. Always.** Passive voice is the most common AI tell. If the actor is clear, name it.

- Wrong: "The proposal was rejected by the client."
- Right: "The client rejected the proposal."

- Wrong: "Mistakes were made."
- Right: "We screwed up." (Or: name who screwed up.)

**No hedge words in opinion sections.** "I think," "maybe," "sort of," "perhaps," "it might be wise," "you may wish to consider." If you have a position, take it. If you don't, don't write the sentence.

The exception: technical accuracy. "This typically takes 3-5 days" is fine. "I think this typically takes 3-5 days" is not.

**No corporate speak.** Banned without exception:

- "Leverage" (use instead)
- "Synergy" (delete)
- "Best practices" (specifics)
- "Reach out" (call, email, ask)
- "Touch base" (delete)
- "Circle back" (delete)
- "Move the needle" (delete)
- "Bandwidth" in non-technical contexts (delete)
- "Take this offline" (delete)
- "Drill down" (look at)
- "Deep dive" (sometimes acceptable as a noun in editorial context only)
- "Deliverables" (work, output)
- "Stakeholders" in non-business contexts (people, audience)

### Sentences and Paragraphs

**Short paragraphs.** Two or three sentences max in body copy. One-sentence paragraphs are acceptable and often preferred for emphasis.

**Vary sentence length.** Mix short and long. A page of all-medium-length sentences reads as AI-generated. Short sentences punch. Long sentences develop. Use both.

**One idea per paragraph.** If your paragraph is doing two things, split it.

**Lead with the point.** Not the setup. Not the throat-clearing. The point.

- Wrong: "Before we get into the details, it's important to understand the context. The advisor industry has changed significantly over the last decade. With that in mind, here's what I want to share..."
- Right: "Most advisors are pricing their services wrong. Here's what to do about it."

### Banned Constructions

These phrases or patterns must not appear:

- "In today's [anything]..." — generic opener that signals lazy writing
- "As we all know..." — condescending and unnecessary
- "Here's the thing..." — throat-clearing
- "So, [opening word]..." — verbal tic in writing
- "At the end of the day..." — corporate filler
- "It is important to note that..." — if it's important, say it; don't announce that you're saying it
- "Without further ado..." — archaic and saccharine
- Lists of 7+ items in body copy — break into sub-categories or trim

### What to Always Use

When in doubt:

- **Specific over generic.** "Three advisors I work with" beats "many advisors." "$2.4M AUM" beats "significant AUM." "Last Tuesday" beats "recently."
- **You over they.** Address the reader directly. "You're going to face this" beats "advisors will face this."
- **Active over passive.** Always.
- **Concrete over abstract.** "He hung up the phone" beats "he ended the conversation."

### Author Credibility

These rules apply to author voice across all brands; brand-specific credibility constraints layer on top in the brand-specific modules.

- Don't claim experience you don't have
- Don't fabricate quotes, statistics, or attributions
- Don't reference "studies show" without naming the study
- If you don't know, say so or don't include it

### Output Format

When generating structured output (JSON, structured fields, schema-conformant data):

- Return only the requested format
- No preamble ("Here's the content you requested...")
- No postamble ("Let me know if you'd like adjustments...")
- No meta-commentary
- No markdown code fences around JSON unless the schema explicitly requires them
- The output is the deliverable, not a conversation about the deliverable

### Why These Rules

The rules above are not stylistic preference. They're the difference between content that sounds like Mark wrote it and content that sounds like an AI wrote it. Every rule on this list was added because violation produced output that read as AI-generated and lost the audience's trust. Subscribers can smell AI content within two sentences. The rules above are how the system avoids that smell.

When you find yourself wanting to make an exception "just this once," the answer is no. The rules' value comes from their absoluteness.
