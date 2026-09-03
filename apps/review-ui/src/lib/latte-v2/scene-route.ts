/**
 * v2 Scene route — text-to-image path used for hero, coverDetail,
 * hostsCorner (when no cookware asset resolves), and film keyframe.
 *
 * Behaviour: N candidates in parallel, all scored, highest wins.
 * Failing threshold ships anyway with a below-threshold log so we can
 * spot systematic drops in the harness. No retry-with-hint (spec §0).
 */

import type { V2Slot, V2ValidatorContext } from "./validator";
import { scoreCandidate } from "./validator";
import { STYLE_V2 } from "./style-v2";

const GEMINI_MODEL = "gemini-2.5-flash-image";
const GEMINI_ENDPOINT = (model: string, apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> };
  }>;
  promptFeedback?: { blockReason?: string };
};

async function callGeminiOnce(apiKey: string, parts: Array<Record<string, unknown>>): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetch(GEMINI_ENDPOINT(GEMINI_MODEL, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`gemini image: HTTP ${response.status} — ${body.slice(0, 400)}`);
  }
  const data = (await response.json()) as GeminiResponse;
  if (data.promptFeedback?.blockReason) throw new Error(`gemini image: blocked — ${data.promptFeedback.blockReason}`);
  const outParts = data.candidates?.[0]?.content?.parts ?? [];
  for (const part of outParts) {
    if (part.inlineData?.data) {
      const bytes = Uint8Array.from(Buffer.from(part.inlineData.data, "base64"));
      return { bytes, mimeType: part.inlineData.mimeType ?? "image/png" };
    }
  }
  throw new Error("gemini image: no inline image data");
}

async function callGeminiWithRetry(apiKey: string, parts: Array<Record<string, unknown>>): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await callGeminiOnce(apiKey, parts);
    } catch (err) {
      lastErr = err;
      console.warn("latte-v2.gemini_attempt_failed", { attempt, error: err instanceof Error ? err.message : String(err) });
    }
  }
  console.error("latte-v2.gemini_exhausted", { error: lastErr instanceof Error ? lastErr.message : String(lastErr) });
  return null;
}

export type V2SceneResult = {
  bytes: Uint8Array;
  mimeType: string;
  score: number;
  candidateIndex: number;
  allScores: number[];
  belowThreshold: boolean;
  deductions: Array<{ code: string; weight: number; note: string }>;
  route: "scene";
};

export async function generateSceneSlot(opts: {
  apiKey: string;
  slot: V2Slot;
  subject: string;
  slotPrompt: string;
  n: number;
  validatorCtx: V2ValidatorContext;
  threshold?: number;
}): Promise<V2SceneResult | null> {
  const { apiKey, slot, subject, slotPrompt, n, validatorCtx } = opts;
  const threshold = opts.threshold ?? 70;
  const fullPrompt = `${slotPrompt}${STYLE_V2}`;
  const candidates = await Promise.all(
    Array.from({ length: n }, () => callGeminiWithRetry(apiKey, [{ text: fullPrompt }])),
  );
  const valid = candidates
    .map((c, idx) => ({ c, idx }))
    .filter((x): x is { c: { bytes: Uint8Array; mimeType: string }; idx: number } => x.c !== null);
  if (valid.length === 0) {
    console.error("latte-v2.scene_all_candidates_failed", { slot, subject });
    return null;
  }
  const scored = await Promise.all(
    valid.map(async ({ c, idx }) => {
      const verdict = await scoreCandidate(c.bytes, c.mimeType, validatorCtx);
      return { c, idx, verdict };
    }),
  );
  scored.sort((a, b) => b.verdict.score - a.verdict.score);
  const winner = scored[0]!;
  const allScores = scored.map((s) => s.verdict.score);
  const belowThreshold = winner.verdict.score < threshold;
  if (belowThreshold) {
    console.warn("latte-v2.image_slot_below_threshold", {
      slot,
      subject,
      winningScore: winner.verdict.score,
      allScores,
      deductions: winner.verdict.deductions,
    });
  } else {
    console.info("latte-v2.scene_slot_won", { slot, subject, winningScore: winner.verdict.score, allScores });
  }
  return {
    bytes: winner.c.bytes,
    mimeType: winner.c.mimeType,
    score: winner.verdict.score,
    candidateIndex: winner.idx,
    allScores,
    belowThreshold,
    deductions: winner.verdict.deductions,
    route: "scene",
  };
}
