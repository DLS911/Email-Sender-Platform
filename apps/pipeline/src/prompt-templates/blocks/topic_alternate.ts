/**
 * Topic Alternate Block
 *
 * Called when concept_check returns reject or modify. Proposes a revised
 * topic that respects the blocking concept or modification suggestion.
 *
 * Output: a new topic proposal in the same shape as topic_proposer's output.
 * The new proposal goes back through concept_check; the loop continues until
 * a topic clears or a max-attempt cap is hit.
 */

import { formatBulletList, formatSection } from "../_shared/formatters";
import type { ProposedTopic } from "./concept_check";

export type TopicAlternateInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  rejectedTopic: ProposedTopic;
  rejectionReason: string;
  blockingConcept?: string; // if rejection was concept lockout
  modificationSuggestion?: string; // if rejection was framework over-exposure
  attemptNumber: number; // how many alternates have been tried
  maxAttempts: number;
  blockedConcepts: string[]; // accumulated across this loop
};

/**
 * Build the user prompt for the topic alternate block.
 */
export function buildTopicAlternatePrompt(input: TopicAlternateInput): string {
  const sections: string[] = [];

  sections.push(
    `The proposed topic for the ${input.edition} issue dated ${input.issueDate} was rejected by concept check. You need to propose an alternative.`,
  );

  sections.push(
    formatSection(
      "Rejected Topic",
      `Content type: ${input.rejectedTopic.contentType}
Topic: ${input.rejectedTopic.topic}
Angle: ${input.rejectedTopic.angle}
Framework references: ${input.rejectedTopic.frameworkReferences.join(", ")}`,
    ),
  );

  sections.push(
    formatSection("Rejection Reason", input.rejectionReason),
  );

  if (input.blockingConcept) {
    sections.push(
      formatSection(
        "Blocking Concept",
        `${input.blockingConcept}\n\nThis concept is currently in cooloff. Do not propose any topic that touches this concept.`,
      ),
    );
  }

  if (input.modificationSuggestion) {
    sections.push(
      formatSection("Modification Suggestion from Concept Check", input.modificationSuggestion),
    );
  }

  if (input.blockedConcepts.length > 0) {
    sections.push(
      formatSection(
        "All Blocked Concepts (do NOT touch any of these)",
        formatBulletList(input.blockedConcepts),
      ),
    );
  }

  sections.push(
    formatSection(
      "Your Task",
      `Propose an alternative topic for this issue. The alternative should:

1. Avoid the blocking concept entirely
2. Apply any modification suggestion from concept check
3. Stay aligned with the editorial spirit of the original topic where possible — if the original was a contrarian Take on referrals, the alternative might be a contrarian Take on a different industry practice rather than pivoting to an entirely different content type
4. Be genuinely different from the rejected topic, not a thin rephrasing

This is alternate attempt ${input.attemptNumber} of ${input.maxAttempts}. If you can't find a good alternative within the constraints, prefer pivoting to a different content type rather than forcing a strained version of the original direction.

Return your alternative proposal as JSON with this exact shape:

{
  "contentType": "<content type slug>",
  "formatStyle": "<optional format style>",
  "topic": "<specific topic in 8-15 words>",
  "angle": "<the specific take or treatment in 1-2 sentences>",
  "frameworkReferences": ["<framework module slugs>"],
  "rationale": "<1-2 sentences on why this alternative addresses the rejection>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
