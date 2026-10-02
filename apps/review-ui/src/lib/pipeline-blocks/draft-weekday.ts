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
   * 50+ combinations across the week. Drives the Main Content + This First Pull
   * structure. Optional for back-compat; defaults to deep_dive.
   */
  formatStyle?: FormatStyle;
  /**
   * The "feel" of this specific issue. Rotated across diagnostic / affirming /
   * instructive / reflective so the reader isn't on a diagnostic streak. The
   * writer must honor this register — if affirming, no "stop pretending" or
   * "you're doing it wrong" framing; if instructive, teach without implying
   * the reader has been failing; if reflective, question-oriented rather than
   * procedure-oriented.
   */
  tonalRegister?: "diagnostic" | "affirming" | "instructive" | "reflective";
  /**
   * Worth Knowing items from the last N prior issues (headline + URL).
   * Two-axis dedup: writer must skip any research item whose URL matches
   * anything on this list (catches JD Power press release rehashes with
   * different framings) OR whose headline is substantively the same
   * story (catches URL drift on the same underlying source). Fed from
   * loadRecentWorthKnowingItems. Back-compat: if only `headline` fields
   * are supplied, URL check is skipped but headline check still runs.
   */
  recentWorthKnowingHeadlines?: Array<{ issueDate: string; headline: string; url?: string }>;
};

/**
 * Format-style structural treatments (spec 04:451-458). These modulate HOW the
 * Main Content and First Pull are delivered, on top of the content-type rules.
 * The fixed sections (Opening Trifecta, Worth Knowing, Ancient Truth) are
 * unchanged; the format style reshapes the body's reading experience.
 */
function tonalRegisterRules(
  register: "diagnostic" | "affirming" | "instructive" | "reflective",
): string {
  switch (register) {
    case "diagnostic":
      return `**Tonal register: DIAGNOSTIC.** Name a gap, show its mechanism, deliver the fix. The default advisor-newsletter mode. Still Mark's voice — sharp, specific, no scolding — but the issue is organized around a problem the reader is probably experiencing.`;
    case "affirming":
      return `**Tonal register: AFFIRMING.** This issue CELEBRATES a pattern that works. The reader finishes feeling they're on the right track (or that someone they respect is), and gets to see WHY the pattern wins. No pathologizing the status quo. No "most advisors get this wrong" framing. Pick an advisor-practice behavior that genuinely works — a specific habit, a specific framing, a specific small discipline — and show it in action. The reader should feel seen for what they already do well, not corrected for what they do wrong. Example headlines in this register: "The 10-minute habit that quietly compounds," "Why the advisors who ask the dumb question keep more clients," "What steady beats clever at (and why it's underrated)."`;
    case "instructive":
      return `**Tonal register: INSTRUCTIVE.** Teach a specific skill or practice without the problem framing. The reader comes away with something they can USE, not a reminder of what they should fix. Think "here's how this works" rather than "here's what you're doing wrong." Perfectly fine for the content to be new to many readers; just don't pathologize the ones who didn't already know. The implicit stance is "here's a tool, take it," not "you're broken, fix yourself."`;
    case "reflective":
      return `**Tonal register: REFLECTIVE.** Step back from tactics. A question worth sitting with. The issue surfaces a tension or a perspective rather than prescribing a move. May end on a question, not a directive. Does NOT need a howTo callout in the usual sense — if it has one, it's a prompt-set the reader can carry into their week ("Three questions I'd sit with this week:"). The reader is a 20-year veteran; sometimes they need a prompt, not a procedure.`;
  }
}

