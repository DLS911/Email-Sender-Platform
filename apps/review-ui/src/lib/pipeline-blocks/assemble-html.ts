/**
 * Assemble HTML Block — adapted from
 * /apps/pipeline/src/prompt-templates/blocks/assemble_html.ts
 *
 * Generates inbox-optimized subject line (35-65 chars) and preview text
 * (60-110 chars). The HTML body rendering itself is deterministic (handled
 * by renderDailyGrindHtml); this block focuses purely on the inbox
 * presentation layer — what shows in Gmail/Outlook before the open.
 *
 * Run AFTER persona_panel approval. Uses Haiku for cost efficiency (~$0.005).
 */

export type AssembleHtmlInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  contentType: string;
  finalDraftJson: string;
  recentSubjectLines: string[];
  baselineOpenRate: number;
};

function formatSection(label: string, body: string): string {
  return `## ${label}\n\n${body.trim()}`;
}

function wrapInTag(tag: string, content: string): string {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

export function buildAssembleHtmlPrompt(input: AssembleHtmlInput): string {
  const sections: string[] = [];

  sections.push(
    `You are generating the subject line and preview text for the ${input.edition} issue dated ${input.issueDate}. The HTML body is rendered by code from the approved draft; your job is the inbox-presentation layer.`,
  );

  sections.push(formatSection("Final Draft (for context)", wrapInTag("draft_json", input.finalDraftJson)));

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
- The intriguing specific: "63% of advisors miss this in discovery"

**Patterns to AVOID:**
- "Don't miss this..." (curiosity-gap)
- "[NAME], here's what you need to know" (false personalization)
- ALL CAPS (fails spam filters)
- Multiple punctuation marks (!!!)
- Emoji-loaded subjects (occasional emoji acceptable)
- Generic newsletter headers ("This week at...")

**Variety:** Don't reuse subject patterns from the recent list. If the last issue used a contrarian-position subject, this one should use a different pattern.

**Calibration:** Baseline open rate for this audience is ${input.baselineOpenRate}. A well-calibrated subject should produce opens in the baseline range or above.`,
    ),
  );

  sections.push(
    formatSection(
      "Preview Text Rules",
      `**Length:** 60-110 characters. Longer gets truncated by most email clients.

**Function:** The preview is the "second hook." Subject earns the open; preview earns the actual read. The preview should COMPLEMENT the subject, not duplicate it.

**Patterns that work:**
- Specific intel: "The exact question that opens discovery calls right."
- Counter-intuitive specific: "Costs more, plans more, worth it. Here's the math."
- The detail that earns the click: "What advisors say they want vs. what they actually do."

**Patterns to AVOID:**
- Repeating the subject in different words
- Generic "Read inside" or "All the details below"
- Spam-trigger phrasing ("Limited time," "Act now")
- Ellipsis bait

**The combination test:** Read subject + preview together. They should make the reader want to open.`,
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

export type AssembleHtmlOutput = {
  subjectLine: string;
  previewText: string;
  subjectLineRationale?: string;
  previewTextRationale?: string;
  alternativeSubjects?: string[];
  characterCounts?: { subjectLineChars: number; previewTextChars: number };
};
