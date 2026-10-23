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
  /** Cluster this issue belongs to (from issue_summary). */
  cluster?: string;
  /** Core argument/angle of the issue (from issue_summary). */
  mainAngle?: string;
  /** Specific positions the issue argued (from issue_summary). */
  keyTakes?: string[];
  /** Scene + character archetypes used in the Unspoken (from issue_summary). */
  scenesUsed?: string;
  /** Frameworks the issue applied (from issue_summary). */
  frameworksApplied?: string[];
  /** Don't-revisit-before window (from issue_summary), e.g. "30 days". */
  freshAfter?: string;
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
  /**
   * When true, the proposer is instructed that a `chronicle` content type
   * is DUE this issue — historical advisor-industry drama. Set by the
   * caller when none of the last 4 issues used chronicle. Keeps the
   * drip of history-book-reads-like-a-thriller issues at ~1-in-4.
   */
  chronicleDue?: boolean;
  /**
   * HARD LOCK on contentType. When set, the proposer MUST use this
   * contentType — no model freedom to pick something else. Mirrors
   * formatStyleOverride. Previously `chronicleDue` was a soft hint
   * that the writer ignored (10-08 came back as a tactic when we asked
   * for chronicle). This is the enforcement layer.
   */
  contentTypeOverride?: "tactic" | "take" | "story" | "rant" | "special" | "chronicle";
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
    // Two views: (1) the headline list (quick scan), (2) the structured
    // summaries (deep read). The proposer needs BOTH — the list shows the
    // cluster pattern at a glance; the summaries show what was actually
    // argued so the proposer can reason about whether a topic would be a
    // re-tread or a genuinely fresh angle.
    const recentList = input.recentIssues.slice(0, 30).map((issue) => {
      const fmt = issue.formatStyle ? ` [${issue.formatStyle}]` : "";
      const clusterTag = issue.cluster ? ` {cluster: ${issue.cluster}}` : "";
      return `${issue.publishedAt.slice(0, 10)} — ${issue.contentType}${fmt}: ${issue.topic}${clusterTag}`;
    });
    sections.push(formatSection("Recent Issues (most recent first)", formatBulletList(recentList)));

    const withSummaries = input.recentIssues.filter(
      (i) => i.mainAngle || i.cluster || (i.keyTakes && i.keyTakes.length > 0),
    );
    if (withSummaries.length > 0) {
      const summaryBlocks = withSummaries.slice(0, 15).map((issue) => {
        const lines: string[] = [];
        lines.push(`### ${issue.publishedAt.slice(0, 10)} — ${issue.topic}`);
        if (issue.cluster) lines.push(`**Cluster:** ${issue.cluster}`);
        if (issue.mainAngle) lines.push(`**Angle:** ${issue.mainAngle}`);
        if (issue.keyTakes && issue.keyTakes.length > 0) {
          lines.push(`**Key takes:**\n${issue.keyTakes.map((t) => `- ${t}`).join("\n")}`);
        }
        if (issue.scenesUsed) lines.push(`**Scene used:** ${issue.scenesUsed}`);
        if (issue.frameworksApplied && issue.frameworksApplied.length > 0) {
          lines.push(`**Frameworks:** ${issue.frameworksApplied.join(", ")}`);
        }
        if (issue.freshAfter) lines.push(`**Don't revisit before:** ${issue.freshAfter}`);
        return lines.join("\n");
      });
      sections.push(
        formatSection(
          "Past Issue Summaries (read these — this is what's actually been argued)",
          summaryBlocks.join("\n\n"),
        ),
      );
    }
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

  // HARD LOCK — put at the very front of the task area so it shadows every
  // soft hint below. The proposer treats this as absolute, no interpretation.
  if (input.contentTypeOverride) {
    const ct = input.contentTypeOverride;
    sections.push(
      formatSection(
        `⚠️ MANDATORY CONTENT TYPE — ${ct.toUpperCase()} (LOCKED, NOT NEGOTIABLE)`,
        `This issue's contentType has been EXPLICITLY LOCKED to "${ct}" by the caller. You MUST set contentType="${ct}" in your output. You do NOT have discretion to pick a different contentType — not tactic, not take, not story, not anything else. Your job is to find the best SPECIFIC topic + angle within the ${ct} content type.

${
  ct === "chronicle"
    ? "A chronicle is a historical advisor-industry drama: SEC adjudication, FINRA bar, settled RIA/broker-dealer scandal, written as a drama novel chapter. Scope stays RIA/broker-dealer/wealth-management. Candidates (not exhaustive): Allen Stanford ($8B CDs), Madoff feeder funds (Fairfield Greenwich, Tremont, Fairfield Sentry), Nicholas Cosmo, Scott Rothstein, Edward Jones conflicts, LPL compliance findings, Woodbridge Group ($1.3B Ponzi), GPB Capital, pre-fiduciary-era suitability lapses. Topic = case + angle. Angle names the historical lens AND the modern parallel. Set contentType=\"chronicle\" and formatStyle=\"story\" (narrative fits chronicles)."
    : ""
}

If you return a different contentType, your output will be REJECTED and regenerated.`,
      ),
    );
  }

  if (input.chronicleDue && !input.contentTypeOverride) {
    sections.push(
      formatSection(
        "Content Type Due This Issue — CHRONICLE",
        `A \`chronicle\` content type is DUE for this issue. None of the last 4 issues used chronicle, and the rotation calls for one now.

A chronicle is a historical advisor-industry drama: a specific past event (SEC enforcement action, FINRA disciplinary case, major RIA / broker-dealer scandal, famous ethical failure, pre-fiduciary-rule bad advice that compounded) told as a story — a history book written like a thriller. Named characters where public record (adjudicated plea / settlement / barring order), "allegedly" where unresolved, anonymized where private.

**Scope**: RIA / broker-dealer / wealth-management ONLY. No banks-as-banks, no non-advisor hedge funds. Candidates to consider (not exhaustive): Allen Stanford ($8B CD fraud), Madoff feeder funds (Fairfield Greenwich, Tremont, Fairfield Sentry), Nicholas Cosmo, Charles Erhart, Scott Rothstein's law-firm-adjacent advising, Edward Jones conflicts of interest settlements, LPL Financial compliance findings, pre-fiduciary-era suitability lapses, Woodbridge Group of Companies ($1.3B Ponzi), GPB Capital.

**Your task for this chronicle**: propose a SPECIFIC historical case + the SPECIFIC angle Mark takes on it + the modern-day pattern it illustrates. Set contentType="chronicle". Topic is the case + angle (e.g. "Allen Stanford's $8B CDs: how the custom-benchmark reporting pattern survived him"). Angle names the historical lens AND the modern parallel.`,
      ),
    );
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

Variety matters at FOUR levels, not just one:

**Level 1: Same exact topic.** Obviously don't repeat. (Easy.)

**Level 2: Adjacent topic in the same theme cluster.** If yesterday was about "discovery call preparation," today should NOT be about "research before client meetings." Both are in the same prospecting-prep cluster. Pick a DIFFERENT cluster (compliance / pricing / team / tax / M&A / referral mechanics / fee structure / client communication / etc.).

**Level 3: Same content-type sequence.** If the last three issues were all Tactics, lean toward Take / Story / Special / Rant for variety.

**Level 4 — DOMAIN ROTATION (added 10-16 after 11 consecutive DGs all converged on client-attrition/silence/engagement — different "clusters" by narrow definition, one theme by reader perception).** The advisor practice spans ~16 DOMAINS. If any of the last 5 issues touched a given DOMAIN, this issue MUST come from a DIFFERENT DOMAIN. Treat this as a HARD RULE on top of cluster rotation.

The DOMAINS:
1. **Client retention / attrition / engagement / "silence"** — reader-perceived as "clients leaving"
2. **Investment management** — portfolio construction, factor investing, asset allocation, rebalancing, direct indexing, alternatives
3. **Tax strategy** — RMDs, Roth conversions, tax-loss harvesting, QCDs, state-residency games, trust taxation
4. **Estate planning** — SLATs, GRATs, dynasty trusts, generation-skipping, beneficiary design, step-up basis, charitable
5. **Insurance** — whole life, LTC, DI, annuities (SPIAs, DIAs, QLACs), premium financing
6. **Behavioral finance / client psychology** — loss aversion, present bias, status, narrative identity
7. **Operations / tech stack** — CRM, planning software (RightCapital, eMoney, MoneyGuide), AI tools, workflow automation, outsourced CIO
8. **Growth / marketing** (NOT just referrals) — SEO, content, podcast, speaking, PR, LinkedIn, email list building
9. **Compliance / regulatory** — SEC exam, FINRA, Reg BI, DOL fiduciary rule, custody rule, marketing rule
10. **Fee models / pricing** — AUM vs flat vs retainer, flat-fee for high-net-worth, planning-only fees
11. **Succession / M&A / buy-sell** — valuation, earnouts, continuity plans, buyer vetting, aggregator deals
12. **Next-gen / wealth transfer** — bringing adult children into relationship, educating heirs, inheritance timing
13. **Macro / markets / cycles** — rate expectations, duration, credit spreads, currency, geopolitical risk framing
14. **Firm building / team** — hiring associate advisors, operations hires, equity for partners, culture, physician model
15. **Fiduciary ethics / stance** — contrarian positions, standing against industry defaults
16. **Client experience / service model** — ONE domain, do not sub-divide into "touchpoints" vs "annual review" vs "service tiers" to escape the rotation rule

**Domain rotation example of what BREAKS the rule:** Last 3 issues were "service model works for 15% of your book" (Domain 1 or 16), "advisors show up to advise decisions clients already made" (Domain 1 or 16), "annual review surfaces what silence broke" (Domain 1 or 16). This issue proposing "Ask one question before you lose them" (Domain 1) is a VIOLATION — four in a row from the same reader-perceived domain. Pick Domain 3 (tax) or Domain 7 (ops/tech) or Domain 13 (macro) instead.

## Framing / Tone rotation — read carefully

Separate from topic, every issue has an EMOTIONAL REGISTER. For the 3-week A/B window started 2026-10-21, **problem-identification framing is HARD BANNED**. Pick ONE of the five allowed framings instead:

- **BANNED (next 3 weeks)**: ~~Problem-identification~~ — "here's what you're missing / losing / breaking". Mark feedback 2026-10-21: "the ai is pushing for negative because its 'captivating' but that not what we want". Readers already open at 30%+; the hook is not the issue; they trust Mark when he teaches, not when he scolds.
- **Opportunity** — "here's an edge most advisors are ignoring; here's how to capture it"
- **Celebration / win-story** — "here's an advisor who built something unusual, and how"
- **Observation / insight** — "here's a pattern in the data; here's the move it suggests"
- **Instruction / craft** — "here's exactly how to execute the thing"
- **Contrarian** — "the industry says X; the opposite is defensible AND more profitable" (contrarian must point to an UPSIDE, not just name a flaw)

HEADLINE patterns BANNED for this window (reject your own proposal if the headline you'd write fits any of these):
- "X isn't Y, it's Z" (deflating comparison, e.g. "Your book isn't 150 clients. It's 60.")
- "Your X is broken / dead / wrong / failing"
- "What X doesn't see / know / notice"
- "The X you're missing / losing / forgetting"
- "The gap between X and Y"
- "Stop / Quit / Don't X"
- "Why your X is wrong / broken"
- Any headline that primarily tells the reader they are failing at something

HEADLINE patterns PREFERRED for this window:
- "How to X" (instruction)
- "The upgrade: X" (opportunity)
- "The move that pays back by Y" (quantified upside)
- "The N-minute Monday habit that unlocks Z" (compounding move)
- "What top advisors do when Y" (celebration/pattern)
- "The X that compounds / scales / pays off" (positive compounding)
- "How one advisor Y" (case study / win)

Mark's voice stays sharp, specific, opinionated. Direct ≠ negative. "Here is the exact move" is sharp AND positive. "The three CRM fields that predict closes" is specific AND positive. If you can't propose a positive-framed topic in a given domain, pick a different domain — don't fall back to problem-identification.

## HARD BAN — clusters that are OFF-LIMITS this window (added 2026-10-23)

The following clusters are STRUCTURALLY defensive/threat-oriented regardless of how you phrase the headline. Do NOT propose a topic in any of these clusters during the current positive-framing window. A proposal that lands here will be rejected and you will be re-prompted:

- **compliance-documentation** — "document the gap before the claim arrives", "the defensible file", "errors and omissions", "liability protection", "knowing negligence", "protection gap", any topic about generating paperwork to defend against future enforcement/suit.
- **compliance-supervision** — "audit trail", "ongoing verification", "supervisory procedure", "principal review", "insurance audit", any topic framing documentation as what-catches-you-if-you're-wrong.
- **client-communication** attrition/silence — "the questions that mean she's already left", "your best clients stopped showing up", "client retention", "the silence", "went quiet", "didn't show up to the review", any topic about losing clients or missing engagement signals.
- **team-and-scaling** capacity-ceiling — "your book isn't 150 clients", "capacity ceiling", "founder bottleneck", "burnout", "structurally built to serve X", any topic framing team/capacity as a trap or ceiling.

These clusters produce defensive content even when the headline uses positive verbs ("document", "verify", "protect"). The reader-facing register is still "something is going to go wrong unless you do X." That's problem-identification, which Mark banned this window.

If your natural instinct is pulling toward one of these — stop and ask: what's a GROWTH or INSTRUCTION topic in a DIFFERENT domain the reader can act on this week? Pick that instead. Tax strategy, estate planning, growth channels (SEO/podcast/speaking), investment management, pricing/fee models, succession/M&A as opportunity, operations/tech-stack as efficiency — these are the live domains.

## HARD CHECK before you submit — read this twice

Your LLM training biases you STRONGLY toward problem-identification because that framing wins engagement on generic internet copy (newsletters, blogs, social). This audience is DIFFERENT. They already open at 30%+ and have the context to recognize fluff. Three framings they REJECT, confirmed from reader feedback:

1. **"The X that proves/reveals/shows you Y"** — compliance-threat / exposure frames dressed as revelation. BANNED. Example of what Mark explicitly flagged on 2026-10-21: "The file that proves you knew" was rejected as too negative.
2. **"X isn't Y, it's Z"** — deflating comparison. BANNED. Example of what Mark flagged: "Your book isn't 150 clients. It's 60."
3. **"The hidden cost/price/tax of X"** — reveals-a-threat frames. BANNED.

If your proposal's headline matches ANY of these shapes, PICK A DIFFERENT TOPIC. Do not try to repackage the same topic with a slightly less negative headline — the underlying angle IS the problem. Pick a genuinely positive topic: a specific move an advisor can MAKE that produces a specific GAIN (dollars, time, closed clients, better hires, a repositioning win).

If the proposer's natural instinct is pulling toward a diagnostic/compliance/exposure topic, STOP and ask: "What's an UPSIDE topic in a totally different domain?" Pick that instead. Tax, investment management, growth/marketing, operations, insurance, estate — pick a domain where "here's the move that unlocks dollars" is the natural frame, not "here's the trap you didn't see."

## Adjacent-cluster examples to AVOID

If recent issues touched ANY of these, pick a different cluster:
- "prospecting research" / "pre-meeting prep" / "LinkedIn intel" / "discovery call prep" — all ONE cluster
- "M&A due diligence" / "earnout structure" / "buyer vetting" / "valuation multiples" — all ONE cluster
- "compliance documentation" / "WSP drift" / "SEC exam prep" / "audit readiness" — all ONE cluster
- "fee compression" / "free planning" / "pricing structure" / "AUM vs flat fee" — all ONE cluster
- "referral mechanics" / "centers of influence" / "COI strategy" — all ONE cluster

## Cluster check (REQUIRED before proposing)

Look at the most recent 5 issues' headlines AND their Past Issue Summaries (cluster + angle + key takes). Identify which CLUSTER each touches. Then propose a topic from a DIFFERENT cluster.

**The summaries are not optional reading.** Two issues can have very different headlines and still be the same argument re-skinned. If a past summary's "Angle" or "Key takes" overlaps with what you're about to propose — even if your headline sounds different — that's a re-tread. Pick something else.

**Override condition:** If breaking news in this morning's research makes a recent cluster genuinely worth revisiting (e.g., SEC enforcement action specifically against M&A integrations a week after we ran an M&A cluster issue), you MAY return to that cluster — but only if you can name a NEW angle the past summaries didn't cover, and you state that explicitly in your rationale. Default is to pick a fresh cluster.

Return your proposal as JSON with this exact shape:

{
  "contentType": "<one of: tactic | take | story | rant | special | ancient_truth | overlooked_destination | luxury_insider | peak_season_smart | food_first_travel | international_insider | activity_mastery | family_reality | tactical_weekend | logistics_hack | hyper_local>",
  "formatStyle": "<optional: deep_dive | quick_hits | contrarian | story | data | other>",
  "topic": "<specific topic in 8-15 words>",
  "angle": "<the specific take or treatment in 1-2 sentences>",
  "frameworkReferences": ["<framework module slugs that this topic engages>"],
  "rationale": "<1-2 sentences on why this topic now, given recent context>",
  "recentClusters": "<1 sentence naming the clusters the last 3-5 issues covered>",
  "thisIssueCluster": "<1 sentence naming the cluster this proposal belongs to — must be DIFFERENT from any in recentClusters>",
  "recentDomains": "<comma-separated DOMAIN numbers (1-16 from the DOMAIN list above) covered by each of the last 5 issues, oldest→newest>",
  "thisIssueDomain": "<the DOMAIN number (1-16) this proposal belongs to — must NOT appear in recentDomains>",
  "recentFramings": "<comma-separated framings (problem-identification | opportunity | celebration | observation | instruction | contrarian) used by each of the last 3 issues, oldest→newest>",
  "thisIssueFraming": "<the framing this proposal uses — if the last 3 were all problem-identification, this one MUST be opportunity | celebration | observation | instruction | contrarian>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
