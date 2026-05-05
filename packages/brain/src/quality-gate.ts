/**
 * Quality gate — aggregates persona panel evaluations into a pass/fail
 * decision per spec 04 § Quality Gate.
 *
 * Inputs:
 *   - 10 PersonaEvaluateOutput rows (one per persona)
 *   - benchmark thresholds (per brand, from platform_config)
 *   - hard-stop conditions (e.g. unsubscribe_probability ≥ X for any
 *     at-risk persona is an automatic fail regardless of average)
 *
 * Output: a ScoreAggregateOutput-shaped result. Pure function — no I/O,
 * no DB. Pipeline orchestrator calls this between persona panel and
 * the editor revision loop.
 */
import type { PersonaEvaluateOutput, ScoreAggregateOutput } from "@platform/schemas";

export type QualityGateBenchmarks = {
  loveRateMin: number;
  shareRateMin: number;
  churnRiskMax: number;
  /** at-risk personas count 2x in churn risk, per spec 09 */
  atRiskWeight: number;
  /** any single persona unsub ≥ this triggers a hard stop */
  hardStopUnsubProbability: number;
  /** any single persona love ≤ this triggers a hard stop */
  hardStopLoveProbability: number;
};

export const DEFAULT_BENCHMARKS: QualityGateBenchmarks = {
  loveRateMin: 65,
  shareRateMin: 30,
  churnRiskMax: 25,
  atRiskWeight: 2,
  hardStopUnsubProbability: 50,
  hardStopLoveProbability: 30,
};

type Bucketed = Record<string, { love: number[]; share: number[]; unsub: number[] }>;

function bucketBySegment(personas: PersonaEvaluateOutput[]): Bucketed {
  const buckets: Bucketed = {};
  for (const p of personas) {
    const seg = p.personaSegment;
    const b = buckets[seg] ?? { love: [], share: [], unsub: [] };
    b.love.push(p.loveProbability);
    b.share.push(p.shareProbability);
    b.unsub.push(p.unsubscribeProbability);
    buckets[seg] = b;
  }
  return buckets;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export type QualityGateInput = {
  personas: PersonaEvaluateOutput[];
  benchmarks?: QualityGateBenchmarks | undefined;
  /** weekday only — selects winning Opening Trifecta variant */
  computeTrifectaWinner?: boolean | undefined;
};

export function runQualityGate(input: QualityGateInput): ScoreAggregateOutput {
  const benchmarks = input.benchmarks ?? DEFAULT_BENCHMARKS;
  const personas = input.personas;
  if (personas.length === 0) {
    throw new Error("quality gate requires at least one persona evaluation");
  }

  const buckets = bucketBySegment(personas);
  const segmentBreakdown: ScoreAggregateOutput["segmentBreakdown"] = {};
  for (const [seg, b] of Object.entries(buckets)) {
    segmentBreakdown[seg] = {
      love: round1(avg(b.love)),
      share: round1(avg(b.share)),
      unsub: round1(avg(b.unsub)),
    };
  }

  // Aggregate love + share are simple averages.
  const loveRate = round1(avg(personas.map((p) => p.loveProbability)));
  const shareRate = round1(avg(personas.map((p) => p.shareProbability)));

  // Churn risk weights at-risk personas 2x (per spec 09).
  let weightedSum = 0;
  let totalWeight = 0;
  for (const p of personas) {
    const w = p.personaSegment === "at_risk" ? benchmarks.atRiskWeight : 1;
    weightedSum += p.unsubscribeProbability * w;
    totalWeight += w;
  }
  const churnRisk = round1(totalWeight === 0 ? 0 : weightedSum / totalWeight);

  // Hard-stop conditions: any single persona that crosses the limits.
  const hardStops: string[] = [];
  for (const p of personas) {
    if (p.unsubscribeProbability >= benchmarks.hardStopUnsubProbability) {
      hardStops.push(`unsub_hard_stop:${p.personaName}`);
    }
    if (p.loveProbability <= benchmarks.hardStopLoveProbability) {
      hardStops.push(`love_hard_stop:${p.personaName}`);
    }
  }

  // Benchmark comparison.
  const benchmarkComparison: ScoreAggregateOutput["benchmarkComparison"] = {
    love_rate: loveRate >= benchmarks.loveRateMin ? "pass" : "fail",
    share_rate: shareRate >= benchmarks.shareRateMin ? "pass" : "fail",
    churn_risk: churnRisk <= benchmarks.churnRiskMax ? "pass" : "fail",
  };

  // Common flags: any flag mentioned by ≥ 2 personas.
  const flagCounts = new Map<
    string,
    { count: number; personas: string[]; severities: Set<string> }
  >();
  for (const p of personas) {
    for (const f of p.flags) {
      const entry = flagCounts.get(f.flag) ?? { count: 0, personas: [], severities: new Set() };
      entry.count++;
      entry.personas.push(p.personaName);
      entry.severities.add(f.severity);
      flagCounts.set(f.flag, entry);
    }
  }
  const commonFlags = Array.from(flagCounts.entries())
    .filter(([, e]) => e.count >= 2)
    .map(([flag, e]) => {
      const priority = e.severities.has("block")
        ? "high"
        : e.severities.has("warn")
          ? "medium"
          : "low";
      return {
        flag,
        count: e.count,
        personas: e.personas,
        priority: priority as "low" | "medium" | "high",
      };
    });

  // Trifecta winner — pick the unspoken option with the highest
  // average vote across personas, if computeTrifectaWinner.
  let selectedUnspokenOption: ScoreAggregateOutput["selectedUnspokenOption"] | undefined;
  if (input.computeTrifectaWinner) {
    const tally: Record<string, number> = { option_1: 0, option_2: 0, option_3: 0 };
    for (const p of personas) {
      if (p.selectedUnspokenOption)
        tally[p.selectedUnspokenOption] = (tally[p.selectedUnspokenOption] ?? 0) + 1;
    }
    let winner: ScoreAggregateOutput["selectedUnspokenOption"];
    let max = -1;
    for (const [k, v] of Object.entries(tally)) {
      if (v > max) {
        max = v;
        winner = k as ScoreAggregateOutput["selectedUnspokenOption"];
      }
    }
    selectedUnspokenOption = winner;
  }

  const passed =
    hardStops.length === 0 &&
    benchmarkComparison.love_rate !== "fail" &&
    benchmarkComparison.share_rate !== "fail" &&
    benchmarkComparison.churn_risk !== "fail";

  const revisionRecommendations: string[] = [];
  if (!passed) {
    if (benchmarkComparison.love_rate === "fail") {
      revisionRecommendations.push("love rate below benchmark — sharpen voice and stakes");
    }
    if (benchmarkComparison.share_rate === "fail") {
      revisionRecommendations.push(
        "share rate below benchmark — strengthen the take or the headline",
      );
    }
    if (benchmarkComparison.churn_risk === "fail") {
      revisionRecommendations.push("churn risk above benchmark — review at-risk persona flags");
    }
    for (const stop of hardStops) revisionRecommendations.push(`hard stop: ${stop}`);
  }

  const result: ScoreAggregateOutput = {
    loveRate,
    shareRate,
    churnRisk,
    passed,
    hardStopsTriggered: hardStops,
    benchmarkComparison,
    segmentBreakdown,
    commonFlags,
    revisionRecommendations,
  };
  if (selectedUnspokenOption !== undefined) {
    result.selectedUnspokenOption = selectedUnspokenOption;
  }
  if (input.computeTrifectaWinner !== undefined) {
    result.trifectaPassed = passed && hardStops.length === 0;
  }
  return result;
}
