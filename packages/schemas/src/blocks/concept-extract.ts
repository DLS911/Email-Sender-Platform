import { z } from "zod";

export const FrameworkFamilySchema = z.enum([
  "opening_pattern",
  "closing_pattern",
  "section_structure",
  "voice_mechanism",
]);

export const ConceptExtractOutputSchema = z.object({
  contentConcepts: z.array(
    z.object({
      sectionName: z.string(),
      conceptSummary: z.string().describe("1-2 sentence semantic summary"),
      surfaceForm: z.string().nullable(),
    }),
  ),
  frameworkConcepts: z.array(
    z.object({
      frameworkName: z.string(),
      frameworkFamily: FrameworkFamilySchema,
      description: z.string(),
      sectionName: z.string(),
    }),
  ),
});
export type ConceptExtractOutput = z.infer<typeof ConceptExtractOutputSchema>;
