import { z } from "zod";

export const TopicProposerOutputSchema = z.object({
  contentType: z.string().min(1),
  formatStyle: z.string().optional(),
  topic: z.string().min(1),
  angle: z.string().min(1),
  frameworkReferences: z.array(z.string()).default([]),
  rationale: z.string().min(1),
});
export type TopicProposerOutput = z.infer<typeof TopicProposerOutputSchema>;
