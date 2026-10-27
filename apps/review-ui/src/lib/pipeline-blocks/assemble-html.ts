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

**UPSIDE-FIRST RULE (HARD, added 2026-10-27).** The reader opens because they already trust Mark. The inbox is already won — do NOT try to re-win it with pain or surprise-problem. Negative hooks ("miss this", "stop doing X", "the gap", "isn't Y", "the hidden cost") LAND the open but LOSE the trust. Default LLM instinct is "captivating = negative hook because that's what wins on generic internet copy". That instinct is WRONG for this audience. Your subject MUST name an UPSIDE, an INSTRUCTION, a WIN, or a QUANTIFIED GAIN — not a problem the reader has.

**Patterns that work for this brand (ALL upside-forward):**
- The specific tactic: "The 15-minute Friday review that protects your week"
- The quantified upside: "The move that compounds to 11.6x on exit"
- The win-story: "How one solo RIA closed $47M in Q3"
- The instruction: "How to carve a planning fee out of your next intro"
- The compounding habit: "The Monday hour that pays back by December"
- The pattern name: "What top advisors do with their first prospect call"
- The specific stat as opportunity: "The 3 CRM fields that predict closes"

**Patterns to AVOID (HARD BAN — these are negative-hook shapes):**
- "X isn't Y, it's Z" / "Your X isn't Y" (deflating comparison)
- "The X you're missing / losing / forgetting"
- "Stop / Quit / Don't / Avoid" anything
- "N advisors miss this" / "most advisors are failing at X"
- "The hidden cost / price / tax of X"
- "What X doesn't see / know / notice"
- "The gap between X and Y"
- "Why your X is broken / wrong / dead"
- Curiosity-gap: "Don't miss this..." / "You won't believe..."
- False personalization: "[NAME], here's what you need to know"
- ALL CAPS, multiple punctuation (!!!), emoji-loaded subjects
- Generic newsletter headers ("This week at...")

**The gain-noun test:** Read your proposed subject back. Does it NAME a specific thing the reader WILL GET if they open? (A move, a dollar amount, a close, a Monday habit, an opening question, an upgrade.) If instead it names a thing the reader is FAILING AT or LOSING, rewrite — your subject is a negative hook even if the words sound neutral.

**Variety:** Don't reuse subject patterns from the recent list. Vary across quantified upside / win-story / instruction / specific tactic.

**Calibration:** Baseline open rate for this audience is ${input.baselineOpenRate}. A well-calibrated subject should produce opens in the baseline range or above WITHOUT using a negative hook. The data is clear: this audience opens on trust, not surprise.`,
    ),
  );

  sections.push(
    formatSection(
      "Preview Text Rules",
      `**Length:** 60-110 characters. Longer gets truncated by most email clients.

**Function:** The preview is the "second hook." Subject earns the open; preview earns the actual read. The preview should COMPLEMENT the subject, not duplicate it.

**Patterns that work (all upside-forward):**
- Specific intel: "The exact question that opens discovery calls right."
- Counter-intuitive specific with upside: "Costs more, plans more, worth it. Here's the math."
- The move teased: "The 20-minute Monday habit that compounds by December."
- The win-detail: "How one solo RIA pulled off a $47M quarter."

**Patterns to AVOID:**
- Repeating the subject in different words
- Problem-identification of the reader ("What you're missing..." / "What advisors get wrong")
- Negative-hook mirror of the subject
- Generic "Read inside" or "All the details below"
- Spam-trigger phrasing ("Limited time," "Act now")
- Ellipsis bait

**The combination test:** Read subject + preview together. They should name an UPSIDE / MOVE / WIN the reader can capture, not a problem the reader has. If the pair sounds like a diagnosis, rewrite — the subject-line's upside rule applies to the preview too.`,
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
