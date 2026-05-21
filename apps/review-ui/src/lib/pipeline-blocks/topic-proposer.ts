/**
 * Topic Proposer Block — copied verbatim from
 * /apps/pipeline/src/prompt-templates/blocks/topic_proposer.ts
 *
 * The source-of-truth prompt for picking what an issue should be ABOUT.
 * Runs BEFORE research so research goes looking for content on the
 * spec'd topic instead of returning generic news.
 *
 * Local copy so the Next.js review-ui build can include it (apps/pipeline
 * is outside this app's src tree).
 *
 * If the source file at /apps/pipeline/.../topic_proposer.ts changes,
 * this copy needs to be re-synced.
 */

export type RecentIssue = {
  publishedAt: string; // ISO timestamp
  contentType: string;
  topic: string;
  formatStyle?: string;
};

export type EditorialCalendarHint = {
  preferredContentType?: string;
  preferredFormatStyle?: string;
  upcomingThemes?: string[];
};

export type TopicProposerInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  recentIssues: RecentIssue[];
  calendarHint?: EditorialCalendarHint;
  blockedConcepts?: string[];
};

export type TopicProposerOutput = {
  contentType: string;
  formatStyle?: string;
  topic: string;
  angle: string;
  frameworkReferences: string[];
  rationale: string;
};

function formatBulletList(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item) => `- ${item}`).join("\n");
}

function formatSection(label: string, body: string): string {
  return `## ${label}\n\n${body.trim()}`;
}

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

  sections.push(
    `You are proposing the topic for the ${input.edition} issue dated ${input.issueDate}.`,
  );

  if (input.recentIssues.length > 0) {
    const recentList = input.recentIssues.slice(0, 30).map((issue) => {
      const fmt = issue.formatStyle ? ` [${issue.formatStyle}]` : "";
      return `${issue.publishedAt.slice(0, 10)} — ${issue.contentType}${fmt}: ${issue.topic}`;
    });
    sections.push(formatSection("Recent Issues (most recent first)", formatBulletList(recentList)));
  }

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

  if (input.blockedConcepts && input.blockedConcepts.length > 0) {
    sections.push(
      formatSection(
        "Blocked Concepts (do NOT propose topics that touch these)",
        formatBulletList(input.blockedConcepts),
      ),
    );
  }

  sections.push(
    formatSection(
      "Your Task",
      `Propose ONE topic for this issue. The proposal should:

1. Pick a content type appropriate for the edition and the calendar guidance
2. Pick a specific topic within that type that hasn't been covered recently
3. State the specific angle — not just the topic but the take or treatment
4. Reference any framework that the topic naturally engages with (Trust Stacking, GAP, Physician Model, contrarian positions, etc.)
5. Avoid blocked concepts entirely

## Topic Variety — read carefully

Variety matters at THREE levels, not just one:

**Level 1: Same exact topic.** Obviously don't repeat. (Easy.)

**Level 2: Adjacent topic in the same theme cluster.** If yesterday was about "discovery call preparation," today should NOT be about "research before client meetings." Both are in the same prospecting-prep cluster. Pick a DIFFERENT cluster (compliance / pricing / team / tax / M&A / referral mechanics / fee structure / client communication / etc.).

**Level 3: Same content-type sequence.** If the last three issues were all Tactics, lean toward Take / Story / Special / Rant for variety.

## Adjacent-cluster examples to AVOID

If recent issues touched ANY of these, pick a different cluster:
- "prospecting research" / "pre-meeting prep" / "LinkedIn intel" / "discovery call prep" — all ONE cluster
- "M&A due diligence" / "earnout structure" / "buyer vetting" / "valuation multiples" — all ONE cluster
- "compliance documentation" / "WSP drift" / "SEC exam prep" / "audit readiness" — all ONE cluster
- "fee compression" / "free planning" / "pricing structure" / "AUM vs flat fee" — all ONE cluster
- "referral mechanics" / "centers of influence" / "COI strategy" — all ONE cluster

## Cluster check (REQUIRED before proposing)

Look at the most recent 5 issues' headlines and the blocked concepts. Identify which CLUSTER each touches. Then propose a topic from a DIFFERENT cluster.

Return your proposal as JSON with this exact shape:

{
  "contentType": "<one of: tactic | take | story | rant | special | ancient_truth | overlooked_destination | luxury_insider | peak_season_smart | food_first_travel | international_insider | activity_mastery | family_reality | tactical_weekend | logistics_hack | hyper_local>",
  "formatStyle": "<optional: deep_dive | quick_hits | contrarian | story | data | other>",
  "topic": "<specific topic in 8-15 words>",
  "angle": "<the specific take or treatment in 1-2 sentences>",
  "frameworkReferences": ["<framework module slugs that this topic engages>"],
  "rationale": "<1-2 sentences on why this topic now, given recent context>",
  "recentClusters": "<1 sentence naming the clusters the last 3-5 issues covered>",
  "thisIssueCluster": "<1 sentence naming the cluster this proposal belongs to — must be DIFFERENT from any in recentClusters>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
