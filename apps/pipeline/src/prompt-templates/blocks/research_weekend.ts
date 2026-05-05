/**
 * Research Weekend Block
 *
 * Performs research for a Saturday Morning Latte issue based on the approved
 * Cover Story type. Research depth and shape varies by the 10 weekend content
 * types (overlooked destination, luxury insider, food-first travel, etc.).
 *
 * The Cover Story is the centerpiece (400-500 words). The research also
 * informs the Tasting Menu (3 product/wine/recommendation items), Host's
 * Corner (gathering content), The Drive (one car), Sunday Prep (one quick
 * action), Sunday Reset (one reflective quote), and Sabbath (scripture).
 *
 * The Drive section uses the car-spectrum module's vocabulary directly
 * — the writer block needs research-fresh information about specific
 * vehicles, not the system to invent them.
 */

import { formatBulletList, formatSection } from "../_shared/formatters";
import type { ProposedTopic } from "./concept_check";

export type ResearchWeekendInput = {
  brandId: string;
  issueDate: string;
  approvedTopic: ProposedTopic; // the Cover Story topic
  recentDestinations?: string[]; // destinations used in last 90 days (variety)
  recentVehicles?: string[]; // vehicles featured in The Drive in last 90 days (variety)
  recentTastingMenuItems?: string[]; // products featured in last 30 days
  driveCategoryHint?: string; // optional: which car category to feature this week
};

/**
 * Build the user prompt for the weekend research block.
 *
 * The system prompt carries the weekend voice modules, the relevant Cover
 * Story type module, the car-spectrum module, the unexpected-variable
 * diagnostic, and the insight-layer module.
 *
 * The user prompt provides the run-specific topic and variety constraints.
 */
