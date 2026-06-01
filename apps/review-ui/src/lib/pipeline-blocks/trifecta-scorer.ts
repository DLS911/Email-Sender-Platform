/**
 * Opening Trifecta Scorer (spec 04:605-647 + 645 selection logic).
 *
 * The writer produces all three openings (The Number / The Unspoken / The
 * Flip). This block evaluates which ONE would lead best for this specific
 * issue + audience, given the content. The single winner is what ships. The
 * other two are logged in the trace for learning.
 *
 * Cheaper than the spec's 10-persona-panel-per-candidate (30 Haiku calls): one
 * focused Haiku call that holds the persona profiles as context.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { DailyGrindContent } from "../daily-grind-html-template";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export type TrifectaOpening = "number" | "unspoken" | "flip";

export type TrifectaScore = {
  opening: TrifectaOpening;
  hookStrength: number; // 0-10: how strong is the hook for this issue's audience
  shareWorthy: number; // 0-10: would a reader screenshot/forward THIS lead
  voiceFit: number; // 0-10: does it land in Mark's register, not AI-pastiche
  combined: number; // weighted sum (hook 0.4 + share 0.4 + voice 0.2)
  reasoning: string; // 1-2 sentences why
};

export type TrifectaScoreResult = {
  scores: TrifectaScore[];
  winner: TrifectaOpening;
  rationale: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

const SYSTEM_PROMPT = `You are evaluating which of three opening hooks should lead a Daily Grind issue.

Audience: independent financial advisors (RIAs, wirehouse refugees, fee-only planners, team builders). They are tired of generic industry content, can smell sales tactics, want to be challenged not coddled, appreciate contrarian thinking backed by experience. Voice is Mark's — direct, opinionated, no hedging.

You will see three candidate openings for the same issue:
- THE NUMBER: a striking industry statistic plus a paragraph naming the gap behind it
- THE UNSPOKEN: a brutally specific narrative paragraph naming a pattern the reader recognizes but hasn't admitted
- THE FLIP: a two-line conventional-vs-reality reframe

Score each on:
- hookStrength (0-10): would this STOP a busy advisor from scrolling past on their phone at 10am
- shareWorthy (0-10): would a reader screenshot THIS opening and send to a peer ("you have to see this")
- voiceFit (0-10): does this read like Mark wrote it — direct, specific, contrarian — versus AI-pastiche (generic-stat + hedge-paragraph patterns)

The winner is the one with the highest weighted score (hook 0.4 + share 0.4 + voice 0.2). Be willing to call a tie close; the highest combined wins.

Return ONLY this JSON, no preamble:
{
  "scores": [
    { "opening": "number", "hookStrength": <0-10>, "shareWorthy": <0-10>, "voiceFit": <0-10>, "combined": <0-10>, "reasoning": "<1-2 sentences>" },
    { "opening": "unspoken", "hookStrength": <0-10>, "shareWorthy": <0-10>, "voiceFit": <0-10>, "combined": <0-10>, "reasoning": "<1-2 sentences>" },
    { "opening": "flip", "hookStrength": <0-10>, "shareWorthy": <0-10>, "voiceFit": <0-10>, "combined": <0-10>, "reasoning": "<1-2 sentences>" }
  ],
  "winner": "number" | "unspoken" | "flip",
  "rationale": "<1-2 sentences on why the winner edges out the others>"
}`;

function stripFences(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) {
    const lines = t.split("\n");
    if (lines.length >= 3 && lines[lines.length - 1]!.startsWith("```")) {
      return lines.slice(1, -1).join("\n").trim();
    }
  }
  return t;
}

function extractJson(text: string): string {
  const c = stripFences(text);
  const a = c.indexOf("{");
  const b = c.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("trifecta_scorer: no JSON in response");
  return c.slice(a, b + 1);
}

export async function scoreTrifecta(
  client: Anthropic,
  content: DailyGrindContent,
): Promise<TrifectaScoreResult> {
  const trif = content.openingTrifecta;
  const userPrompt = `Issue headline: ${content.headline}
Content type: ${content.contentType}

CANDIDATE 1 — THE NUMBER
Stat: ${trif.theNumber.stat}
Paragraph: ${trif.theNumber.description}

CANDIDATE 2 — THE UNSPOKEN
${trif.theUnspoken}

CANDIDATE 3 — THE FLIP
Conventional: "${trif.theFlip.conventional}"
Reality: ${trif.theFlip.reality}

Score each on the three dimensions and pick the winner.`;

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1500,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("trifecta_scorer: no text in response");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJson(block.text)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `trifecta_scorer: parse failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const rawScores = Array.isArray(parsed.scores) ? parsed.scores : [];
  const scores: TrifectaScore[] = [];
  for (const r of rawScores) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const opening = o.opening;
    if (opening !== "number" && opening !== "unspoken" && opening !== "flip") continue;
    const hook = typeof o.hookStrength === "number" ? o.hookStrength : 0;
    const share = typeof o.shareWorthy === "number" ? o.shareWorthy : 0;
    const voice = typeof o.voiceFit === "number" ? o.voiceFit : 0;
    const combinedRaw = typeof o.combined === "number" ? o.combined : hook * 0.4 + share * 0.4 + voice * 0.2;
    scores.push({
      opening,
      hookStrength: hook,
      shareWorthy: share,
      voiceFit: voice,
      combined: combinedRaw,
      reasoning: typeof o.reasoning === "string" ? o.reasoning : "",
    });
  }

  // Fall back to computed-best if winner field is missing/garbage
  let winner: TrifectaOpening = "number";
  if (parsed.winner === "number" || parsed.winner === "unspoken" || parsed.winner === "flip") {
    winner = parsed.winner;
  } else if (scores.length > 0) {
    winner = scores.reduce((best, s) => (s.combined > best.combined ? s : best)).opening;
  }

  return {
    scores,
    winner,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}
