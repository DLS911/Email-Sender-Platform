import { z } from "zod";

export const EditorOutputSchema = z.object({
  edited: z.record(z.string(), z.unknown()).describe("the same draft shape, edited"),
  changes: z.array(
    z.object({
      sectionName: z.string(),
      changeType: z.enum([
        "tightened",
        "removed_hedge",
        "fixed_voice_drift",
        "shortened",
        "rewrote",
        "fact_correction",
      ]),
      summary: z.string(),
    }),
  ),
  flags: z.array(
    z.object({
      severity: z.enum(["info", "warn", "block"]),
      message: z.string(),
      sectionName: z.string().optional(),
    }),
  ),
  passes: z.boolean().describe("true if no block-level flags raised"),
});
export type EditorOutput = z.infer<typeof EditorOutputSchema>;
