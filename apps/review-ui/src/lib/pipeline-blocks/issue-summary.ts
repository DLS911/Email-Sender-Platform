/**
 * Issue Summary Block
 *
 * After each issue is fully generated, write a structured AI-readable summary
 * that captures what the issue actually DID — topic, cluster, angle, scenes
 * used, frameworks applied, conclusions, takes.
 *
 * The topic_proposer reads these summaries when deciding the next issue's
 * topic. This is the "brain reads its own work" mechanism — the system
 * actually knows what's been covered, not just headlines.
 *
 * Runs at the very end of generation, after assemble_html. Haiku-based
 * (~$0.005 per call).
 */

export type IssueSummary = {
  /** Short stable slug for the topic (e.g. "discovery-call-prep", "ria-ma-earnout") */
  topicSlug: string;
  /** Cluster the issue belongs to. Topics in the same cluster shouldn't recur within 14 days. */
  cluster: string;
  /** 1-2 sentences: what was the core argument or move? */
  mainAngle: string;
  /** 3-5 bullet positions: what specific takes did this issue argue? */
  keyTakes: string[];
  /** The Unspoken's scene anchor + any character archetypes used. */
  scenesUsed: string;
  /** Which frameworks were applied (Trust Stacking, GAP, Physician Model, etc.) */
  frameworksApplied: string[];
  /** Publisher names cited in Worth Knowing */
  sourcesUsed: string[];
  /** Suggested don't-revisit-before guidance: "14 days" / "30 days" / "60 days" */
  freshAfter: string;
  /** What WOULD make this topic worth revisiting (new news, fresh angle) */
  revisitTrigger: string;
};

export type IssueSummaryInput = {
  issueDate: string;
  contentType: string;
  finalDraftJson: string;
};

function formatSection(label: string, body: string): string {
  return `## ${label}\n\n${body.trim()}`;
}

function wrapInTag(tag: string, content: string): string {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

export function buildIssueSummaryPrompt(input: IssueSummaryInput): string {
  const sections: string[] = [];

  sections.push(
    `You are writing an AI-readable summary of the Daily Grind issue dated ${input.issueDate}. This summary will be read by the topic_proposer when deciding future issues — it's how the system remembers what's been covered. Be specific. The proposer can't read between the lines.`,
  );

  sections.push(formatSection("Issue to Summarize", wrapInTag("issue_json", input.finalDraftJson)));

  sections.push(
    formatSection(
      "Cluster Reference (pick one or coin a new one)",
      `Common clusters in this brand:
- prospecting-prep — discovery calls, pre-meeting research, LinkedIn intel, COI lunches
- referral-mechanics — formal referral programs, COI relationships, organic referrals
- compliance-documentation — WSP drift, SEC exam prep, ADV updates, marketing rule
- m-and-a-buyer-vetting — buyer due diligence, earnout structures, integration risk
- m-and-a-valuation — multiples, growth-rate-vs-AUM, deal terms
- fee-and-pricing — fee compression, free planning, flat-fee vs AUM, retainers
- team-and-scaling — hiring, succession, capacity, founder bottleneck
- compliance-supervision — supervisory procedures, principal review, audit trails
- tax-scenarios — Roth conversions, year-end planning, estate transitions
- client-communication — annual reviews, market panic management, retention
- tech-and-tools — CRM evaluation, AI tools, integration sprawl
- positioning-and-niche — demographic vs transition niche, contrarian positioning

If the issue doesn't fit any of these, coin a NEW cluster name (lowercase-hyphen-form).`,
    ),
  );

  sections.push(
    formatSection(
      "Output Format",
      `Return the summary as JSON:

{
  "topicSlug": "<short stable slug, e.g. 'discovery-call-research' or 'earnout-buyer-vetting'>",
  "cluster": "<cluster name from list above OR a new one>",
  "mainAngle": "<1-2 sentences on the core argument or move this issue made>",
  "keyTakes": [
    "<specific position 1>",
    "<specific position 2>",
    "<specific position 3>",
    "..."
  ],
  "scenesUsed": "<describe the Unspoken's scene + any specific character archetypes — e.g. 'Capital Grille dinner with PE buyer, $340 Porterhouse, declining to ask follow-up about CRM integration'>",
  "frameworksApplied": ["<framework module name, if any>"],
  "sourcesUsed": ["<publisher name from Worth Knowing>"],
  "freshAfter": "<'14 days' | '30 days' | '60 days' | '90 days' — how long before the same cluster can recur>",
  "revisitTrigger": "<1 sentence on what would make this cluster worth revisiting earlier — e.g. 'major SEC enforcement action specifically against RIAs in M&A integrations'>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
