import { describe, expect, it } from "vitest";
import { similarity } from "./concept-check.js";
import { evaluateVariety } from "./variety.js";

describe("similarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(similarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(similarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it("returns 0 for length-mismatched vectors", () => {
    expect(similarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it("returns 0 for empty vectors", () => {
    expect(similarity([], [])).toBe(0);
  });

  it("computes cosine similarity correctly for arbitrary vectors", () => {
    const sim = similarity([1, 2, 3], [4, 5, 6]);
    // dot = 4+10+18 = 32; ||a|| = sqrt(14); ||b|| = sqrt(77); sim = 32 / (sqrt(14)*sqrt(77))
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
    expect(sim).toBeCloseTo(expected, 5);
  });
});

describe("evaluateVariety", () => {
  it("flags exhausted content types", () => {
    const result = evaluateVariety({
      recentContentTypes: ["tactic", "tactic", "tactic", "tactic", "take"],
      recentFrameworkFamilies: ["opening_pattern", "section_structure"],
      recentLeadingPersonas: ["solo_operator"],
      lookbackCount: 5,
    });
    expect(result.exhaustedContentTypes).toContain("tactic");
  });

  it("flags consecutive streak", () => {
    const result = evaluateVariety({
      recentContentTypes: ["tactic", "tactic", "take"],
      recentFrameworkFamilies: [],
      recentLeadingPersonas: [],
      lookbackCount: 3,
    });
    expect(result.consecutiveStreakBlocked).toBe("tactic");
  });

  it("does not flag streak under threshold", () => {
    const result = evaluateVariety({
      recentContentTypes: ["tactic", "take", "tactic"],
      recentFrameworkFamilies: [],
      recentLeadingPersonas: [],
      lookbackCount: 3,
    });
    expect(result.consecutiveStreakBlocked).toBeNull();
  });

  it("forces exploration when one content type dominates", () => {
    const result = evaluateVariety({
      recentContentTypes: ["tactic", "tactic", "tactic", "tactic", "tactic"],
      recentFrameworkFamilies: [],
      recentLeadingPersonas: [],
      lookbackCount: 5,
    });
    expect(result.explorationRequired).toBe(true);
  });

  it("does not force exploration on a varied queue", () => {
    const result = evaluateVariety({
      recentContentTypes: ["tactic", "take", "story", "tactic", "rant"],
      recentFrameworkFamilies: [],
      recentLeadingPersonas: [],
      lookbackCount: 5,
    });
    expect(result.explorationRequired).toBe(false);
  });

  it("provides rationale strings explaining each block", () => {
    const result = evaluateVariety({
      recentContentTypes: ["tactic", "tactic", "tactic"],
      recentFrameworkFamilies: ["opening_pattern", "opening_pattern", "opening_pattern"],
      recentLeadingPersonas: [],
      lookbackCount: 3,
    });
    expect(result.rationale.length).toBeGreaterThan(0);
    expect(result.rationale.some((r) => r.includes("tactic"))).toBe(true);
    expect(result.rationale.some((r) => r.includes("opening_pattern"))).toBe(true);
  });

  it("handles empty inputs", () => {
    const result = evaluateVariety({
      recentContentTypes: [],
      recentFrameworkFamilies: [],
      recentLeadingPersonas: [],
      lookbackCount: 0,
    });
    expect(result.exhaustedContentTypes).toEqual([]);
    expect(result.exhaustedFrameworkFamilies).toEqual([]);
    expect(result.consecutiveStreakBlocked).toBeNull();
    expect(result.explorationRequired).toBe(false);
  });
});
