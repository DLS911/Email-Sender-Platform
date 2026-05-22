/**
 * Research Weekday Block — adapted verbatim from
 * /apps/pipeline/src/prompt-templates/blocks/research_weekday.ts
 *
 * Spec'd structured research prompt. Takes the topic_proposer's output
 * (contentType + topic + angle + frameworkReferences) and produces
 * organized research the writer can build sections from:
 *
 * - primaryFindings: central facts/claims with supporting evidence
 * - frameworkAlignments: how the topic touches each named framework
 * - scriptsOrLanguage: verbatim phrases/scripts (especially for Tactics)
 * - worthKnowingItems: 3 news items pre-organized (first has stat)
 * - proverbCandidates: 2-3 candidate verses for Ancient Truth
 * - researchNotes: writer-only caveats and gap notes
 *
 * One local extension vs the spec: worthKnowingItems now requires a
 * `url` field so the post-process validators that check Worth Knowing
 * sourceUrl against research URLs can still operate.
 */

export type ProposedTopic = {
  contentType: string;
  topic: string;
  angle: string;
  frameworkReferences: string[];
};

export type ResearchWeekdayInput = {
  brandId: string;
  issueDate: string;
  approvedTopic: ProposedTopic;
  recentlyUsedSources?: string[];
  factCheckHistory?: string[];
};

export type StructuredResearchOutput = {
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
    url: string; // local extension — required for validator compat
    relevance: string;
  }>;
  proverbCandidates: Array<{
    reference: string;
    text: string;
    applicationToTopic: string;
  }>;
  researchNotes: string;
};

function formatBulletList(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item) => `- ${item}`).join("\n");
}

function formatSection(label: string, body: string): string {
  return `## ${label}\n\n${body.trim()}`;
}

function buildContentTypeResearchInstructions(contentType: string): string {
  switch (contentType) {
    case "tactic":
      return `For a Tactic, find:
- Specific implementable techniques the advisor can execute within 7 days
- Scripts, templates, or exact language they'd use (verbatim if possible)
- Step-by-step processes with timing
- Specific failure modes other advisors encounter
- Compliance considerations if any`;

    case "take":
      return `For a Take, find:
- The conventional industry wisdom on the topic (state it fairly, not as a strawman)
- Data, patterns, or examples that contradict the conventional wisdom
- The mechanism behind why the contrarian position holds
- Specific named industry actors or practices the contrarian view applies to
- Counter-examples that show what the alternative looks like in practice`;

    case "story":
      return `For a Story, find:
- A specific anonymizable advisor scenario with a real choice point
- The texture: location-shaped, practice stage, family situation, professional context
- The decision the advisor faced and what was at stake
- The downstream consequences (specifically, with detail)
- The implicit lesson the story illustrates
- Cross-reference: ensure the scenario doesn't risk identifying any specific real advisor`;

    case "rant":
      return `For a Rant, find:
- The specific industry behavior, vendor, product, or practice that warrants the heat
- The math: real numbers showing the harm (dollars, percentages, basis points, time horizons)
- Specific actors who profit and who pays
- The cover stories the industry uses to make this acceptable, with the dismantle of each
- Real harmed parties (clients, advisors) with specific examples
- Alternatives the reader can pursue (the implication side of the Rant)`;

    case "special":
      return `For a Special, find:
- The technical landscape of the topic (compliance/team/tech/regulatory/operations)
- Current regulatory or operational state (with citations to primary sources where applicable)
- The decision factors that determine the right approach for a specific firm
- Implementation specifics: steps, timeframes, common pitfalls
- The boundaries: where the topic touches counsel, expert support, or judgment beyond the brand's scope
- Specific dollar amounts, time periods, percentages where applicable`;

    case "ancient_truth":
      return `For an Ancient Truth, find:
- The specific proverb (or other ancient wisdom-literature source) that genuinely applies
- The translation chosen (KJV/ESV/NIV are all acceptable; consistency within a piece matters)
- The plain-language read of what the proverb claims
- The specific advisor practice context where the proverb's truth shows up
- Real or composite scenes from advisor practice that illustrate the application
- Verify the proverb's text and reference accurately — misattribution kills credibility`;

    default:
      return "Conduct research appropriate for the topic and angle approved. Surface specifics, sources, and depth that the writer block will need to produce a draft worthy of the brand.";
  }
}

/**
 * Build the user prompt for the weekday research block.
 *
 * The system prompt (loaded separately) carries:
 * - The brand's voice modules (so research surfaces material that fits the voice)
 * - The relevant content type module (so research depth matches type)
 * - Editorial quality standards (so research meets the bar)
 */
