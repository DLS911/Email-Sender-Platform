/**
 * Draft Weekday Block — adapted from
 * /apps/pipeline/src/prompt-templates/blocks/draft_weekday.ts
 *
 * Spec'd writer prompt. Takes the topic_proposer output + structured research
 * and produces the issue draft. Key elements adopted from the spec:
 * - Per-content-type section structure baked into the prompt
 * - Explicit production rules (anti-patterns, specifics-over-generalities)
 * - Author-credibility constraint (Mark is not a practicing advisor)
 * - draftNotes field for editor flags
 *
 * One adaptation vs the spec: the output schema preserves my richer
 * DailyGrindContent shape (Opening Trifecta + First Pull + Worth Knowing +
 * Main Content with howTo + Grounds for Thought + Ancient Truth + P.S.)
 * because that matches the published archive (lobster lunch, niche trap, etc.)
 * — the spec'd simpler shape (greeting + mainSection + signoff) doesn't.
 *
 * The CANONICAL_EXAMPLES few-shot block + voice review/sharpen pass run
 * AFTER this prompt — those layers stay on top.
 */

import { CANONICAL_EXAMPLES } from "../daily-grind-voice-prompt";
import type { StructuredResearchOutput } from "./research-weekday";

export type FormatStyle = "deep_dive" | "quick_hits" | "contrarian" | "story" | "data";

export type DraftWeekdayInput = {
  issueDate: string;
  approvedTopic: {
    contentType: string;
    topic: string;
    angle: string;
    frameworkReferences: string[];
  };
  structuredResearch: StructuredResearchOutput;
  /**
   * The "how" layer (spec 04:451-458) that pairs with the content type "what"
   * layer. The SAME content type reads very differently across these five —
   * 50+ combinations across the week. Drives the Main Content + First Pull
   * structure. Optional for back-compat; defaults to deep_dive.
   */
  formatStyle?: FormatStyle;
};

/**
 * Format-style structural treatments (spec 04:451-458). These modulate HOW the
 * Main Content and First Pull are delivered, on top of the content-type rules.
 * The fixed sections (Opening Trifecta, Worth Knowing, Ancient Truth) are
 * unchanged; the format style reshapes the body's reading experience.
 */
function formatStyleRules(formatStyle: FormatStyle): string {
  switch (formatStyle) {
    case "deep_dive":
      return `**Format: DEEP DIVE.** One idea, explored thoroughly. Go deep on a single move rather than broad across many.
- First Pull: develop the argument in full — narrative or named-convention setup, then the reframe, with room to breathe.
- Main Content: 3-4 howTo steps, each with real depth (label + 2-4 sentence body that explains the mechanism, not just the action). The reader should finish understanding WHY, not just WHAT.
- Longer body (250-350 words). Fewer points, more thoroughly earned.`;

    case "quick_hits":
      return `**Format: QUICK HITS.** Scannable, rapid-fire, high-density. Built to be skimmed and acted on fast.
- First Pull: short and punchy. Land the frame in 2-3 tight paragraphs, no long windup.
- Main Content: 5-7 howTo steps, each SHORT (label + 1-2 sentence body). Each step is its own self-contained move. Think checklist energy, not essay.
- Shorter overall. Every line earns its place. No connective filler between points.`;

    case "contrarian":
      return `**Format: CONTRARIAN.** Lead by stating the conventional approach as if you might endorse it, then dismantle it.
- First Pull: name what "everyone does" specifically and fairly (steelman it), then turn — show why it quietly fails.
- Main Content: structure each howTo step as a correction — "What most advisors do" → "Why it backfires" → "Do this instead." The body is the case against the default and the replacement.
- The energy is argument, not instruction. The reader should feel a belief get overturned.`;

    case "story":
      return `**Format: STORY.** Narrative-driven. The lesson emerges from a scene, it is not stated up front.
- First Pull: open mid-scene with a specific (anonymized) advisor and a concrete moment — a meeting, a call, a decision. No thesis statement first; drop the reader into the story.
- Main Content: the howTo steps are the beats of what the advisor did (or should have done), told as the arc continues. Extract the transferable move from the narrative rather than abstracting away from it.
- Closing returns to the scene or its aftermath. The reader remembers the person, and the lesson rides along.`;

    case "data":
      return `**Format: DATA.** Evidence-forward. The numbers lead and carry the argument.
- First Pull: open on the most striking figure from research and what it actually means (not a stat dump — one number, fully unpacked).
- Main Content: anchor EVERY howTo step to a specific figure, percentage, or dollar amount from the research. Use the stat fields heavily. The structure is claim → number → implication, repeated.
- The reader should leave with 3-4 hard numbers they can quote. No vibes-based assertions where a figure exists.`;

    default:
      return `**Format: DEEP DIVE.** One idea explored thoroughly; 3-4 substantive howTo steps.`;
  }
}

