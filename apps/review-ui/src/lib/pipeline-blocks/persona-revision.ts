/**
 * Persona-Driven Revision Block
 *
 * When score_aggregate returns verdict=fail, this block takes the per-persona
 * feedback (who didn't love it, what they flagged, what they said) and
 * generates a revision request that addresses the specific complaints.
 *
 * Then the writer's existing editor_revision pathway is used to actually
 * apply the changes. This module just builds the structured complaint
 * digest into a high-signal revision prompt.
 *
 * Runs only when verdict=fail AND there is still revision budget.
 */

import type { PersonaEvaluation } from "./persona-evaluate";
import type { ScoreAggregateResult } from "./score-aggregate";

export type PersonaRevisionPrompt = {
  /** The structured revision request the editor_revision block will use. */
  revisionRequest: string;
  /** The top complaints surfaced (for trace logging). */
  complaints: Array<{
    persona: string;
    didNotLove: boolean;
    severityFlags: string[];
    reaction: string;
  }>;
  /** Summary of what the revision is being asked to fix. */
  prioritizedFixes: string[];
};

/**
 * Build a revision prompt from per-persona feedback. Prioritizes:
 * 1. Personas that did NOT love it (loveRating === false)
 * 2. High-severity flags first
 * 3. Specific reactions over generic ones
 */
export function buildPersonaRevisionPrompt(
  evaluations: PersonaEvaluation[],
  score: ScoreAggregateResult,
): PersonaRevisionPrompt {
  // Sort by impact: didn't-love + high-severity flags first
  const sorted = [...evaluations].sort((a, b) => {
    const aSev = a.flags.filter((f) => f.severity === "high").length;
    const bSev = b.flags.filter((f) => f.severity === "high").length;
    const aScore = (a.loveRating ? 0 : 10) + aSev * 3 + a.flags.length;
    const bScore = (b.loveRating ? 0 : 10) + bSev * 3 + b.flags.length;
    return bScore - aScore;
  });

  // Take top 5 most-critical perspectives
  const top = sorted.slice(0, 5);

  const complaints = top.map((e) => ({
    persona: e.personaSlug,
    didNotLove: !e.loveRating,
    severityFlags: e.flags
      .filter((f) => f.severity === "high" || f.severity === "medium")
      .map((f) => `[${f.severity}] ${f.trigger}: ${f.specificInstance}`),
    reaction: e.specificReaction,
  }));

  // Collect specific high-severity issues into prioritized fix list
  const fixSet = new Set<string>();
  for (const e of top) {
    for (const flag of e.flags) {
      if (flag.severity === "high") {
        fixSet.add(`Fix: ${flag.specificInstance} (flagged by ${e.personaSlug} as ${flag.trigger})`);
      }
    }
  }
  // Add benchmark-driven fixes
  if (!score.benchmarkResults.loveRatePassed) {
    fixSet.add(
      `Improve love rate: only ${(score.metrics.loveRate * 100).toFixed(0)}% loved it vs target ≥${(score.benchmarks.loveRate * 100).toFixed(0)}%. Look at the specific complaints below to understand why.`,
    );
  }
  // Share rate is informational only — not a revision target.
  if (!score.benchmarkResults.churnRiskPassed) {
    fixSet.add(
      `Reduce churn risk: ${(score.metrics.weightedUnsubscribeProb * 100).toFixed(1)}% weighted unsubscribe prob vs ceiling ≤${(score.benchmarks.churnRisk * 100).toFixed(0)}%. Something here is alienating at-risk personas — look at high-severity flags below.`,
    );
  }
  const prioritizedFixes = Array.from(fixSet);

  // Build the structured revision prompt
  const complaintsBlock = complaints
    .map((c) => {
      const lines = [`### ${c.persona}${c.didNotLove ? " (DID NOT LOVE IT)" : ""}`];
      if (c.severityFlags.length > 0) {
        lines.push(`**Flags:**`);
        for (const flag of c.severityFlags) lines.push(`- ${flag}`);
      }
      lines.push(`**Their actual reaction:** "${c.reaction}"`);
      return lines.join("\n");
    })
    .join("\n\n");

  const revisionRequest = `The persona panel of 10 advisor readers evaluated this draft and ${score.verdict === "fail" ? "FAILED IT" : "raised concerns"}.

## Aggregate metrics
- Love rate: ${(score.metrics.loveRate * 100).toFixed(0)}% (target ≥${(score.benchmarks.loveRate * 100).toFixed(0)}%) ${score.benchmarkResults.loveRatePassed ? "✓" : "✗"}
- Churn risk: ${(score.metrics.weightedUnsubscribeProb * 100).toFixed(1)}% (ceiling ≤${(score.benchmarks.churnRisk * 100).toFixed(0)}%) ${score.benchmarkResults.churnRiskPassed ? "✓" : "✗"}
- Share rate: ${(score.metrics.shareRate * 100).toFixed(0)}% (informational only, not a revision target)

## What needs to change (in order of priority)

${prioritizedFixes.map((f) => `- ${f}`).join("\n") || "- General quality lift — see persona feedback below."}

## What the most-critical readers actually said

${complaintsBlock}

## Revise the draft

Rewrite the draft to directly address these specific complaints. Do NOT just paraphrase — produce content that would change the love rating to YES from the personas above. Hold the topic, the angle, and the structure. Adjust:
- The Unspoken's specificity (named character, single moment, dollar punchline, quotable line)
- The earned-line quality in main content
- The framework application (less generic, more concrete)
- Anything specifically flagged above

Return the COMPLETE revised draft in the same JSON shape as the input. Do not change the schema.`;

  return { revisionRequest, complaints, prioritizedFixes };
}
