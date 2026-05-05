/**
 * Variety enforcement — primitives that prevent the optimizer from
 * collapsing into a local maximum (per spec 05 § Variety Enforcement).
 *
 * The brain queries these to bound what the learning loop can recommend.
 * Pure functions — no I/O. Inputs come from queries against block_executions
 * and content_concepts.
 */

export type VarietyInput = {
  /** content types used in the last N issues, most recent first */
  recentContentTypes: string[];
  /** framework families used in the last N issues, most recent first */
  recentFrameworkFamilies: string[];
  /** persona segments that have been "led" recently */
  recentLeadingPersonas: string[];
  /** total issues considered in the lookback */
  lookbackCount: number;
};

export type VarietyConstraints = {
  /** no content type can occupy more than this fraction of recent issues */
  contentTypeMaxFraction: number;
  /** no framework family can occupy more than this fraction */
  frameworkFamilyMaxFraction: number;
  /** consecutive uses of the same content type that triggers a penalty */
  contentTypeMaxConsecutive: number;
  /** percentage of issues that must explore (not exploit known winners) */
  explorationBudgetPct: number;
};

export const DEFAULT_VARIETY_CONSTRAINTS: VarietyConstraints = {
  contentTypeMaxFraction: 0.4,
  frameworkFamilyMaxFraction: 0.5,
  contentTypeMaxConsecutive: 2,
  explorationBudgetPct: 20,
};

export type VarietyEvaluation = {
  exhaustedContentTypes: string[];
  exhaustedFrameworkFamilies: string[];
  consecutiveStreakBlocked: string | null;
  explorationRequired: boolean;
  rationale: string[];
};

function fractions<T extends string>(items: T[]): Record<T, number> {
  if (items.length === 0) return {} as Record<T, number>;
  const counts: Record<string, number> = {};
  for (const it of items) counts[it] = (counts[it] ?? 0) + 1;
  const total = items.length;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) out[k] = v / total;
  return out as Record<T, number>;
}

function leadingStreak(items: string[]): { value: string | null; length: number } {
  if (items.length === 0) return { value: null, length: 0 };
  const head = items[0];
  if (head === undefined) return { value: null, length: 0 };
  let len = 1;
  for (let i = 1; i < items.length && items[i] === head; i++) len++;
  return { value: head, length: len };
}

/**
 * Decide which content types and framework families are exhausted for
 * the next issue, plus whether this issue needs to be an exploration
 * pick rather than exploitation of a known winner.
 */
export function evaluateVariety(
  input: VarietyInput,
  constraints: VarietyConstraints = DEFAULT_VARIETY_CONSTRAINTS,
): VarietyEvaluation {
  const ctFractions = fractions(input.recentContentTypes);
  const ffFractions = fractions(input.recentFrameworkFamilies);

  const exhaustedContentTypes = Object.entries(ctFractions)
    .filter(([, f]) => f > constraints.contentTypeMaxFraction)
    .map(([k]) => k);

  const exhaustedFrameworkFamilies = Object.entries(ffFractions)
    .filter(([, f]) => f > constraints.frameworkFamilyMaxFraction)
    .map(([k]) => k);

  const streak = leadingStreak(input.recentContentTypes);
  const consecutiveStreakBlocked =
    streak.value !== null && streak.length >= constraints.contentTypeMaxConsecutive
      ? streak.value
      : null;

  // Exploration budget — if fewer than budget% of recent issues were
  // exploration, this one must be exploration. We use a proxy: if the
  // most-frequent content type's fraction exceeds (1 - budget/100),
  // the queue is too exploit-heavy and we force exploration.
  const explorationFloor = 1 - constraints.explorationBudgetPct / 100;
  const dominantCt = Math.max(0, ...Object.values(ctFractions));
  const explorationRequired = dominantCt >= explorationFloor;

  const rationale: string[] = [];
  if (exhaustedContentTypes.length > 0) {
    rationale.push(
      `content types over ${Math.round(constraints.contentTypeMaxFraction * 100)}%: ${exhaustedContentTypes.join(", ")}`,
    );
  }
  if (exhaustedFrameworkFamilies.length > 0) {
    rationale.push(
      `framework families over ${Math.round(constraints.frameworkFamilyMaxFraction * 100)}%: ${exhaustedFrameworkFamilies.join(", ")}`,
    );
  }
  if (consecutiveStreakBlocked) {
    rationale.push(
      `${consecutiveStreakBlocked} ran ${streak.length} times consecutively (max ${constraints.contentTypeMaxConsecutive})`,
    );
  }
  if (explorationRequired) {
    rationale.push(
      `dominant content type fraction ≥ ${Math.round(explorationFloor * 100)}% — forced exploration`,
    );
  }

  return {
    exhaustedContentTypes,
    exhaustedFrameworkFamilies,
    consecutiveStreakBlocked,
    explorationRequired,
    rationale,
  };
}
