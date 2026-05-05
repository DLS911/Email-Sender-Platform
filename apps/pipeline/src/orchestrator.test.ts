import { describe, expect, it } from "vitest";
import { mockBlocks } from "./blocks/mock";
import type { BlockBundle } from "./blocks/types";
import { runIssue } from "./orchestrator";

const RUN_CTX = {
  runId: "00000000-0000-0000-0000-000000000001",
  brandId: "castor_abbott" as const,
  blockName: "orchestrator_test",
};

describe("runIssue (with mock blocks)", () => {
  it("runs the weekday pipeline end-to-end", async () => {
    const result = await runIssue({
      context: RUN_CTX,
      edition: "weekday",
      brandName: "Castor Abbott",
      blocks: mockBlocks,
      recentTopics: [],
    });

    expect(result.episode.headline).toBeTruthy();
    expect(result.episode.sections.length).toBeGreaterThan(0);
    expect(result.html).toContain("Castor Abbott");
    expect(result.html).toContain(result.episode.headline);
    expect(result.subject).toBe(result.episode.headline);
    expect(result.text).toContain("##");
    expect(result.qualityScore.loveRate).toBeGreaterThan(0);
    expect(result.revisionCycles).toBe(0);
  });

  it("runs the weekend pipeline end-to-end", async () => {
    const result = await runIssue({
      context: RUN_CTX,
      edition: "weekend",
      brandName: "Castor Abbott",
      blocks: mockBlocks,
      recentTopics: [],
    });

    expect(result.episode.headline).toContain("Tuscan");
    expect(result.html).toContain("Castor Abbott");
    expect(result.qualityScore.churnRisk).toBeLessThan(50);
  });

  it("retries with revision feedback when persona panel fails the first time", async () => {
    let panelCalls = 0;
    const blocks: BlockBundle = {
      ...mockBlocks,
      personaPanel: async () => {
        panelCalls++;
        if (panelCalls < 2) {
          return {
            passed: false,
            loveRate: 40,
            shareRate: 15,
            churnRisk: 35,
            recommendations: ["sharpen the take"],
          };
        }
        return { passed: true, loveRate: 75, shareRate: 40, churnRisk: 12, recommendations: [] };
      },
    };

    const result = await runIssue({
      context: RUN_CTX,
      edition: "weekday",
      brandName: "Castor Abbott",
      blocks,
    });

    expect(panelCalls).toBe(2);
    expect(result.revisionCycles).toBe(1);
    expect(result.qualityScore.loveRate).toBe(75);
  });

  it("throws when concept check blocks the proposed topic", async () => {
    const blocks: BlockBundle = {
      ...mockBlocks,
      conceptCheck: async () => ({ passed: false, blocked: ["topic"] }),
    };
    await expect(
      runIssue({
        context: RUN_CTX,
        edition: "weekday",
        brandName: "Castor Abbott",
        blocks,
      }),
    ).rejects.toThrow(/concept check/);
  });

  it("throws when persona panel never passes within max revisions", async () => {
    const blocks: BlockBundle = {
      ...mockBlocks,
      personaPanel: async () => ({
        passed: false,
        loveRate: 30,
        shareRate: 10,
        churnRisk: 50,
        recommendations: ["unfixable"],
      }),
    };
    await expect(
      runIssue({
        context: RUN_CTX,
        edition: "weekday",
        brandName: "Castor Abbott",
        blocks,
        maxRevisionCycles: 2,
      }),
    ).rejects.toThrow(/quality gate/);
  });

  it("throws when fact check fails", async () => {
    const blocks: BlockBundle = {
      ...mockBlocks,
      factCheck: async () => ({ passed: false, issues: ["claim 1 unverifiable"] }),
    };
    await expect(
      runIssue({
        context: RUN_CTX,
        edition: "weekday",
        brandName: "Castor Abbott",
        blocks,
      }),
    ).rejects.toThrow(/fact check/);
  });
});
