/**
 * Draft Weekend Block
 *
 * The primary writer block for Saturday Morning Latte weekend issues.
 * Takes approved Cover Story topic + research output, produces the full
 * issue: Greeting, Cover Story, Tasting Menu, Host's Corner, The Drive,
 * Sunday Prep, Sunday Reset, Sabbath, Sign-off.
 *
 * The system prompt carries the weekend voice modules (voice-tone,
 * personal-context, real-life-anchors, car-spectrum, unexpected-variable,
 * insight-layer, guardrails, what-this-voice-isnt) plus the relevant
 * Cover Story type module.
 *
 * The user prompt provides the specific topic, research results, and
 * section-by-section structure.
 */

import { formatSection, wrapInTag } from "../_shared/formatters";
import type { ProposedTopic } from "./concept_check";

export type WeekendResearch = {
  coverStoryResearch: {
    primaryFindings: Array<{
      claim: string;
      specifics: string;
      source: string;
    }>;
    unexpectedVariable: string;
    insightType: "physics" | "wisdom" | "insider";
    insightContent: string;
    personalAnchors: string[];
  };
  tastingMenuItems: Array<{
    category: string;
    item: string;
    unexpectedVariable: string;
    insightType: string;
    context: string;
  }>;
  hostsCornerSeed: {
    topic: string;
    specificMove: string;
    context: string;
  };
  driveSection: {
    category: string;
    vehicle: string;
    specs: string;
    ownershipContext: string;
    angle: string;
  };
  sundayPrep: {
    action: string;
    reasoning: string;
  };
  sundayResetQuote: {
    quote: string;
    attribution: string;
    applicationContext: string;
  };
  sabbathScripture: {
    reference: string;
    translation: string;
    text: string;
    themeConnection: string;
  };
  researchNotes: string;
};

export type DraftWeekendInput = {
  brandId: string;
  issueDate: string;
  approvedTopic: ProposedTopic;
  research: WeekendResearch;
};

/**
 * Build the user prompt for the weekend draft block.
 */
export function buildDraftWeekendPrompt(input: DraftWeekendInput): string {
  const sections: string[] = [];

  sections.push(
    `You are drafting the Saturday Morning Latte weekend issue dated ${input.issueDate}. This is the primary writer block — your output covers all sections of the issue.`,
  );

  // Topic
  sections.push(
    formatSection(
      "Approved Cover Story Topic",
      `Cover Story type: ${input.approvedTopic.contentType}
Topic: ${input.approvedTopic.topic}
Angle: ${input.approvedTopic.angle}`,
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
      `**Greeting (20-40 words).** Saturday morning energy. Not "Welcome to..." — open in the voice. Reference the morning, the weather, what's happening on the dock, what the kids are doing. Brief.

**Cover Story (400-500 words).** The structural template depends on the approved Cover Story type — see the relevant content type module in the system prompt. The voice stays consistent across all 10 types; the structure changes. Use the research findings to ground the piece in specifics. Apply the unexpected variable. Apply the insight (Physics, Wisdom, or Insider). Anchor in the personal context where authentic.

**Tasting Menu (3 items, ~200 words total).** Three recommendations. One sentence to two sentences each. Each item carries its unexpected variable. The categories should differ — if research provides three items, use them; if you need to vary, ensure the categories don't cluster.

**Host's Corner (100-150 words).** A specific gathering, hosting, or social-fabric moment. Use the seed from research. The voice softens slightly into the connection register. Specific, not generic.

**The Drive (75-100 words).** One vehicle. Performance numbers from research. Real ownership context (maintenance, where to buy). The angle that makes the recommendation more than a stat sheet. End with conviction. No "just sayin'" or "for the discerning" drift.

**Sunday Prep (50-75 words).** One specific 15-minute action for tonight. Friend-texting brief. Not a framework, not a lecture. Just one useful thing.

**Sunday Reset (40-80 words).** The reflective quote (verbatim from research, with verified attribution) and a brief reflection connecting the quote to what matters. Not motivational-poster content; grounded.

**Sabbath (60-100 words).** Scripture passage from research, with 1-2 sentence reflection connecting to presence, family, rest, or gratitude. Reverent but not preachy. Inclusive of readers without that faith.

**Sign-off (15-30 words).** Brief, in-voice close. Saturday morning energy. Could reference the day ahead, the weather, what's planned. No filler.`,
    ),
  );

  // Production rules
  sections.push(
    formatSection(
      "Production Rules",
      `**Voice rules (per the weekend voice modules):**
- Friend-who's-done-the-homework register, NOT travel-magazine, luxury-curator, influencer, or life-coach
- Specific over generic — real names, real places, real numbers, real products
- Longer rhythm than weekday — sentences can develop more
- Anti-patterns to watch (from \`what-this-voice-isnt.md\`):
  - "Tucked away," "hidden gem," "discover the magic"
  - "Discerning," "connoisseur," "refined," "elevated," "sophisticated"
  - "OBSESSED," "you NEED," "living for"
  - "Permission to," "deserve," "embrace your truth"
- No em dashes anywhere
- The friend-over-beers test: Would Mark actually say this to a friend over beers?

**Authenticity rules (per personal-context.md):**
- Kids are 13-20. NO toddler/elementary references.
- Mark IS married, DOES live on the salt canal, DID drive those Porsches. The credibility constraint that applies on weekdays does NOT apply on weekends — weekend content can claim Mark's life directly.
- Stay within the canonical context. Don't invent experiences (sailing instead of fishing, Asian cooking he hasn't done, places he hasn't been).
- The recently-used destinations and vehicles in research are HARD blocks (90-day lockout). Do not feature them.

**Guardrails (per guardrails.md):**
- Don't trash items Mark loves: Peloton Power Zone training, Yeti coolers, Costco Kirkland Reserve, Lodge cast iron, pizza steel
- Don't recommend items Mark hates: Traeger pellet smokers, pizza stones, bread machines
- The voice doesn't recommend Tesla in The Drive (Mark hasn't owned one)
- No partisan political content beyond the cross-party "politicians lie for a living" frame
- Faith content stays primarily in the Sabbath section; doesn't proselytize`,
    ),
  );

  // Output format
  sections.push(
    formatSection(
      "Output Format",
      `Return the draft as JSON with this exact shape:

{
  "greeting": "<the greeting paragraph>",
  "coverStory": {
    "title": "<working title>",
    "body": "<the full Cover Story text>",
    "wordCount": <integer>
  },
  "tastingMenu": [
    {
      "item": "<the recommendation>",
      "body": "<the body text for this item>",
      "category": "<from research>"
    }
  ],
  "hostsCorner": {
    "title": "<short title>",
    "body": "<the body text>",
    "wordCount": <integer>
  },
  "theDrive": {
    "vehicle": "<year-make-model>",
    "body": "<the body text>",
    "wordCount": <integer>
  },
  "sundayPrep": {
    "body": "<the body text>",
    "wordCount": <integer>
  },
  "sundayReset": {
    "quote": "<verbatim from research>",
    "attribution": "<verified attribution>",
    "reflection": "<the body text>"
  },
  "sabbath": {
    "reference": "<book chapter:verses>",
    "translation": "<from research>",
    "text": "<the verse text>",
    "reflection": "<the body text>"
  },
  "signoff": "<the closing paragraph>",
  "totalWordCount": <integer>,
  "draftNotes": "<1-2 sentences for the editor block: choices flagged, alternatives considered, research thinness>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
