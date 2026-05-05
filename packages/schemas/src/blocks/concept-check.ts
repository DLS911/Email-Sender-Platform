import { z } from "zod";

export const ConceptCheckOutputSchema = z.object({
  blockedConcepts: z
    .array(z.string())
    .describe("concept slugs flagged as too-recent or hard-blocked"),
  nearMatches: z
    .array(
      z.object({
        candidate: z.string(),
        matchedConcept: z.string(),
        similarity: z.number().min(0).max(1),
        lookbackUntil: z.string().nullable(),
      }),
    )
    .describe("candidates that scored above the similarity threshold but below hard-block"),
  passed: z.boolean(),
});
export type ConceptCheckOutput = z.infer<typeof ConceptCheckOutputSchema>;