function formatStyleRules(formatStyle: FormatStyle): string {
  switch (formatStyle) {
    case "deep_dive":
      return `**Format: DEEP DIVE.** One idea, taken all the way down. The opposite of a checklist.
- howTo.steps: EXACTLY 2-3 steps. Each body is LONG — 4-6 sentences that explain the mechanism, the why, the edge cases. If you find yourself writing a 5th step, you're going broad; collapse back into fewer, deeper moves.
- howTo.title: something like "How it actually works:" or "The mechanism:" — not "How to run it:".
- intro: 2-3 full paragraphs developing the single idea before any steps.
- The reader finishes understanding ONE thing deeply, not five things shallowly.`;

    case "quick_hits":
      return `**Format: QUICK HITS.** A scannable checklist. The opposite of an essay.
- howTo.steps: EXACTLY 6-8 steps. Each body is ONE punchy sentence (under ~20 words). Label is an imperative verb phrase. No step body runs more than one sentence.
- howTo.title: something like "The checklist:" or "Run through these:".
- intro: ONE short paragraph (2-3 sentences) max, then straight into the list.
- closing: one line. Skimmable throughout — a reader should get the whole thing in 30 seconds.`;

    case "contrarian":
      return `**Format: CONTRARIAN.** An argument that overturns a belief. Not a how-to at all.
- howTo.steps: EXACTLY 3 steps, but each is a CONTRAST, not an instruction. Label = the common belief (e.g. "Belief: more meetings = better retention"). Body = why it backfires, then the replacement move.
- howTo.title: "Three beliefs to drop:" or "Where the conventional wisdom breaks:".
- intro: steelman the conventional approach first — state it fairly, as if you might agree — THEN turn.
- The reader should feel a belief get dismantled, not receive a procedure.`;

    case "story":
      return `**Format: STORY.** A REAL story, not a thesis in prose. The user feedback that triggered this rewrite: "it's more like when someone has a beat behind them and they are just talking. talking in third person. there is no intrigue." Fix that.

**Required voice: FIRST PERSON — Mark narrating a scene.** Not third-person "the advisor." Open with "I was on a call last week with a friend of mine," or "A guy I've known for years called about something," or "Jim called me on a Tuesday — he's run his practice for eighteen years, forty-two clients, mostly surgeons." Named characters, specific details, Mark's actual voice as a witness or interlocutor. NEVER "the advisor saw..." or "the advisor realized..." — that's third-person documentary distance.

**Required structure (classic narrative):**
1. **Setup / mid-scene open.** Drop the reader into the middle of a moment: a phone call, a text, a conversation at a conference bar. Name the character ("Jim," "a friend I'll call David"). Give one visual anchor — the number on his screen, the way he said it, the pause before he answered.
2. **The turn.** Something happens or gets said that makes everything shift. A client sentence Jim misread. A number he realized he'd been missing. The thing he thought was fine wasn't. Use DIALOGUE where it fits — put the client's actual words in quotes, put Jim's reaction in quotes. "He said, 'I just wanted to think about this for a while.' Jim told me later he almost missed it."
3. **The payoff — what Mark took away.** Not "the lesson for advisors is..." but "what I took away from that call was..." or "the thing I keep coming back to is...". The lesson rides inside Mark's reflection, not stapled on.

**howTo.steps: EXACTLY 2 entries.** They are story BEATS, not procedure steps. Each label names a moment ("The call" / "The pause"); each body is 3-5 sentences continuing the narration in Mark's voice. NEVER "do this" / "first/next/then" / numbered instructions. If you write a procedure, you've broken the format.

**howTo.title**: "What happened" / "The turn" / "How it played out". Never "How to:" / "Steps:" / "The checklist:".

**mainContent.intro**: open mid-scene with a NAMED character and Mark as narrator. No thesis sentence first. The reader meets a person doing a thing, not an argument.

**mainContent.closing**: Mark's own reflection on what the scene taught him. First person. Return to the character — where they are now, what they changed. The reader remembers Jim; the lesson rides along.

**Hallmarks of success**: a reader could retell this story to someone else over coffee. There's a protagonist with a name. There's a moment of discovery. There's at least one quoted line. There's a stake. There's a turn. If you can't find those, you're writing a thesis in past tense, not a story — rewrite.`;

    case "data":
      return `**Format: DATA.** Evidence-forward. Numbers lead and carry every claim.
- howTo.steps: 4-5 steps, and EVERY step body LEADS with a specific figure/percentage/dollar amount from research (e.g. "Start with the 31% figure: ..."). Set the step's stat fields where the schema allows. No step without a number.
- howTo.title: "By the numbers:" or "What the data says to do:".
- intro: open on the single most striking figure from research, fully unpacked (not a stat dump — one number, explained).
- The reader leaves with 4-5 hard numbers they can quote.`;

    default:
      return `**Format: DEEP DIVE.** 2-3 deep steps on one idea.`;
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

  // Recent Worth Knowing headlines — the writer picks 3 items for the
  // WK section from the research bundle. Without this constraint the
  // model keeps picking the current biggest story (Vanguard/Altruist
  // ran 5 issues in a row). Do not treat this as advice; treat it as
  // a hard filter.
  const recentWK = input.recentWorthKnowingHeadlines ?? [];
  if (recentWK.length > 0) {
    const bannedUrls = new Set(recentWK.map((h) => h.url ?? "").filter(Boolean));
    const bannedUrlList = Array.from(bannedUrls).sort();
    sections.push(
      formatSection(
        "Recent Worth Knowing — DO NOT REPEAT",
        `Every WK item you select must pass BOTH checks:

**Check 1 — URL match (hard fail).** If a research item's URL is on the URL list below, DO NOT pick it. This is the JD Power press release problem — the same underlying source keeps getting re-cited with different headlines. If the URL matches, the story is a rehash by definition, even if the framing is fresh.

**Check 2 — Story match (fuzzy fail).** Even when the URL differs, if a research item covers the SAME underlying event (same acquisition, same regulatory action, same survey, same statistic) as a headline below, it's a rehash. Pick the other item.

**Banned URLs (already cited in the last ${recentWK.length} WK slots):**
${bannedUrlList.length > 0 ? bannedUrlList.map((u) => `- ${u}`).join("\n") : "- (none)"}

**Recent WK headlines (avoid the same story regardless of source):**
${recentWK.map((h) => `- [${h.issueDate}] ${h.headline}`).join("\n")}

Rehashing WK is the fastest way to make the reader feel this newsletter is on autopilot. Skip it even when it's the "biggest" story — the reader already saw it here.`,
      ),
    );
  }

  // Per-content-type structure
  sections.push(
    formatSection(
      "Main Content Structure for This Content Type",
      contentTypeStructureRules(input.approvedTopic.contentType),
    ),
  );

  // Tonal register — the "feel" layer. Rotates so the newsletter doesn't
  // land as 7 consecutive problem-and-fix emails.
  if (input.tonalRegister) {
    sections.push(
      formatSection(
        `Tonal Register: ${input.tonalRegister.toUpperCase()} — this governs feel`,
        tonalRegisterRules(input.tonalRegister),
      ),
    );
  }

  // Format style — the "how" layer on top of the content-type "what" layer.
  // The same content type must read very differently across the 5 styles.
  sections.push(
    formatSection(
      `Format Style: ${(input.formatStyle ?? "deep_dive").toUpperCase()} — this governs structure`,
      `${formatStyleRules(input.formatStyle ?? "deep_dive")}

**PRECEDENCE:** When this format style's step count or shape conflicts with the content-type structure above, THE FORMAT STYLE WINS. The content type governs the substance and voice (what a Tactic/Take/Story argues); the format style governs the SHAPE (how many steps, how long, list vs narrative vs argument). Follow the exact step count stated here, not any count implied by the content-type section.

The Opening Trifecta, Worth Knowing, and Ancient Truth keep their standard structure regardless of format style.`,
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
