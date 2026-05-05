/**
 * Score Aggregate Block
 *
 * Combines the 10 persona evaluations into an aggregate pass/fail verdict
 * for the issue. Applies the calibration weights from each persona module.
 *
 * Pass/fail criteria (from the original score_aggregator system prompt and
 * spec 03 voice system):
 * - love_rate (count of personas who said loveRating: true / 10) ≥ threshold
 * - average_voice_fit ≥ threshold
 * - aggregate_unsubscribe_probability (with at-risk personas weighted 2x) ≤ threshold
 * - high-severity flag count from at-risk personas ≤ threshold
 *
 * The block does NOT prevent publication; it produces a verdict that the
 * orchestrator uses to decide whether to send, hold for revision, or skip.
 *
 * Flag categorization is informational, not blocking. From the principles:
 * "If aggregate metrics pass benchmarks, the content passes — regardless
 * of individual persona flags or complaints."
 */

import { formatSection, wrapInTag } from "../_shared/formatters";

export type PersonaEvaluation = {
  personaSlug: string;
  probabilities: {
    open: number;
    readToCompletion: number;
    click: number;
    reply: number;
    forward: number;
    unsubscribe: number;
  };
  loveRating: boolean;
  voiceFit: "excellent" | "good" | "acceptable" | "drift" | "failure";
  flags: Array<{
    trigger: string;
    specificInstance: string;
    severity: "high" | "medium" | "low";
  }>;
  specificReaction: string;
};

export type ScoreAggregateInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  contentType: string;
  personaEvaluations: PersonaEvaluation[]; // expected length: 10
  benchmarks: {
    minLoveRate: number; // e.g. 0.5 (5 of 10 personas love it)
    minVoiceFit: number; // e.g. 0.7 (average voice fit ≥ "good" tier)
    maxAggregateUnsubscribeProbability: number; // e.g. 0.05
    maxHighSeverityFlagsFromAtRisk: number; // e.g. 2
  };
  atRiskPersonaSlugs: string[]; // typically ["veteran", "compliance-conscious"]
};

/**
 * Build the user prompt for the score aggregate block.
 *
 * Note: this block is largely deterministic computation — the prompt is
 * mostly to have the LLM produce the structured verdict and human-readable
 * summary. The actual math (love rate, weighted averages, flag categorization)
 * could be computed in code; the LLM adds qualitative summary and reasoning.
 */
export function buildScoreAggregatePrompt(input: ScoreAggregateInput): string {
  const sections: string[] = [];

  sections.push(
    `You are aggregating the persona panel's evaluations into a pass/fail verdict for the ${input.edition} issue dated ${input.issueDate}. The orchestrator uses your verdict to decide whether to send, revise, or skip the issue.`,
  );

  sections.push(
    formatSection(
      "Persona Panel Evaluations",
      wrapInTag("evaluations_json", JSON.stringify(input.personaEvaluations, null, 2)),
    ),
  );

  sections.push(
    formatSection(
      "Benchmarks",
      `- Minimum love rate: ${input.benchmarks.minLoveRate} (i.e. at least ${Math.ceil(input.benchmarks.minLoveRate * 10)} of 10 personas should love the issue)
- Minimum voice fit: ${input.benchmarks.minVoiceFit} on the 0-1 scale (where excellent=1.0, good=0.8, acceptable=0.6, drift=0.4, failure=0.0)
- Maximum aggregate unsubscribe probability: ${input.benchmarks.maxAggregateUnsubscribeProbability} (with at-risk personas weighted 2x)
- Maximum high-severity flags from at-risk personas: ${input.benchmarks.maxHighSeverityFlagsFromAtRisk}

At-risk personas (whose unsubscribe probability is weighted 2x): ${input.atRiskPersonaSlugs.join(", ")}`,
    ),
  );

  sections.push(
    formatSection(
      "Aggregation Method",
      `**Love rate:** Count personas with loveRating: true. Divide by 10. Compare to benchmark.

**Voice fit average:** Convert each persona's voiceFit to 0-1 scale (excellent=1.0, good=0.8, acceptable=0.6, drift=0.4, failure=0.0). Average across the 10 personas. Compare to benchmark.

**Aggregate unsubscribe probability:** For each persona, take their unsubscribe probability. For at-risk personas, multiply by 2. Sum all weighted probabilities. Divide by total weight (8 + 2 + 2 = 12 if 2 at-risk personas). Compare to benchmark.

**High-severity flag count from at-risk personas:** Count flags with severity "high" raised by at-risk personas. Compare to benchmark.

**Pass/fail decision:**
- If ALL four benchmarks are met: verdict is "pass"
- If 1 benchmark is missed by a small margin: verdict is "pass_with_concerns" (publish but flag for review)
- If 2+ benchmarks are missed, or any benchmark is missed badly: verdict is "fail" (revise or skip)

**Note from editorial principles:**
Persona flags are LOGGED for informational purposes. They do NOT, individually, block publication. Multiple personas flagging the SAME issue is informational signal — pattern recognition for editorial. But if aggregate metrics pass, the content passes. Don't override the math with vibes.`,
    ),
  );

  sections.push(
    formatSection(
      "Output Format",
      `Return the aggregate verdict as JSON:

{
  "verdict": "pass | pass_with_concerns | fail",
  "metrics": {
    "loveRate": <0.0 to 1.0>,
    "voiceFitAverage": <0.0 to 1.0>,
    "weightedUnsubscribeProbability": <0.0 to 1.0>,
    "highSeverityFlagsFromAtRisk": <integer>
  },
  "benchmarkMisses": [
    {
      "benchmark": "<benchmark name>",
      "actual": <number>,
      "required": <number>,
      "marginType": "small | significant | large"
    }
  ],
  "flagSummary": {
    "totalFlags": <integer>,
    "highSeverityFlags": <integer>,
    "patternsAcrossPersonas": ["<pattern flagged by 2+ personas>"]
  },
  "qualitativeSummary": "<2-3 sentences summarizing the panel's collective reception>",
  "publishRecommendation": "<send | hold_for_revision | skip>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
