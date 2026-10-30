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

**PRIZE-FRAMING RULE (HARD, Round 6 — updated 2026-10-27).** The reader opens because they already trust Mark. The inbox is already won — don't try to re-win it with pain OR with a textbook chapter title. Two failure modes:
1. NEGATIVE-HOOK: "miss this", "stop doing X", "the gap", "isn't Y", "the hidden cost". Diagnostic, blames the reader. BANNED.
2. NEUTRAL-DESCRIPTIVE: "Three CRM fields that predict closes", "How to price flat fees". Technically positive, but reads like a book-chapter label — describes a thing instead of pointing at a prize. ALSO BANNED.

Aim for CAPTIVATING-POSITIVE: name an UNCLAIMED PRIZE the reader already owns, with a reader-personal number ($/client, $/deal, %, multiple, timeline) when the body supports one. The subject should make the reader lean in because something is sitting there waiting for them.

**Shapes that work for this brand (ALL prize-framed — described by property, no specific examples):**
- per-client-prize-range: reader-personal + per-client/per-deal/per-household + range of dollars
- prize-waiting: the dollars are already in the reader's book, framed as waiting to be captured
- quantified-distance: N moves between the reader and a specific multiple / percentage / dollar outcome
- captured-win: a specific firm or advisor shape who captured a specific thing in a specific period
- time-to-payoff: a specific habit / move that pays back by a specific date
- mechanism-why: starts with "Why" + explains the mechanism behind a specific reward
- unlock: a reader-owned asset waiting to be surfaced (not "left on the table" — that's diagnostic)

NO EXAMPLES. We don't give specific example subjects here because when we did, the writer kept echoing the exact SHAPE back — three consecutive "$X-$Y per client" subjects in a row across different topics. Instead:
- Pick a shape whose structure differs from the recent subject lines list above
- Fill it with the specific details of THIS issue's topic
- Do not pattern-match on specific wording from any example you may have seen before

**Quality tests — your subject MUST pass at least ONE:**
(a) Names a DOLLAR AMOUNT, MULTIPLE, PERCENTAGE, or TIMELINE the reader can project onto their own book.
(b) Implies the thing is ALREADY THE READER'S but not yet captured.
(c) Names a specific WIN someone like the reader captured.
(d) Starts with "Why..." when the body explains a MECHANISM worth knowing.

If NONE of (a-d) pass and your subject is just a label for a tactic — rewrite. "N X that Y Z" is neutral-descriptive, not captivating.

**Patterns to AVOID (HARD BAN):**
NEGATIVE-HOOK family:
- "X isn't Y, it's Z" / "Your X isn't Y" (deflating comparison)
- "The X you're missing / losing / forgetting"
- "Stop / Quit / Don't / Avoid" anything
- "N advisors miss this" / "most advisors are failing at X"
- "The hidden cost / price / tax of X"
- "What X doesn't see / know / notice"
- "The gap between X and Y"
- "Why your X is broken / wrong / dead"
- "Money left on the table" (diagnostic frame)
NEUTRAL-DESCRIPTIVE family (added Round 6 — "technically positive but boring"):
- "The N [things] that [predict/produce/cause] [outcome]" — reads like a textbook chapter
- "How to [do a tactic]" with no number, timeline, or prize attached
- "The [tactic] [that/for] [generic benefit]"
GENERIC spam/bait:
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
