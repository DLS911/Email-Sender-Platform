import { z } from "zod";

export const PersonaSegmentSchema = z.enum([
  "highest_engagement",
  "moderate_engagement",
  "at_risk",
]);

export const PersonaFlagSchema = z.object({
  flag: z.string(),
  severity: z.enum(["info", "warn", "block"]),
  reason: z.string(),
});

export const PersonaEvaluateOutputSchema = z.object({
  personaName: z.string(),
  personaSegment: PersonaSegmentSchema,
  loveProbability: z.number().int().min(0).max(100),
  shareProbability: z.number().int().min(0).max(100),
  unsubscribeProbability: z.number().int().min(0).max(100),
  trifectaScores: z
    .object({
      number: z.number().int().min(0).max(100),
      unspoken: z.number().int().min(0).max(100),
      flip: z.number().int().min(0).max(100),
    })
    .optional()
    .describe("weekday only — opening trifecta evaluation"),
  selectedUnspokenOption: z.enum(["option_1", "option_2", "option_3"]).optional(),
  flags: z.array(PersonaFlagSchema).default([]),
  rationale: z.string().describe("1-2 sentence summary of this persona's read"),
});
export type PersonaEvaluateOutput = z.infer<typeof PersonaEvaluateOutputSchema>;
