import { z } from "zod";

const SourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  author: z.string().optional(),
  publishedAt: z.string().optional(),
  excerpt: z.string().optional(),
});

export const WeekdayResearchOutputSchema = z.object({
  topic: z.string(),
  keyClaims: z.array(z.string()).min(1),
  contrarianAngle: z.string(),
  frameworkConnections: z.array(z.string()).default([]),
  sources: z.array(SourceSchema),
  synthesisNotes: z.string(),
});
export type WeekdayResearchOutput = z.infer<typeof WeekdayResearchOutputSchema>;

export const WeekendResearchOutputSchema = z.object({
  destination: z.string(),
  whereWhenWho: z.object({
    where: z.string(),
    whenToGo: z.string(),
    whoForWhat: z.string(),
  }),
  keyDetails: z.object({
    insiderTips: z.array(z.string()).min(1),
    activityOptions: z.array(z.string()).default([]),
    foodNotes: z.array(z.string()).default([]),
    logistics: z.array(z.string()).default([]),
  }),
  unexpectedVariable: z.string(),
  sources: z.array(SourceSchema),
});
export type WeekendResearchOutput = z.infer<typeof WeekendResearchOutputSchema>;
