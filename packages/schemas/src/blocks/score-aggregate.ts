import { z } from "zod";

export const ScoreAggregateOutputSchema = z.object({
  loveRate: z.number().min(0).max(100),
  shareRate: z.number().min(0).max(100),
  churnRisk: z.number().min(0).max(100).describe("at-risk personas weighted 2x"),
  passed: z.boolean(),
  hardStopsTriggered: z.array(z.string()).default([]),
  benchmarkComparison: z.record(z.string(), z.enum(["pass", "fail", "borderline"])),
  trifectaPassed: z.boolean().optional(),
  selectedUnspokenOption: z.enum(["option_1", "option_2", "option_3"]).optional(),
  segmentBreakdown: z.record(
    z.string(),
    z.object({ love: z.number(), share: z.number(), unsub: z.number() }),
  ),
  commonFlags: z.array(
    z.object({
      flag: z.string(),
      count: z.number().int().nonnegative(),
      personas: z.array(z.string()),
      priority: z.enum(["low", "medium", "high"]),
    }),
  ),
  revisionRecommendations: z.array(z.string()).default([]),
});
export type ScoreAggregateOutput = z.infer<typeof ScoreAggregateOutputSchema>;
