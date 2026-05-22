/**
 * Surgical Section Rewrites
 *
 * voice_sharpen sends the WHOLE issue JSON and asks for it back, which means
 * the model preserves too much. After 2 iterations the same defects persist.
 *
 * These surgical rewrites target ONE specific defective field. They show the
 * model the topic + the canonical pattern + the broken section, and ask for
 * a REPLACEMENT — not a rewrite-while-preserving. Then we splice the new
 * section back into the issue JSON.
 *
 * Each function is intentionally narrow:
 * - rewriteUnspoken — for unspoken_* defects
 * - rewriteClosing — for closing_repeats_number
 * - rewriteFlip — for flip_too_long
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { DailyGrindContent } from "../daily-grind-html-template";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenceMatch && fenceMatch[1] ? fenceMatch[1].trim() : trimmed;
  // Find first { and last } to handle preamble noise
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return body;
  return body.slice(start, end + 1);
}

// ─── Unspoken ────────────────────────────────────────────────────────────────

const UNSPOKEN_SYSTEM = `You write THE UNSPOKEN section for The Daily Grind, a newsletter for independent financial advisors written in Mark's voice.

THE UNSPOKEN is a 60-120 word scene from one specific moment. It must contain:
- ONE specific scene. Not a chronology of business events. Not "first you did X, then Y, then Z." ONE moment.
- A human DOING something physical. Examples of canonical physical actions: ordering the lobster, aggressive eye contact at a charity event, pretending to take a phone call, screening voicemails, rehearsing the "stay the course" speech, watching the dog. Physical verbs, not institutional ones.
- A quotable line that survives being read alone. Examples of canonical quotable lines: "(The dog seems unconvinced about your long-term equity allocation.)" / "Their contact is still in your CRM tagged 'HOT COI.'" / "$187 and zero referrals." / "You ordered the lobster. He ordered the salmon. He's still your biggest client."
- A dollar punchline OR specific number that lands. Money in the scene makes it visceral.

DO NOT:
- Chronicle business changes ("you built the team," "you added headcount," "you launched the practice")
- Use institutional verbs ("documented," "established," "implemented")
- Use AI vocabulary (crucial, robust, comprehensive, delve, leverage)
- Include hedges or qualifiers
- Use em dashes (use commas, periods, "...")

Return ONLY a JSON object: { "unspoken": "<the new Unspoken text, 60-120 words>" }`;

export async function rewriteUnspoken(
  client: Anthropic,
  context: {
    topic: string;
    headline: string;
    contentType: string;
    keyClaim: string;
    brokenUnspoken: string;
    defects: string[];
  },
): Promise<{
  newUnspoken: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = `Topic: ${context.topic}
Headline: ${context.headline}
ContentType: ${context.contentType}
Key claim of the issue: ${context.keyClaim}

The current Unspoken has these defects: ${context.defects.join(", ")}

This is the BROKEN Unspoken (DO NOT preserve it — write a completely new one):
"""
${context.brokenUnspoken}
"""

Write a NEW Unspoken (60-120 words) for this topic. Single moment. Physical action. Quotable line. Specific number.

Return ONLY: { "unspoken": "..." }`;

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1200,
    temperature: 0.55,
    system: UNSPOKEN_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    return {
      newUnspoken: null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
  try {
    const parsed = JSON.parse(extractJsonObject(block.text)) as { unspoken?: string };
    return {
      newUnspoken: typeof parsed.unspoken === "string" ? parsed.unspoken : null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  } catch {
    return {
      newUnspoken: null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
}

// ─── Closing ─────────────────────────────────────────────────────────────────

const CLOSING_SYSTEM = `You write THE MAIN CONTENT CLOSING for The Daily Grind in Mark's voice.

The Closing must:
- Land somewhere DIFFERENT from what The Number paragraph already said. Not a restatement. A NEW angle, a sharper position, an implication.
- Be 1-3 sentences max. Punchy. Quotable if possible.
- Take a position. Not summary or recap.

DO NOT:
- Restate The Number's claim
- Use AI vocabulary or hedges
- Use em dashes

Return ONLY: { "closing": "<new closing text>" }`;

export async function rewriteClosing(
  client: Anthropic,
  context: {
    topic: string;
    headline: string;
    theNumberStat: string;
    theNumberDescription: string;
    brokenClosing: string;
  },
): Promise<{
  newClosing: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = `Topic: ${context.topic}
Headline: ${context.headline}

What The Number ALREADY said (DO NOT repeat this):
"""
${context.theNumberStat} — ${context.theNumberDescription}
"""

The current Closing repeats The Number (don't preserve it):
"""
${context.brokenClosing}
"""

Write a NEW Closing (1-3 sentences) that takes the topic to a DIFFERENT place from The Number. New angle, sharper position, or implication.

Return ONLY: { "closing": "..." }`;

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 600,
    temperature: 0.5,
    system: CLOSING_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    return { newClosing: null, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, latencyMs };
  }
  try {
    const parsed = JSON.parse(extractJsonObject(block.text)) as { closing?: string };
    return {
      newClosing: typeof parsed.closing === "string" ? parsed.closing : null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  } catch {
    return { newClosing: null, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, latencyMs };
  }
}

// ─── Flip ────────────────────────────────────────────────────────────────────

const FLIP_SYSTEM = `You write THE FLIP REALITY for The Daily Grind in Mark's voice.

The Flip Reality is the contrarian rebuttal to conventional wisdom. It must:
- Be 12-20 words. ONE sharp reframe.
- Punchy, not analytical.
- Take a clear position.

DO NOT:
- Exceed 20 words
- Use AI vocabulary, hedges, or em dashes
- Sound like analysis

Return ONLY: { "reality": "<the new reality text, 12-20 words>" }`;

export async function rewriteFlip(
  client: Anthropic,
  context: {
    topic: string;
    conventional: string;
    brokenReality: string;
  },
): Promise<{
  newReality: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = `Topic: ${context.topic}
The conventional wisdom The Flip is rebutting: "${context.conventional}"

The current Reality is too long (don't preserve it):
"""
${context.brokenReality}
"""

Write a NEW Reality (12-20 words). One sharp reframe.

Return ONLY: { "reality": "..." }`;

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 300,
    temperature: 0.5,
    system: FLIP_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    return { newReality: null, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, latencyMs };
  }
  try {
    const parsed = JSON.parse(extractJsonObject(block.text)) as { reality?: string };
    return {
      newReality: typeof parsed.reality === "string" ? parsed.reality : null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  } catch {
    return { newReality: null, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, latencyMs };
  }
}

// ─── Splicing ────────────────────────────────────────────────────────────────

/**
 * Apply surgical rewrites to a content object based on which defects fired.
 * Returns a new content object + list of which sections were actually replaced.
 */
