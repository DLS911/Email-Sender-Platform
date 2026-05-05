/**
 * Topic Proposer Block
 *
 * Selects the content type and specific topic for an upcoming issue.
 * Considers recent content history (to avoid repetition), editorial calendar
 * targets (for type/format variety), and brand-level priorities.
 *
 * Output: a structured topic proposal that downstream blocks (research, draft)
 * use as input. The proposal includes the content type, the specific topic,
 * the angle, and any priority framework references.
 */

import { formatBulletList, formatSection, wrapInTag } from "../_shared/formatters";

export type RecentIssue = {
  publishedAt: string; // ISO timestamp
  contentType: string;
  topic: string;
  formatStyle?: string; // e.g. "deep_dive", "quick_hits", "contrarian"
};

export type EditorialCalendarHint = {
  preferredContentType?: string;
  preferredFormatStyle?: string;
  upcomingThemes?: string[]; // optional thematic priorities
};

export type TopicProposerInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string; // ISO date for this issue
  recentIssues: RecentIssue[]; // last ~30 days, ordered most recent first
  calendarHint?: EditorialCalendarHint;
  blockedConcepts?: string[]; // concept slugs flagged as too-recent by concept_check
};

/**
 * Build the user prompt for the topic proposer block.
 *
 * The system prompt (loaded separately) carries:
 * - Brand voice modules (so the proposer thinks in-voice)
 * - Content type modules (so the proposer knows what each type requires)
 * - Editorial quality module (so it understands what makes a good topic)
 *
 * The user prompt provides the run-specific context: what's been published
 * recently, what the editorial calendar suggests, what concepts are blocked.
 */
export function buildTopicProposerPrompt(input: TopicProposerInput): string {
  const sections: string[] = [];

  // Frame the task
  sections.push(
    `You are proposing the topic for the ${input.edition} issue dated ${input.issueDate}.`,
  );

  // Recent issues context — what NOT to repeat
  if (input.recentIssues.length > 0) {
    const recentList = input.recentIssues
      .slice(0, 30) // cap at 30 most recent
      .map((issue) => {
        const fmt = issue.formatStyle ? ` [${issue.formatStyle}]` : "";
        return `${issue.publishedAt.slice(0, 10)} — ${issue.contentType}${fmt}: ${issue.topic}`;
      });

    sections.push(
      formatSection(
        "Recent Issues (most recent first)",
        formatBulletList(recentList),
      ),
    );
  }

  // Editorial calendar guidance
  if (input.calendarHint) {
    const hintLines: string[] = [];
    if (input.calendarHint.preferredContentType) {
      hintLines.push(`Preferred content type: ${input.calendarHint.preferredContentType}`);
    }
    if (input.calendarHint.preferredFormatStyle) {
      hintLines.push(`Preferred format style: ${input.calendarHint.preferredFormatStyle}`);
    }
    if (input.calendarHint.upcomingThemes && input.calendarHint.upcomingThemes.length > 0) {
      hintLines.push(`Themes in current focus: ${input.calendarHint.upcomingThemes.join(", ")}`);
    }
    if (hintLines.length > 0) {
      sections.push(formatSection("Editorial Calendar Guidance", hintLines.join("\n")));
    }
  }

  // Blocked concepts — topics or themes that have appeared too recently
  if (input.blockedConcepts && input.blockedConcepts.length > 0) {
    sections.push(
      formatSection(
        "Blocked Concepts (do NOT propose topics that touch these)",
        formatBulletList(input.blockedConcepts),
      ),
    );
  }

  // The actual instruction
  sections.push(
    formatSection(
      "Your Task",
      `Propose ONE topic for this issue. The proposal should:

1. Pick a content type appropriate for the edition and the calendar guidance
2. Pick a specific topic within that type that hasn't been covered recently
3. State the specific angle — not just the topic but the take or treatment
4. Reference any framework that the topic naturally engages with (Trust Stacking, GAP, Physician Model, contrarian positions, etc.)
5. Avoid blocked concepts entirely

Variety matters. If the last three issues were all Tactics, lean toward Take, Story, Special, Rant, or Ancient Truth. If the last three Cover Stories were all destination-driven, lean toward Tactical Weekend, Logistics Hack, or Activity Mastery.

Return your proposal as JSON with this exact shape:

{
  "contentType": "<one of: tactic | take | story | rant | special | ancient_truth | overlooked_destination | luxury_insider | peak_season_smart | food_first_travel | international_insider | activity_mastery | family_reality | tactical_weekend | logistics_hack | hyper_local>",
  "formatStyle": "<optional: deep_dive | quick_hits | contrarian | story | data | other>",
  "topic": "<specific topic in 8-15 words>",
  "angle": "<the specific take or treatment in 1-2 sentences>",
  "frameworkReferences": ["<framework module slugs that this topic engages>"],
  "rationale": "<1-2 sentences on why this topic now, given recent context>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
