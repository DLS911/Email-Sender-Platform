import { z } from "zod";

const SectionContentSchema = z.object({
  sectionName: z.string(),
  body: z.string().min(1),
  wordCount: z.number().int().nonnegative().optional(),
});

export const WeekdayDraftOutputSchema = z.object({
  headlineOptions: z.array(z.string().min(1)).length(3),
  openingHook: z.string().min(50),
  sections: z.array(SectionContentSchema).min(1),
  closing: z.string().min(20),
  contentType: z.string(),
  formatStyle: z.string().optional(),
});
export type WeekdayDraftOutput = z.infer<typeof WeekdayDraftOutputSchema>;

export const WeekendDraftOutputSchema = z.object({
  headlineOptions: z.array(z.string().min(1)).length(3),
  coverStory: z.object({
    openingHook: z.string().min(50),
    body: z.string().min(100),
  }),
  tastingMenu: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      url: z.string().url().optional(),
      unexpectedVariable: z.string(),
    }),
  ),
  hostsCorner: z.string().optional(),
  theDrive: z
    .object({
      pick: z.string(),
      rationale: z.string(),
      spectrumPosition: z.string(),
    })
    .optional(),
  contentType: z.string(),
});
export type WeekendDraftOutput = z.infer<typeof WeekendDraftOutputSchema>;
