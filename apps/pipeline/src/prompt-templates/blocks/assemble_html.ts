/**
 * Assemble HTML Block
 *
 * Takes the score-aggregator-approved final draft and renders it to email-ready
 * HTML using the brand's email template. Distinct from the React Email components
 * the dev team builds — this block produces the rendered HTML the send pipeline
 * actually transmits.
 *
 * Most of this work is deterministic templating, not LLM generation. The LLM is
 * involved primarily for two things:
 * 1. Generating the subject line (calibrated to drive opens for the issue's content)
 * 2. Generating the preview text (the snippet that appears alongside subject in inbox)
 *
 * The actual HTML body is composed by code from the React Email template + the
 * approved draft data. This block's prompt focuses on subject line and preview text.
 */

import { formatSection, wrapInTag } from "../_shared/formatters";

export type AssembleHtmlInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  contentType: string;
  finalDraftJson: string;
  recentSubjectLines: string[]; // last ~30 issues' subjects (for variety)
  baselineOpenRate: number; // for calibration context
};

/**
 * Build the user prompt for the assemble HTML block.
 *
 * Specifically, this generates the subject line and preview text. The HTML
 * rendering itself is deterministic and happens in code, not in the LLM call.
 */
export function buildAssembleHtmlPrompt(input: AssembleHtmlInput): string {
  const sections: string[] = [];

  sections.push(
    `You are generating the subject line and preview text for the ${input.edition} issue dated ${input.issueDate}. The HTML body is rendered by code from the approved draft; your job is the inbox-presentation layer.`,
  );

  sections.push(
    formatSection(
      "Final Draft (for context)",
      wrapInTag("draft_json", input.finalDraftJson),
    ),
  );

  if (input.recentSubjectLines.length > 0) {
    sections.push(
      formatSection(
        "Recent Subject Lines (vary against these)",
        input.recentSubjectLines.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      ),
    );
  }

  sections.push(
    formatSection(
      "Subject Line Rules",
      `**Length:** 35-65 characters. Mobile inboxes truncate around 35-50 chars; longer lines lose their tail.

**Voice:** Same as the brand voice. Direct, opinionated, specific. Not clickbait. Not "5 ways to..." listicle drift. Not "You won't believe what happened next" curiosity-gap manipulation.

**Patterns that work for this brand:**
- The position-as-subject: "Stop asking for referrals."
- The specific tactic: "The 15-minute Friday review that protects your week"
- The unexpected variable: "The cooler decision isn't ice retention"
- The contrarian claim: "Your top 20% probably isn't your top 20%"
- The named target: "Why pellet smokers are cheating"
- The intriguing specific: "The 911 buy-drive-sell math"

**Patterns to AVOID:**
- "Don't miss this..." (curiosity-gap)
- "[NAME], here's what you need to know" (false personalization)
- ALL CAPS (fails spam filters)
- Multiple punctuation marks (!!!)
- Emoji-loaded subjects (occasional emoji acceptable; loaded subjects fail spam)
- Generic newsletter headers ("This week at...")

**Variety:** Don't reuse subject patterns from the recent list. If the last issue used a contrarian-position subject, this one should use a different pattern.

**Calibration:**
The brand's baseline open rate for this audience is ${input.baselineOpenRate}. A well-calibrated subject line for this content type should produce open rates in the baseline range or above. Subject lines that significantly underperform baseline indicate calibration drift.`,
    ),
  );

  sections.push(
    formatSection(
      "Preview Text Rules",
      `**Length:** 60-110 characters. The preview appears next to the subject in most email clients. Longer than that gets truncated.

**Function:** The preview is the "second hook." Subject line earns the open; preview earns the actual read. The preview should COMPLEMENT the subject, not duplicate it.

**Patterns that work:**
- Specific intel: "The exact question that opens discovery calls right."
- Counter-intuitive specific: "Costs more, plans more, worth it. Here's the math."
- The detail that earns the click: "Three Costco wines worth buying when they release."
- The friend-text register: "Hey, you've got to see this Asheville move we figured out."

**Patterns to AVOID:**
- Repeating the subject line in different words
- Generic "Read inside" or "All the details below"
- Spam-trigger phrasing ("Limited time," "Act now")
- Ellipsis bait ("And what we learned...")

**The combination test:** Read subject + preview together. They should make the reader want to open. They should set up the issue's substance specifically.`,
    ),
  );

  sections.push(
    formatSection(
      "Output Format",
      `Return the inbox metadata as JSON:

{
  "subjectLine": "<subject line, 35-65 chars>",
  "previewText": "<preview text, 60-110 chars>",
  "subjectLineRationale": "<1 sentence on why this subject for this issue>",
  "previewTextRationale": "<1 sentence on why this preview pairs with the subject>",
  "alternativeSubjects": ["<alt 1>", "<alt 2>"],
  "characterCounts": {
    "subjectLineChars": <integer>,
    "previewTextChars": <integer>
  }
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
