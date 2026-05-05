import { describe, expect, it } from "vitest";
import { DEFAULT_BENCHMARKS, runQualityGate } from "./quality-gate.js";

function persona(
  name: string,
  segment: "highest_engagement" | "moderate_engagement" | "at_risk",
  love: number,
  share: number,
  unsub: number,
  flags: Array<{ flag: string; severity: "info" | "warn" | "block"; reason: string }> = [],
) {
  return {
    personaName: name,
    personaSegment: segment,
    loveProbability: love,
    shareProbability: share,
    unsubscribeProbability: unsub,
    flags,
    rationale: "test",
  };
}

describe("runQualityGate", () => {
  it("passes a clearly-good draft", () => {
    const result = runQualityGate({
      personas: [
        persona("solo_operator", "highest_engagement", 85, 50, 5),
        persona("rising_star", "highest_engagement", 80, 45, 7),
        persona("veteran", "moderate_engagement", 75, 35, 12),
      ],
    });
    expect(result.passed).toBe(true);
    expect(result.hardStopsTriggered).toEqual([]);
    expect(result.benchmarkComparison.love_rate).toBe("pass");
  });

  it("hard-stops when any persona has unsub ≥ 50", () => {
    const result = runQualityGate({
      personas: [
        persona("solo_operator", "highest_engagement", 85, 50, 5),
        persona("compliance_conscious", "at_risk", 40, 20, 60),
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.hardStopsTriggered.some((s) => s.includes("unsub_hard_stop"))).toBe(true);
  });

  it("hard-stops when any persona has love ≤ 30", () => {
    const result = runQualityGate({
      personas: [
        persona("solo_operator", "highest_engagement", 85, 50, 5),
        persona("compliance_conscious", "at_risk", 25, 10, 20),
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.hardStopsTriggered.some((s) => s.includes("love_hard_stop"))).toBe(true);
  });

  it("weights at-risk personas 2x in churn calculation", () => {
    const baseChurn = runQualityGate({
      personas: [
        persona("a", "highest_engagement", 80, 40, 10),
        persona("b", "highest_engagement", 80, 40, 10),
      ],
    }).churnRisk;

    const withAtRisk = runQualityGate({
      personas: [
        persona("a", "highest_engagement", 80, 40, 10),
        persona("b", "at_risk", 80, 40, 30),
      ],
    }).churnRisk;

    // weighted: (10*1 + 30*2) / 3 = 23.3
    expect(withAtRisk).toBeCloseTo(23.3, 1);
    expect(withAtRisk).toBeGreaterThan(baseChurn);
  });

  it("collects common flags appearing in ≥ 2 personas", () => {
    const result = runQualityGate({
      personas: [
        persona("a", "highest_engagement", 85, 50, 5, [
          { flag: "voice_drift", severity: "warn", reason: "" },
        ]),
        persona("b", "highest_engagement", 80, 45, 7, [
          { flag: "voice_drift", severity: "warn", reason: "" },
        ]),
        persona("c", "moderate_engagement", 75, 35, 12, []),
      ],
    });
    expect(result.commonFlags).toHaveLength(1);
    expect(result.commonFlags[0]?.flag).toBe("voice_drift");
    expect(result.commonFlags[0]?.count).toBe(2);
    expect(result.commonFlags[0]?.priority).toBe("medium");
  });

  it("computes trifecta winner from majority vote", () => {
    const result = runQualityGate({
      personas: [
        { ...persona("a", "highest_engagement", 80, 40, 10), selectedUnspokenOption: "option_2" },
        { ...persona("b", "highest_engagement", 80, 40, 10), selectedUnspokenOption: "option_2" },
        { ...persona("c", "moderate_engagement", 80, 40, 10), selectedUnspokenOption: "option_1" },
      ],
      computeTrifectaWinner: true,
    });
    expect(result.selectedUnspokenOption).toBe("option_2");
    expect(result.trifectaPassed).toBe(true);
  });

  it("recommends revisions when failing", () => {
    const result = runQualityGate({
      personas: [
        persona("a", "highest_engagement", 50, 20, 30),
        persona("b", "highest_engagement", 50, 20, 30),
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.revisionRecommendations.length).toBeGreaterThan(0);
  });

  it("uses defaults when no benchmarks supplied", () => {
    const result = runQualityGate({
      personas: [persona("a", "highest_engagement", 80, 40, 10)],
    });
    expect(DEFAULT_BENCHMARKS.loveRateMin).toBe(65);
    expect(result.benchmarkComparison.love_rate).toBe("pass");
  });

  it("throws on empty persona list", () => {
    expect(() => runQualityGate({ personas: [] })).toThrow(/at least one/);
  });
});
