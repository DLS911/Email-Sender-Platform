import { z } from "zod";

export const FactCheckOutputSchema = z.object({
  claims: z.array(
    z.object({
      claim: z.string(),
      sectionName: z.string(),
      verdict: z.enum(["verified", "unverifiable", "contradicted", "needs_review"]),
      sourceUrls: z.array(z.string().url()).default([]),
      notes: z.string().optional(),
    }),
  ),
  passed: z.boolean(),
  blockingIssues: z.array(z.string()).default([]),
});
export type FactCheckOutput = z.infer<typeof FactCheckOutputSchema>;
