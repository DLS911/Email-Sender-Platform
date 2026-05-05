import type { z } from "zod";

/**
 * Pass 1: strip markdown fences, leading/trailing prose, trim whitespace.
 * Catches most "model added a preamble" failures.
 */
export function stripFencesAndProse(raw: string): string {
  let text = raw.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch?.[1]) {
    text = fenceMatch[1].trim();
  }
  // Find first { and last } if there's prose around the JSON.
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  // Same for arrays.
  const firstBracket = text.indexOf("[");
  if (firstBrace === -1 && firstBracket >= 0) {
    const lastBracket = text.lastIndexOf("]");
    if (lastBracket > firstBracket) text = text.slice(firstBracket, lastBracket + 1);
  }
  return text.trim();
}

export type ValidationOutcome<T> =
  | { ok: true; value: T; healed: boolean }
  | { ok: false; error: string };

export function tryValidate<S extends z.ZodTypeAny>(
  schema: S,
  raw: string,
): ValidationOutcome<z.infer<S>> {
  // Pass 1: as-is
  try {
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (result.success) return { ok: true, value: result.data, healed: false };
  } catch {
    // fall through to healing
  }

  // Pass 2: stripped fences/prose
  const stripped = stripFencesAndProse(raw);
  if (stripped !== raw) {
    try {
      const parsed = JSON.parse(stripped);
      const result = schema.safeParse(parsed);
      if (result.success) return { ok: true, value: result.data, healed: true };
      return { ok: false, error: result.error.message };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Re-validate to surface error
  try {
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (!result.success) return { ok: false, error: result.error.message };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: false, error: "unknown validation failure" };
}
