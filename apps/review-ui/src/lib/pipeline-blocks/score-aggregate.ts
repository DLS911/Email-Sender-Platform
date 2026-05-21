/**
 * Score Aggregate Block — pure function (no LLM)
 *
 * Combines the 10 persona evaluations into a verdict. Per the spec:
 * - love_rate = count(loveRating==true) / 10
 * - voice_fit_avg = average of voice fit scores (excellent=1.0, good=0.8,
 *   acceptable=0.6, drift=0.4, failure=0.0)
 * - weighted_unsubscribe_prob = sum(p.unsubscribe * persona.churnWeight) / total_weight
 *   where at_risk personas (Veteran, Compliance-Conscious) get 2x weight
 *
 * Benchmarks per content type:
 * | Content Type | Love Rate | Share Rate | Churn Risk |
 * |---|---|---|---|
 * | Tactic | ≥65% | ≥45% | ≤10% |
 * | Take | ≥58% | ≥40% | ≤12% |
 * | Story | ≥50% | ≥35% | ≤15% |
 * | Rant | — | — | — (uses Tactic floor) |
 * | Special | ≥55% | ≥38% | ≤12% |
 *
 * Hard stops (automatic fail):
 * - Any persona's unsubscribe_probability > 40%
 * - Any segment's average love_rate < 25%
 */

import type { PersonaEvaluation } from "./persona-evaluate";
import { PERSONAS } from "./personas";

const VOICE_FIT_SCORES = {
  excellent: 1.0,
  good: 0.8,
  acceptable: 0.6,
  drift: 0.4,
  failure: 0.0,
} as const;

const BENCHMARKS: Record<
  string,
  { loveRate: number; shareRate: number; churnRisk: number }
> = {
  tactic: { loveRate: 0.65, shareRate: 0.45, churnRisk: 0.10 },
  take: { loveRate: 0.58, shareRate: 0.40, churnRisk: 0.12 },
  story: { loveRate: 0.50, shareRate: 0.35, churnRisk: 0.15 },
  rant: { loveRate: 0.65, shareRate: 0.45, churnRisk: 0.10 },
  special: { loveRate: 0.55, shareRate: 0.38, churnRisk: 0.12 },
};

export type ScoreAggregateResult = {
  verdict: "pass" | "pass_with_concerns" | "fail";
  summary: string;
  metrics: {
    loveRate: number;
    shareRate: number;
    weightedUnsubscribeProb: number;
    voiceFitAvg: number;
    panelSize: number;
  };
  benchmarks: { loveRate: number; shareRate: number; churnRisk: number };
  hardStops: string[];
  benchmarkResults: {
    loveRatePassed: boolean;
    shareRatePassed: boolean;
    churnRiskPassed: boolean;
  };
  perPersonaSummary: Array<{
    persona: string;
    open: number;
    love: boolean;
    voiceFit: string;
    flagCount: number;
    unsubscribe: number;
  }>;
};

export function scoreAggregate(
  evaluations: PersonaEvaluation[],
  contentType: string,
): ScoreAggregateResult {
  const panelSize = evaluations.length;
  if (panelSize === 0) {
    return {
      verdict: "fail",
      summary: "No persona evaluations completed",
      metrics: {
        loveRate: 0,
        shareRate: 0,
        weightedUnsubscribeProb: 1,
        voiceFitAvg: 0,
        panelSize: 0,
      },
      benchmarks: BENCHMARKS[contentType] ?? BENCHMARKS.tactic!,
      hardStops: ["zero_evaluations"],
      benchmarkResults: { loveRatePassed: false, shareRatePassed: false, churnRiskPassed: false },
      perPersonaSummary: [],
    };
  }

  // love_rate: fraction of personas who loved the issue
  const loveCount = evaluations.filter((e) => e.loveRating).length;
  const loveRate = loveCount / panelSize;

  // share_rate: average forward probability (approximation of share intent)
  const shareRate = evaluations.reduce((acc, e) => acc + e.probabilities.forward, 0) / panelSize;

  // weighted_unsubscribe_prob: at-risk personas get 2x weight
  let unsubNumerator = 0;
  let unsubWeightSum = 0;
  for (const evaluation of evaluations) {
    const persona = PERSONAS.find((p) => p.slug === evaluation.personaSlug);
    const weight = persona?.churnWeight ?? 1.0;
    unsubNumerator += evaluation.probabilities.unsubscribe * weight;
    unsubWeightSum += weight;
  }
  const weightedUnsubscribeProb = unsubWeightSum > 0 ? unsubNumerator / unsubWeightSum : 0;

  // voice_fit_avg
  const voiceFitAvg =
    evaluations.reduce(
      (acc, e) => acc + (VOICE_FIT_SCORES[e.voiceFit] ?? 0),
      0,
    ) / panelSize;

  // Hard stops
  const hardStops: string[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.probabilities.unsubscribe > 0.4) {
      hardStops.push(
        `${evaluation.personaSlug} unsubscribe_prob ${evaluation.probabilities.unsubscribe.toFixed(2)} > 0.40`,
      );
    }
  }

  // Benchmarks for this content type
  const bench = BENCHMARKS[contentType] ?? BENCHMARKS.tactic!;

  const benchmarkResults = {
    loveRatePassed: loveRate >= bench.loveRate,
    shareRatePassed: shareRate >= bench.shareRate,
    churnRiskPassed: weightedUnsubscribeProb <= bench.churnRisk,
  };

  const missedCount = Object.values(benchmarkResults).filter((p) => !p).length;

  let verdict: "pass" | "pass_with_concerns" | "fail";
  if (hardStops.length > 0) {
    verdict = "fail";
  } else if (missedCount === 0) {
    verdict = "pass";
  } else if (missedCount === 1) {
    verdict = "pass_with_concerns";
  } else {
    verdict = "fail";
  }

  const summary = [
    `Panel of ${panelSize}.`,
    `Love rate: ${(loveRate * 100).toFixed(0)}% (target ≥${(bench.loveRate * 100).toFixed(0)}%) ${benchmarkResults.loveRatePassed ? "✓" : "✗"}`,
    `Share rate: ${(shareRate * 100).toFixed(0)}% (target ≥${(bench.shareRate * 100).toFixed(0)}%) ${benchmarkResults.shareRatePassed ? "✓" : "✗"}`,
    `Churn risk: ${(weightedUnsubscribeProb * 100).toFixed(1)}% (target ≤${(bench.churnRisk * 100).toFixed(0)}%) ${benchmarkResults.churnRiskPassed ? "✓" : "✗"}`,
    `Voice fit avg: ${(voiceFitAvg * 100).toFixed(0)}/100.`,
  ].join(" ");

  const perPersonaSummary = evaluations.map((e) => ({
    persona: e.personaSlug,
    open: e.probabilities.open,
    love: e.loveRating,
    voiceFit: e.voiceFit,
    flagCount: e.flags.length,
    unsubscribe: e.probabilities.unsubscribe,
  }));

  return {
    verdict,
    summary,
    metrics: {
      loveRate,
      shareRate,
      weightedUnsubscribeProb,
      voiceFitAvg,
      panelSize,
    },
    benchmarks: bench,
    hardStops,
    benchmarkResults,
    perPersonaSummary,
  };
}