export function buildResearchWeekdayPrompt(input: ResearchWeekdayInput): string {
  const sections: string[] = [];

  sections.push(
    `You are conducting research for a Daily Grind weekday issue dated ${input.issueDate}.`,
  );

  sections.push(
    formatSection(
      "Topic Approved by Editorial",
      `Content type: ${input.approvedTopic.contentType}
Topic: ${input.approvedTopic.topic}
Angle: ${input.approvedTopic.angle}
Framework references: ${input.approvedTopic.frameworkReferences.join(", ")}`,
    ),
  );

  if (input.recentlyUsedSources && input.recentlyUsedSources.length > 0) {
    sections.push(
      formatSection(
        "Recently Used Sources (avoid these for variety)",
        formatBulletList(input.recentlyUsedSources),
      ),
    );
  }

  if (input.factCheckHistory && input.factCheckHistory.length > 0) {
    sections.push(
      formatSection(
        "Recently Used Statistics (avoid recycling these)",
        formatBulletList(input.factCheckHistory),
      ),
    );
  }

  sections.push(
    formatSection(
      "Research Requirements by Content Type",
      buildContentTypeResearchInstructions(input.approvedTopic.contentType),
    ),
  );

  sections.push(
    formatSection(
      "Universal Requirements (apply regardless of content type)",
      `Worth Knowing section needs **5-8 news items** relevant to financial advisors (do NOT stop at 3 — the writer needs depth, and we need redundancy to drop low-quality items). The FIRST item must include a statistic, number, or data point suitable for a visual element. Remaining items are commentary, development pieces, or supporting evidence.

primaryFindings should have **at least 5 distinct findings** — each one a specific claim with its own source. If you only find 3, run more searches.

Ancient Truth daily reference needs 2-3 candidate Bible verses (ESV translation preferred). These should be **standalone daily wisdom** — they do NOT need to relate to the email's topic. Pull from Proverbs, Matthew (Sermon on the Mount, parables), James, Ecclesiastes, Psalms, or Luke. Variety across books is good. Plain general wisdom on living well, work, character, integrity, humility, patience, prudence. Do NOT pre-filter to "fits this issue's topic" — the verse stands on its own as daily wisdom.

Source quality bar:
- Prefer Kitces Research, Cerulli, J.D. Power, Schwab Advisor Services, InvestmentNews, FA Magazine, Financial Advisor magazine, regulatory primary sources (SEC, FINRA), Federal Reserve research
- Acceptable: ThinkAdvisor, AdvisorHub, RIA Channel, Financial Planning magazine
- Avoid: low-quality content marketing, generic advisor blogs, vendor-promotional material disguised as research

URL quality bar:
- Every URL must be a deep article URL (with a slug), NOT a homepage or section page
- VALID: https://www.thinkadvisor.com/2026/05/15/article-slug-here
- INVALID: https://www.thinkadvisor.com (homepage)
- INVALID: https://www.thinkadvisor.com/news (section page)
- If you can't find a deep article URL, drop the item rather than supply a homepage`,
    ),
  );

  sections.push(
    formatSection(
      "Output Format",
      `Return research as JSON with this exact shape:

{
  "primaryFindings": [
    {
      "claim": "<specific factual claim or insight>",
      "supporting": "<the evidence, data, or pattern that supports this>",
      "source": "<source name or URL>",
      "relevanceToTopic": "<how this serves the angle>"
    }
  ],
  "frameworkAlignments": [
    {
      "framework": "<framework module slug from approvedTopic.frameworkReferences>",
      "specificConnection": "<how the topic connects to this framework, briefly>"
    }
  ],
  "scriptsOrLanguage": [
    "<specific phrasing, scripts, or language patterns relevant to the topic>"
  ],
  "worthKnowingItems": [
    {
      "headline": "<the news item headline>",
      "summary": "<2-3 sentence summary>",
      "stat": "<statistic or data point — REQUIRED for first item>",
      "source": "<source name>",
      "url": "<deep article URL — required>",
      "relevance": "<why advisors care>"
    }
  ],
  "proverbCandidates": [
    {
      "reference": "<e.g. Proverbs 11:14 | Matthew 6:34 | James 1:19 | Ecclesiastes 3:1>",
      "text": "<the verse text in ESV>",
      "applicationToTopic": "<1 sentence on the verse's PLAIN meaning — general wisdom, not tied to today's email topic>"
    }
  ],
  "researchNotes": "<1-2 paragraphs on what you found, what was harder than expected, and any caveats the writer should know about>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
