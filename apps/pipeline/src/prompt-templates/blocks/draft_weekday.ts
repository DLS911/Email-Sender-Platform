/**
 * Draft Weekday Block
 *
 * The primary writer block for Daily Grind weekday issues. Takes approved
 * topic + research output, produces a complete draft of all sections.
 *
 * The system prompt carries the brand voice (mark-persona, voice-tone,
 * trust-stacking, physician-model, gap-framework, three-torments,
 * offers-vs-proposals, contrarian-positions, language-guide, synthesis,
 * audience, author-credibility) plus the relevant content type module.
 *
 * The user prompt provides the specific topic, the research results, and
 * the section-by-section structure for this issue.
 */

import { formatSection, wrapInTag } from "../_shared/formatters";
import type { ProposedTopic } from "./concept_check";

export type WeekdayResearch = {
  primaryFindings: Array<{
    claim: string;
    supporting: string;
    source: string;
    relevanceToTopic: string;
  }>;
  frameworkAlignments: Array<{
    framework: string;
    specificConnection: string;
  }>;
  scriptsOrLanguage: string[];
  worthKnowingItems: Array<{
    headline: string;
    summary: string;
    stat?: string;
    source: string;
    relevance: string;
  }>;
  proverbCandidates: Array<{
    reference: string;
    text: string;
    applicationToTopic: string;
  }>;
  researchNotes: string;
};

export type DraftWeekdayInput = {
  brandId: string;
  issueDate: string;
  approvedTopic: ProposedTopic;
  research: WeekdayResearch;
  targetWordCount?: number; // override default for the content type
};

/**
 * Build the user prompt for the weekday draft block.
 */
export function buildDraftWeekdayPrompt(input: DraftWeekdayInput): string {
  const sections: string[] = [];

  sections.push(
    `You are drafting the Daily Grind weekday issue dated ${input.issueDate}. This is the primary writer block — your output is the substantive content that the editor block will refine and the style block will polish.`,
  );

  // Topic
  sections.push(
    formatSection(
      "Approved Topic",
      `Content type: ${input.approvedTopic.contentType}
Topic: ${input.approvedTopic.topic}
Angle: ${input.approvedTopic.angle}
Framework references: ${input.approvedTopic.frameworkReferences.join(", ")}`,
    ),
  );

  // Research
  sections.push(
    formatSection(
      "Research Output",
      wrapInTag("research_data", JSON.stringify(input.research, null, 2)),
    ),
  );

  // Section structure
  sections.push(
    formatSection(
      "Issue Structure (write each section in order)",
      `**Greeting (15-25 words).** Brief, in-voice opening that names the day or moment and sets up the issue's substance. Not "Welcome to The Daily Grind" — that's filler. Open IN the voice.

**Main Section (the Topic — body copy budget per content type module).** This is the substantive content. Follow the structure for the approved content type as documented in the system prompt's content type module:
- Tactic: hook, diagnosis, the tactic itself with specific language and sequencing, why-this-works, close (~150-300 words)
- Take: setup of conventional wisdom, contrarian flip, mechanism, alternative, close (~200-350 words)
- Story: setup, choice point, decision and consequences, implicit close (~250-400 words)
- Rant: opening punch, anatomy with math, cover-story dissection, implication and alternative, close (~400-600 words)
- Special: framing, technical anatomy, decision framework, implementation guidance, boundaries, close (~500-800 words)
- Ancient Truth: proverb, opening read, application to advisor practice, close (~300-450 words)

**Worth Knowing (3 items, ~120-180 words total).** Three news items relevant to financial advisors. Item 1 must include the stat or data point (used for visual element). Each item is 1-2 sentences of substance, not a list of headlines.

**Ancient Truth Daily (~80-120 words).** A single proverb (from the candidates in research) with a 2-3 sentence application to advisor practice. This is the brief daily version, not the full Ancient Truth content type. Keep it tight.

**Sign-off (15-30 words).** Brief, in-voice close. Could reference what's coming the next day, name a takeaway, or just close cleanly. No "Have a great day!" filler.`,
    ),
  );

  // Production rules
  sections.push(
    formatSection(
      "Production Rules",
      `**Voice rules (per the brand voice modules):**
- Direct, opinionated, confident. No hedging.
- No em dashes anywhere. Use periods, commas, parentheses, or restructure.
- Match the rhythm of the content type — staccato for Tactics/Takes/Rants, more developed for Stories/Specials/Ancient Truths.
- Apply the contrarian positions and frameworks where they genuinely fit. Don't force.
- Sentence-level variation. Don't lean on the same sentence pattern within a section.

**Anti-pattern check:**
- No "of course your situation may vary" hedges
- No "consider whether" softening
- No corporate-speak ("leverage," "synergy," "circle back")
- No hustle-culture vocabulary ("crush it," "level up," "10x")
- No motivational filler

**Specifics over generalities:**
- Real names where they appear in research (cite via reference, never inventing them)
- Real numbers where they exist (don't round so much that the specificity vanishes)
- Specific situations rather than generic descriptions

**The author-credibility module's constraint applies:**
Mark is NOT a practicing financial advisor. The voice can reference "the advisors I work with" but should NOT claim first-person practitioner experience. "I've watched advisors do this" is fine. "When I run discovery calls" is wrong.`,
    ),
  );

  // Output format
  sections.push(
    formatSection(
      "Output Format",
      `Return the draft as JSON with this exact shape:

{
  "greeting": "<the greeting paragraph>",
  "mainSection": {
    "title": "<a working title for the issue>",
    "body": "<the full main section text>",
    "wordCount": <integer>
  },
  "worthKnowing": [
    {
      "headline": "<news item headline>",
      "body": "<1-2 sentence summary in voice>",
      "stat": "<the specific stat — REQUIRED for first item>",
      "source": "<source>"
    }
  ],
  "ancientTruthDaily": {
    "reference": "<e.g. Proverbs 11:14>",
    "text": "<the proverb text>",
    "application": "<2-3 sentences applying to advisor practice>"
  },
  "signoff": "<the closing paragraph>",
  "totalWordCount": <integer>,
  "draftNotes": "<1-2 sentences for the editor block: any choices you made that should be flagged, alternatives you considered, places where the research thinned out>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
