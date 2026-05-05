/**
 * Concept Check Block
 *
 * Validates a proposed topic against the brand's concept history. Checks
 * whether the topic touches framework_concepts (reusable patterns that
 * recur intentionally) or content_concepts (specific topics that should
 * NOT recur within a lookback window).
 *
 * Output: a verdict (approve | reject | modify) with reasoning. If reject
 * or modify, the next block in the pipeline (topic_alternate) will propose
 * a revised topic.
 */

import { daysBetween, formatBulletList, formatDate, formatSection } from "../_shared/formatters";

export type FrameworkConceptUsage = {
  conceptSlug: string;
  lastUsedAt: string; // ISO timestamp
  usageCount: number; // total times used historically
};

export type ContentConceptUsage = {
  conceptSlug: string;
  conceptDescription: string;
  firstUsedAt: string; // ISO timestamp
  cooloffEndsAt: string; // when the lockout window expires
};

export type ProposedTopic = {
  contentType: string;
  topic: string;
  angle: string;
  frameworkReferences: string[];
};

export type ConceptCheckInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string; // ISO date for the issue being checked
  proposedTopic: ProposedTopic;
  recentFrameworkUsage: FrameworkConceptUsage[]; // sorted by lastUsedAt desc
  activeContentLockouts: ContentConceptUsage[]; // concepts still inside cooloff
  contentLockoutWindowDays: number; // default 90
  frameworkOverexposureThreshold: number; // default 4 uses in 30 days
};

/**
 * Build the user prompt for the concept check block.
 *
 * The system prompt carries the brand's framework concepts (the reusable
 * patterns) and the editorial discipline around variety.
 *
 * The user prompt is the actual run-specific check: here's the proposed
 * topic, here's what's been recently used, evaluate.
 */
export function buildConceptCheckPrompt(input: ConceptCheckInput): string {
  const sections: string[] = [];

  sections.push(
    `You are evaluating a proposed topic for the ${input.edition} issue dated ${input.issueDate} against the brand's concept usage history.`,
  );

  // The proposed topic
  sections.push(
    formatSection(
      "Proposed Topic",
      `Content type: ${input.proposedTopic.contentType}
Topic: ${input.proposedTopic.topic}
Angle: ${input.proposedTopic.angle}
Framework references: ${
        input.proposedTopic.frameworkReferences.length > 0
          ? input.proposedTopic.frameworkReferences.join(", ")
          : "(none specified)"
      }`,
    ),
  );

  // Framework concept usage (informational — these are allowed to recur, but should not over-cluster)
  if (input.recentFrameworkUsage.length > 0) {
    const frameworkLines = input.recentFrameworkUsage.map((usage) => {
      const days = daysBetween(usage.lastUsedAt, input.issueDate);
      return `${usage.conceptSlug}: last used ${days} days ago, ${usage.usageCount} total uses historically`;
    });
    sections.push(
      formatSection(
        "Recent Framework Concept Usage (last 30 days)",
        formatBulletList(frameworkLines),
      ),
    );
  }

  // Content concept lockouts — these are HARD blocks
  if (input.activeContentLockouts.length > 0) {
    const lockoutLines = input.activeContentLockouts.map((lockout) => {
      const daysRemaining = daysBetween(input.issueDate, lockout.cooloffEndsAt);
      return `${lockout.conceptSlug} (used ${formatDate(lockout.firstUsedAt)}, cooloff ends ${formatDate(lockout.cooloffEndsAt)}, ${daysRemaining} days remaining): ${lockout.conceptDescription}`;
    });
    sections.push(
      formatSection("Active Content Concept Lockouts (HARD BLOCK)", formatBulletList(lockoutLines)),
    );
  }

  sections.push(
    formatSection(
      "Your Task",
      `Evaluate the proposed topic. Apply two checks:

**Check 1: Content Concept Lockouts (hard).** Does the proposed topic re-use a content concept that's currently in cooloff? If yes, reject. Content concepts are specific things (a destination, a vehicle, a specific tactic, a specific contrarian take). The lockout window is ${input.contentLockoutWindowDays} days from first use. Re-using a locked-out concept is not allowed.

**Check 2: Framework Concept Over-exposure (soft).** Does the proposed topic lean on framework concepts that have appeared more than ${input.frameworkOverexposureThreshold} times in the last 30 days? If yes, suggest modification — recommend the angle pivot to a different framework that hasn't been over-used recently.

Be strict about Check 1. Content concept lockouts are the variety-enforcement spine of the brand — re-using a destination or a specific tactic within 90 days breaks the audience's perception of the brand as fresh.

Be flexible on Check 2. Frameworks ARE meant to recur (Trust Stacking, GAP, Physician Model — these are the brand's voice, not topic content). The threshold catches over-clustering, not normal use.

Return your evaluation as JSON with this exact shape:

{
  "verdict": "approve | reject | modify",
  "reasoning": "<1-2 sentences explaining the verdict>",
  "blockingConcept": "<concept slug if reject, otherwise null>",
  "modificationSuggestion": "<if modify: 1-2 sentences on what to change, otherwise null>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