function formatSection(label: string, body: string): string {
  return `## ${label}\n\n${body.trim()}`;
}

function wrapInTag(tag: string, content: string): string {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

/**
 * Content-type-specific structural rules — direct from the spec'd draft_weekday.
 * These describe HOW each type lays out the Main Content section.
 */
function contentTypeStructureRules(contentType: string): string {
  switch (contentType) {
    case "tactic":
      return `**Tactic structure (Main Content body ~150-300 words):**
1. Hook: position the gap or counter-intuitive observation
2. Diagnosis: 2-3 sentences naming the failure mode this tactic addresses
3. The Tactic itself: specific language, sequencing, timing — verbatim scripts where research provides them
4. Why-this-works: ties to framework (Trust Stacking, Physician Model, GAP, etc.)
5. Close: directive, no hedge

For the howTo callout: 3-4 steps, each with label + body (the actual step language).`;

    case "take":
      return `**Take structure (Main Content body ~200-350 words):**
1. Setup: state the conventional wisdom fairly, not as a strawman
2. Flip: the contrarian position, no hedging
3. Mechanism: 3-5 paragraphs naming WHY the contrarian view holds — assumptions, failure modes, pattern recognition
4. Alternative: paint the shape of the right approach
5. Close: lands hard

The main content is reasoned argument prose, NOT a procedural list. Use the howTo callout as a "What this looks like in practice" or "Three signals you're caught in the conventional wisdom" — not implementation steps.`;

    case "story":
      return `**Story structure (Main Content body ~250-400 words):**
1. Setup: specific anonymized advisor in a specific situation (location, practice stage, family, context)
2. Choice point: the moment of tension that could have gone either way
3. Decision and consequences: what was decided, immediate and downstream effects with texture
4. Close: implicit. Don't announce the moral.

The howTo callout can be optional or "What this story teaches" — but the story arc carries the issue, not bulleted lessons.`;

    case "rant":
      return `**Rant structure (Main Content body ~400-600 words):**
1. Opening punch: hard position, no setup
2. Anatomy: the math, the mechanism, who profits/who pays — with real numbers and named entities
3. Cover-story dissection: the industry narratives that justify the practice, dismantled
4. Implication and alternative: what does this mean for the reader, what's the alternative
5. Close: commits without softening

The howTo callout can be "The math behind the harm" — make the anatomy explicit.`;

    case "special":
      return `**Special structure (Main Content body ~500-800 words):**
1. Framing: why this matters to the reader right now
2. Technical anatomy: the actual rules, mechanisms, numbers, failure modes
3. Decision framework: how should the reader think through it
4. Implementation guidance: steps, timelines, specific avoidances
5. Boundaries: what this doesn't cover, where expertise needed
6. Close: quieter landing

The howTo callout: 3-4 steps from the implementation section.`;

    default:
      return `**Default structure (Main Content body ~200-400 words):**
Follow the structure that fits the topic. The howTo callout has 3-4 steps if procedural, otherwise a structured framework callout.`;
  }
}

export function buildDraftWeekdayPrompt(input: DraftWeekdayInput): string {
  const sections: string[] = [];

  sections.push(
    `You are drafting the Daily Grind weekday issue dated ${input.issueDate}. This is the primary writer block — your output is the substantive content. Voice review and Haiku-based sharpen passes run AFTER you, so produce your best draft, knowing minor polish happens downstream.`,
  );

  // Topic
  sections.push(
    formatSection(
      "Approved Topic",
      `Content type: ${input.approvedTopic.contentType}
Topic: ${input.approvedTopic.topic}
Angle: ${input.approvedTopic.angle}
Framework references: ${input.approvedTopic.frameworkReferences.join(", ") || "none specified"}`,
    ),
  );

  // Structured research (the full payload — primaryFindings, frameworkAlignments,
  // scriptsOrLanguage, worthKnowingItems, proverbCandidates, researchNotes)
  sections.push(
    formatSection(
      "Research Output",
      wrapInTag("research_data", JSON.stringify(input.structuredResearch, null, 2)),
    ),
  );

  // Per-content-type structure
  sections.push(
    formatSection(
      "Main Content Structure for This Content Type",
      contentTypeStructureRules(input.approvedTopic.contentType),
    ),
  );

  // Format style — the "how" layer on top of the content-type "what" layer.
  // The same content type must read very differently across the 5 styles.
  sections.push(
    formatSection(
      `Format Style: ${(input.formatStyle ?? "deep_dive").toUpperCase()}`,
      `${formatStyleRules(input.formatStyle ?? "deep_dive")}

This format style governs the SHAPE of First Pull and Main Content. Apply it on top of the content-type structure above — they combine. The Opening Trifecta, Worth Knowing, and Ancient Truth keep their standard structure regardless of format style.`,
    ),
  );

  // Production rules from the spec
  sections.push(
    formatSection(
      "Production Rules",
      `**Voice rules:**
- Direct, opinionated, confident. No hedging.
- No em dashes. Use periods, commas, parentheses, or restructure.
- Match the rhythm of the content type — staccato for Tactics/Takes/Rants, more developed for Stories/Specials.
- Apply the contrarian positions and frameworks where they genuinely fit. Don't force.
- Sentence-level variation. Don't lean on the same sentence pattern within a section.

**Anti-patterns (do NOT use):**
- "Of course your situation may vary" / "your mileage may vary" hedges
- "Consider whether" softening
- Corporate-speak: leverage, synergy, circle back, touch base, reach out, bandwidth
- Hustle-culture: crush it, level up, 10x, game-changer, disrupt
- AI vocabulary: crucial, robust, comprehensive, delve, nuanced, "let's dive into"
- Motivational filler ("you've got this!")

**Specifics over generalities (ALWAYS):**
- Real names from research (cite via sourceUrl, never invent)
- Real numbers (don't round so the specificity vanishes — "$847" not "around $800")
- Specific situations, not generic descriptions
- Named scenes, exact dollar amounts, named scenarios

**Author-credibility constraint (load-bearing):**
Mark is NOT a practicing financial advisor. The voice references "the advisors I work with" and "I've watched advisors do X." It does NOT claim first-person practitioner experience.
- ✓ "I've watched advisors burn through prospects this way"
- ✓ "The advisors I work with who land big clients all do one thing"
- ✗ "When I run discovery calls"
- ✗ "In my client meetings"
- ✗ "My clients tell me"`,
    ),
  );

  // Canonical few-shot examples for each section (from the published archive)
  sections.push(
    formatSection(
      "The Unspoken — write at this caliber (READ THE ARCHITECTURE CAREFULLY)",
      `Two real published Unspokens. The architecture is not "scene anchor + dollar punchline." Look at what they ACTUALLY do:

Example 1 (${CANONICAL_EXAMPLES.unspoken[0]!.theme}):
"${CANONICAL_EXAMPLES.unspoken[0]!.text}"

Example 2 (${CANONICAL_EXAMPLES.unspoken[1]!.theme}):
"${CANONICAL_EXAMPLES.unspoken[1]!.text}"

## THE UNSPOKEN ARCHITECTURE (study before writing)

1. **One sentence of strategy or situation.** "You have a 'centers of influence' strategy." / "You have a client who calls you about every market headline." That's the SETUP.

2. **Drop into ONE specific moment.** Not a timeline. Not "then you did X, then Y, then Z." Pick ONE specific instance and stay in it.
   - Example 1 picks ONE lunch ("you took one to lunch in 2022")
   - Example 2 picks ONE recurring habit ("every market headline → phone rings")

3. **Build physical/character texture INSIDE that moment.** A human DOING something, not a state of affairs.
   - Example 1: "they ordered the lobster," "make aggressive eye contact and pretend to take a phone call"
   - Example 2: "you've rehearsed the speech," "your spouse has heard it. Your kids have heard it. The dog has heard it."

4. **One line of absurd or comic specificity that's quotable out of context.**
   - Example 1: "Their contact is still in your CRM tagged 'HOT COI'"
   - Example 2: "(The dog seems unconvinced about your long-term equity allocation.)"

5. **Dollar/cost punchline tied to the moment.**
   - Example 1: "That lunch cost you $187 and exactly zero referrals."
   - Example 2: (implicit cost via the screening/rehearsing time)

## WHAT THE UNSPOKEN IS NOT

- NOT a timeline of business events (then you hired three advisors, then you launched a podcast, then you changed your fee structure...)
- NOT an analysis of state-of-affairs (your compliance program describes the firm that existed eighteen months ago...)
- NOT institutional artifacts inventory (page four says X, page nine describes Y...)
- NOT an abstract metaphor stuck on a timeline (you're reading about a ghost firm)

If you find yourself writing "Then you did X. Then you did Y. Then you did Z." — STOP. That's a timeline, not an Unspoken. Restart with a SINGLE specific moment.

## STRUCTURAL CHECK BEFORE YOU FINALIZE

Read your Unspoken back. Ask:
- Is there a HUMAN DOING something physical? (ordering, screening, eye contact, conversation)
- Is there ONE specific moment I'm in, not a sequence of business events?
- Is there a quotable line that could survive being read alone?
- Does it make a reader LAUGH while WINCING?

If any answer is no, rewrite. 80-130 words. Single italic paragraph.`,
    ),
  );

  sections.push(
    formatSection(
      "First Pull — match this caliber",
      `Real First Pull opening paragraphs. Each opens with narrative tension or named conventional wisdom about to be flipped. NEITHER opens with a stat dump.

Example 1: "${CANONICAL_EXAMPLES.firstPullOpener[0]!.text}"

Example 2: "${CANONICAL_EXAMPLES.firstPullOpener[1]!.text}"

Your First Pull should ARGUE or NARRATE, not summarize.`,
    ),
  );

  sections.push(
    formatSection(
      "The Number — MUST cite a source (hard rule)",
      `The Number's stat is a factual claim. It MUST carry a real source. Set theNumber.sourceUrl to the EXACT url (verbatim) of the research item that backs the stat, and theNumber.sourceName to that publisher. Do NOT invent a URL. Do NOT leave it blank. If you can't tie the stat to a specific research URL, pick a different stat from primaryFindings that you CAN source. An unsourced Number will be rejected.`,
    ),
  );

  sections.push(
    formatSection(
      "The Flip Reality — 12-20 words max",
      `Compressed reframes, not analytical explanations:
${CANONICAL_EXAMPLES.flipReality.map((f) => `- "${f}"`).join("\n")}

If yours runs over 25 words, cut it.`,
    ),
  );

  sections.push(
    formatSection(
      "Worth Knowing myTake — judgment, not summary",
      `Don't summarize the article. REFRAME it as a position on what advisors are doing wrong or right:
${CANONICAL_EXAMPLES.myTake.map((m) => `- "${m}"`).join("\n")}

20-40 words. Name a specific failure mode or contrarian read.`,
    ),
  );

  sections.push(
    formatSection(
      "Ancient Truth — daily wisdom, NOT topical",
      `Pick ONE verse from the proverbCandidates in research. Then write a 2-3 sentence application that **explains the verse's plain general wisdom** — what it teaches about living, working, or character. **Do NOT force a connection to today's email topic.** The Ancient Truth is daily wisdom that stands on its own, not a reframe of the email's argument.

Example 1:
Verse: "${CANONICAL_EXAMPLES.ancientTruthApplication[0]!.verse}"
Application: "${CANONICAL_EXAMPLES.ancientTruthApplication[0]!.application}"

Example 2:
Verse: "${CANONICAL_EXAMPLES.ancientTruthApplication[1]!.verse}"
Application: "${CANONICAL_EXAMPLES.ancientTruthApplication[1]!.application}"

Notice: the applications explain what the VERSE teaches — they do NOT say "this is why you should [do today's tactic]." Voice is direct, not preachy. No "as believers" or "trust in His plan." Just plain wisdom.`,
    ),
  );

  sections.push(
    formatSection(
      "Closing landings — no hedge, no apology",
      `Real Mark closings:
${CANONICAL_EXAMPLES.closingLandings.map((c) => `- "${c}"`).join("\n")}

The Main Content closing must NOT restate The Number paragraph. Land somewhere new.`,
    ),
  );

  // The output schema (matches my DailyGrindContent for HTML template compat)
  sections.push(
    formatSection(
      "Output Schema",
      `Return ONLY the JSON object below — no preamble, no fences:

{
  "headline": "<H1, 5-12 words, takes a position>",
  "preheader": "<60-110 chars for Gmail preview>",
  "contentType": "${input.approvedTopic.contentType}",
  "openingTrifecta": {
    "theNumber": { "stat": "<from research's primaryFindings>", "description": "<paragraph naming the gap behind the number>", "sourceUrl": "<REQUIRED: the EXACT url from a research item that backs this stat — must be a real research URL, verbatim>", "sourceName": "<REQUIRED: publisher name for that url>" },
    "theUnspoken": "<single italic narrative paragraph, 80-130 words, scene-anchored, dollar punchline>",
    "theFlip": { "conventional": "<conventional wisdom in quotes>", "reality": "<12-20 word reframe>" }
  },
  "firstPull": { "paragraphs": ["<H1 body para 1 — narrative or named-convention-wisdom>", "<para 2>", "<para 3>"] },
  "worthKnowing": [
    {
      "category": "<one of: Practice | Tech | Compliance | Regulation | Markets | Tax | M&A | Industry>",
      "headline": "<from research's worthKnowingItems>",
      "stat": "<from research>",
      "statLabel": "<6-12 word stat description>",
      "statColor": "green | red | gold",
      "sourceUrl": "<EXACT url from research's worthKnowingItems[i].url>",
      "sourceName": "<from research>",
      "publishedDate": "<optional>",
      "body": "<30-50 words, faithful to research summary>",
      "myTake": "<20-40 words, named failure mode or contrarian read>"
    },
    { ... },
    { ... }
  ],
  "mainContent": {
    "subhead": "<5-12 words, sub-heading>",
    "intro": "<1-2 paragraphs, 40-80 words>",
    "howTo": {
      "title": "<e.g. 'How to do it:' or 'The math:'>",
      "steps": [
        { "label": "<short step label>", "body": "<step content>" },
        { "label": "...", "body": "..." },
        { "label": "...", "body": "..." }
      ]
    },
    "closing": "<30-60 words, lands a position, doesn't restate The Number>"
  },
  "groundsForThought": "<single italic centered sentence, 12-30 words, non-obvious>",
  "ancientTruth": {
    "verse": "<verse text from research's proverbCandidates>",
    "reference": "<Book Chapter:Verse (Translation)>",
    "application": "<2-3 sentences, concrete metaphor + direct application>"
  },
  "ps": "<1-2 sentences. ONE specific question inviting reply>",
  "draftNotes": "<1-2 sentences for any choices the editor block should know about: alternatives considered, research thinness, etc.>"
}`,
    ),
  );

  return sections.join("\n\n");
}