export async function applySurgicalRewrites(
  client: Anthropic,
  content: DailyGrindContent,
  defects: string[],
  context: { topic: string },
): Promise<{
  content: DailyGrindContent;
  sectionsRewritten: string[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatencyMs: number;
  failures: string[];
}> {
  let result = content;
  const sectionsRewritten: string[] = [];
  const failures: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalLatencyMs = 0;

  const unspokenDefects = defects.filter((d) =>
    [
      "unspoken_timeline",
      "unspoken_no_character_action",
      "unspoken_no_quotable_line",
      "hollow_unspoken",
    ].includes(d),
  );
  if (unspokenDefects.length > 0) {
    const r = await rewriteUnspoken(client, {
      topic: context.topic,
      headline: result.headline,
      contentType: result.contentType,
      keyClaim: result.openingTrifecta.theNumber.description,
      brokenUnspoken: result.openingTrifecta.theUnspoken,
      defects: unspokenDefects,
    });
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    totalLatencyMs += r.latencyMs;
    if (r.newUnspoken && r.newUnspoken.trim().length > 50) {
      result = {
        ...result,
        openingTrifecta: { ...result.openingTrifecta, theUnspoken: r.newUnspoken.trim() },
      };
      sectionsRewritten.push("unspoken");
    } else {
      failures.push("unspoken: rewrite returned empty/short output");
    }
  }

  if (defects.includes("closing_repeats_number")) {
    const r = await rewriteClosing(client, {
      topic: context.topic,
      headline: result.headline,
      theNumberStat: result.openingTrifecta.theNumber.stat,
      theNumberDescription: result.openingTrifecta.theNumber.description,
      brokenClosing: result.mainContent.closing,
    });
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    totalLatencyMs += r.latencyMs;
    if (r.newClosing && r.newClosing.trim().length > 10) {
      result = {
        ...result,
        mainContent: { ...result.mainContent, closing: r.newClosing.trim() },
      };
      sectionsRewritten.push("closing");
    } else {
      failures.push("closing: rewrite returned empty output");
    }
  }

  if (defects.includes("flip_too_long")) {
    const r = await rewriteFlip(client, {
      topic: context.topic,
      conventional: result.openingTrifecta.theFlip.conventional,
      brokenReality: result.openingTrifecta.theFlip.reality,
    });
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    totalLatencyMs += r.latencyMs;
    if (r.newReality && r.newReality.trim().length > 5) {
      result = {
        ...result,
        openingTrifecta: {
          ...result.openingTrifecta,
          theFlip: { ...result.openingTrifecta.theFlip, reality: r.newReality.trim() },
        },
      };
      sectionsRewritten.push("flip");
    } else {
      failures.push("flip: rewrite returned empty output");
    }
  }

  return { content: result, sectionsRewritten, totalInputTokens, totalOutputTokens, totalLatencyMs, failures };
}