export function buildResearchWeekendPrompt(input: ResearchWeekendInput): string {
  const sections: string[] = [];

  sections.push(
    `You are conducting research for a Saturday Morning Latte issue dated ${input.issueDate}.`,
  );

  // Topic context
  sections.push(
    formatSection(
      "Cover Story Topic Approved by Editorial",
      `Cover Story type: ${input.approvedTopic.contentType}
Topic: ${input.approvedTopic.topic}
Angle: ${input.approvedTopic.angle}`,
    ),
  );

  // Variety guardrails
  if (input.recentDestinations && input.recentDestinations.length > 0) {
    sections.push(
      formatSection(
        "Recently Featured Destinations (do NOT use these — 90-day lockout)",
        formatBulletList(input.recentDestinations),
      ),
    );
  }

  if (input.recentVehicles && input.recentVehicles.length > 0) {
    sections.push(
      formatSection(
        "Recently Featured Vehicles (do NOT feature these in The Drive — 90-day lockout)",
        formatBulletList(input.recentVehicles),
      ),
    );
  }

  if (input.recentTastingMenuItems && input.recentTastingMenuItems.length > 0) {
    sections.push(
      formatSection(
        "Recently Featured Tasting Menu Items (avoid these for the next 30 days)",
        formatBulletList(input.recentTastingMenuItems),
      ),
    );
  }

  if (input.driveCategoryHint) {
    sections.push(
      formatSection(
        "The Drive Category for This Issue",
        `${input.driveCategoryHint}\n\nFeature a vehicle from this category. Refer to the car-spectrum module in the system prompt for the canonical category list and Mark's car vocabulary.`,
      ),
    );
  }

  // Cover Story type-specific research
  sections.push(
    formatSection(
      "Cover Story Research Requirements",
      buildCoverStoryResearchInstructions(input.approvedTopic.contentType),
    ),
  );

  // Section-specific research for the rest of the issue
  sections.push(
    formatSection(
      "Other Section Research Requirements",
      `**Tasting Menu (3 items, ~200 words total).** Three specific recommendations the audience can act on. Each item needs the unexpected variable (the dimension that should drive the decision). Items should be from different categories (don't research three wines or three kitchen tools — vary the categories: a wine, a kitchen tool, a piece of gear; or a book, a service, a hidden product). Avoid recently used items.

**Host's Corner (100-150 words).** A specific moment, idea, or move related to gathering, hosting, or social fabric. Specific, not generic. Could be a recipe move, a hosting tactic, a specific occasion treatment, or a "we figured out this works" insight from real entertaining.

**The Drive (75-100 words).** One specific vehicle from the category indicated. Find current performance numbers (0-60, horsepower, redline if relevant), real ownership context (maintenance considerations, where to buy), and the angle that makes the recommendation more than a stat sheet.

**Sunday Prep (50-75 words).** One specific 15-minute action the reader can do tonight to set up the week well. Practical, not philosophical.

**Sunday Reset (one quote).** One reflective quote from a real source. Not motivational-poster content; something genuine from someone who's figured out what matters. Verify attribution before submitting — wrong attribution kills credibility.

**Sabbath (scripture).** A short scripture passage (typically Ephesians, Colossians, Psalms, or Ecclesiastes) appropriate for reflection on rest, presence, or family. The reflection layer comes in the writing; the research just needs the passage candidate.`,
    ),
  );

  // Output format
  sections.push(
    formatSection(
      "Output Format",
      `Return research as JSON with this exact shape:

{
  "coverStoryResearch": {
    "primaryFindings": [
      {
        "claim": "<specific finding>",
        "specifics": "<the details, names, numbers, locations, or insider intel>",
        "source": "<source name or URL or 'first-hand' if from Mark's experience>"
      }
    ],
    "unexpectedVariable": "<the specific unexpected variable for this topic>",
    "insightType": "physics | wisdom | insider",
    "insightContent": "<the specific insight content>",
    "personalAnchors": ["<which real-life anchors from Mark's life apply>"]
  },
  "tastingMenuItems": [
    {
      "category": "<wine | kitchen | gear | book | service | other>",
      "item": "<specific item name and brand>",
      "unexpectedVariable": "<the variable that should drive the decision>",
      "insightType": "physics | wisdom | insider",
      "context": "<2-3 sentences of context for the writer>"
    }
  ],
  "hostsCornerSeed": {
    "topic": "<what the section is about>",
    "specificMove": "<the specific tactic, recipe move, or insight>",
    "context": "<2-3 sentences>"
  },
  "driveSection": {
    "category": "<icons | sports_sedans | wagons | weekend_cars | practical_with_soul>",
    "vehicle": "<year-make-model>",
    "specs": "<key performance numbers>",
    "ownershipContext": "<maintenance, buying intel, real-world context>",
    "angle": "<the take that makes the recommendation>"
  },
  "sundayPrep": {
    "action": "<the specific action>",
    "reasoning": "<why this matters for the week ahead>"
  },
  "sundayResetQuote": {
    "quote": "<verbatim quote>",
    "attribution": "<verified source>",
    "applicationContext": "<how the quote connects to the audience's life>"
  },
  "sabbathScripture": {
    "reference": "<book chapter:verses>",
    "translation": "<NIV | ESV | NKJV | etc>",
    "text": "<the verse text>",
    "themeConnection": "<rest | presence | family | gratitude | other>"
  },
  "researchNotes": "<1-2 paragraphs on what was harder to find, any caveats, sources to flag>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}

/**
 * Cover Story research instructions vary by which of the 10 types is selected.
 */
function buildCoverStoryResearchInstructions(coverStoryType: string): string {
  switch (coverStoryType) {
    case "overlooked_destination":
      return `**Overlooked Destination.** Find specifics about the place: geography (specific enough to be findable), local character, what makes it overlooked relative to obvious alternatives, timing strategy (when to go / when to avoid), insider details (where to stay, where to eat, what to skip). Mark's authentic experience or trustworthy first-hand intel is preferred over secondhand research.`;

    case "luxury_insider":
      return "**Luxury Insider.** Find the comparison pair: the famous luxury option and the better alternative. Both at the same caliber. Specific differentiating factors (food program, scale, service style, demographic mix). Booking intelligence: timing, room category, direct-vs-online booking, what to ask for. Honest acknowledgment of what the famous option does well.";

    case "peak_season_smart":
      return `**Peak Season Done Smart.** Find the specific peak season's characteristics, the conventional avoid-peak wisdom, the actual cost reality (specific pricing), the tactical moves that turn constraints into advantages (4-5 specific moves with timing), the execution plan timeline.`;

    case "food_first_travel":
      return "**Food-First Travel.** Find a specific culinary route with 3-5 stops in sequence. Each stop needs: identity (what the place is, who runs it), the specific order (what to get and what NOT to get), timing (when to arrive, how long), insider details. Total time, transit between stops, what to skip on the standard tourist circuit.";

    case "international_insider":
      return "**International Insider with Lens.** Find the city + specific interest filter combination. Research 3-4 neighborhoods that serve the interest, 5-7 specific spots within those neighborhoods, what to skip from the standard tourist circuit, the deeper context for why this city for this interest.";

    case "activity_mastery":
      return "**Activity Mastery Travel.** Find the specific skill, the destination optimized for learning it, honest difficulty assessment (physical, mental, timeline reality), the progression path beyond the trip, gear and cost reality, and the deeper insight about learning at midlife. Sources should respect that this is for committed learners, not dabblers.";

    case "family_reality":
      return `**Family Reality Travel.** Find a destination that works for the 13-20 age window (NOT toddler/elementary content). Realistic itinerary with actual energy curves, what works at this age (autonomy, food range, social spaces), what doesn't despite recommendations, logistics reality (meals, transitions, downtime, social dynamics with siblings).`;

    case "tactical_weekend":
      return `**Tactical Weekend (City You Know).** Find what's changed in the city in 2-3 years, 3-4 deep experiences that require insider knowledge, a forgotten neighborhood locals love that tourists miss even on multi-visit return trips, one advance reservation worth weeks of planning. Assume the reader has done the standard tourist circuit.`;

    case "logistics_hack":
      return "**The Logistics Hack.** Find a specific common travel friction (jet lag, multi-city exhaustion, family transit, flight pricing). Research the standard approach and why it produces friction. Develop the systematic solution step-by-step. Quantify savings (time, money, fatigue) specifically. Build an example itinerary showing the system applied.";

    case "hyper_local":
      return `**Hyper-Local Deep Dive.** Find 2-3 specific neighborhoods within a market Mark has authentic local knowledge of. For each: character, honest pros, honest cons, specific cost reality, life-stage fit. Surface what realtors won't tell you in this specific market. Identify where different life stages actually choose.`;

    default:
      return "Research appropriate to the Cover Story type approved. Surface specifics, sources, and depth the writer block will need.";
  }
}
