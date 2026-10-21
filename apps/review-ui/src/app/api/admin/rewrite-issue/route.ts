/**
 * Rewrite an existing Daily Grind issue in a different tonal register.
 *
 * Pulls the cached issue, calls Claude with a rewrite instruction that
 * preserves facts/sources/structure but adjusts voice. Re-renders HTML
 * and replaces the cached row.
 *
 * Used for tone A/B tests: generate once with the standard pipeline,
 * then run this endpoint to produce a more-contrarian / more-engaging
 * variant from the same research bundle.
 */

import { logger } from "@platform/observability";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import {
  renderDailyGrindHtml,
  type DailyGrindContent,
} from "../../../../lib/daily-grind-html-template";
import { persistIssueVersion } from "../../../../lib/issue-versions";
import { mergePreviousVersion } from "../../../../lib/issue-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-5-20250929";

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  if (!cronSecret) return false;
  if (authHeader === `Bearer ${cronSecret}`) return true;
  if (querySecret && querySecret === cronSecret) return true;
  return false;
}

const REWRITE_SYSTEM_CONTRARIAN = `You are rewriting an existing Daily Grind newsletter issue in Mark's voice — sharper, more contrarian, more engaging. The reader is an independent financial advisor. Mark talks like a builder, not a consultant: direct, opinionated, specific, slightly wry.

# What to preserve EXACTLY
- All facts, numbers, and statistics (do not invent new ones)
- All source URLs and source names in Worth Knowing
- The headline's NUMBER (the stat) if it has one, though phrasing can shift
- The 3 Worth Knowing items (same stories, same sourceUrls)
- The contentType (tactic/take/story/rant/special)
- The structure: openingTrifecta, firstPull, worthKnowing, mainContent, groundsForThought, ancientTruth, ps
- Ancient Truth verse + reference (keep the verse the same)

# What to adjust toward "more contrarian, more engaging"
- Sharper hooks: take a position earlier. Don't ease in.
- Replace neutral framing with named opinion. "Some firms" → "the bottom 80% of firms."
- The Unspoken: lean harder into the wry self-recognition. Push the dollar-amount punchline.
- First Pull paragraphs: argue, don't summarize. Take a side the reader hasn't taken yet.
- Worth Knowing "myTake" fields: from observation → judgment. Name what advisors are doing wrong, not just what's happening.
- Main Content closing: from concluding → indicting. End with a directive or a hard truth, not a soft wrap.
- Grounds for Thought: more provocative restatement.
- Ancient Truth application: less devotional, more practical. Concrete advisor behavior.
- P.S.: a sharper question. One that makes the reader pause before answering.

# What NOT to do
- Don't add new facts not in the original.
- Don't change source URLs.
- Don't add em dashes (use commas, periods, "...").
- Don't use AI vocabulary (crucial, robust, comprehensive, nuanced, delve).
- Don't make it preachy or shouty. More contrarian, not louder.
- Don't lose Mark's wry humor. He's sharp, not angry.

Return the FULL revised JSON object with the same schema as the input. No preamble, no markdown fences.`;

const REWRITE_SYSTEM_VALUE_FORWARD = `You are rewriting an existing Daily Grind newsletter issue in Mark's voice — specific, sharp, and VALUE-FORWARD. The reader is an independent financial advisor who already opens at 30%+ — they trust Mark when he TEACHES them a move, not when he scolds them for a mistake. Mark talks like a builder: direct, opinionated, specific, slightly wry.

Added 2026-10-21 after Mark feedback: "preview email is too negative, the title it too negative, its all just too negative. the ai is pushing for negative because its captivating but that not what we want. it needs a positive here is what you can learn type thing."

# What to preserve EXACTLY
- All facts, numbers, and statistics (do not invent new ones)
- All source URLs and source names in Worth Knowing
- The 3 Worth Knowing items (same stories, same sourceUrls)
- The contentType (tactic/take/story/rant/special)
- The structure: openingTrifecta, firstPull, worthKnowing, mainContent, groundsForThought, ancientTruth, ps
- Ancient Truth verse + reference (keep the verse the same)

# What to FLIP from threat-framing to opportunity/instruction/celebration

- HEADLINE: flip from "the X that catches/proves/exposes you" or "your X is broken" to "the X move that unlocks/protects/pays back Y" or "how to X without Y". Preserve the specific stat if there is one. Shape examples: "How to X", "The move that Y", "The N-minute habit that Z", "What top advisors do when Y", "The upgrade: X".
- Opening Trifecta (Number / Unspoken / Flip): REWRITE all three so each one points at an UPSIDE the reader can capture. The Unspoken keeps its scene + dollar punchline but should land on "...and here's the move that would have changed that outcome" rather than "...and here's the exact failure." The Flip Reality should name a POSITIVE reframe, not just invert a negative one.
- First Pull: open with the UPSIDE the advisor can capture, OR a brief scene of an advisor who did it RIGHT. Not with "most advisors are failing at X."
- Worth Knowing myTakes: at least 2 of 3 must name the OPPORTUNITY the trend creates for independent advisors, not the threat it poses. "Advisors who adopt X this quarter capture Y" instead of "Advisors who ignore X get caught by Y."
- Main Content: keep the same core topic + facts, but reframe toward the SPECIFIC MOVE the reader can execute Monday to GAIN something (dollars, time, closed clients, confident recommendations). The closing lands on a try-this-Monday action, not a warning.
- Grounds for Thought: orient toward action/possibility, not loss.
- Ancient Truth application: tie to the positive move, not the avoided failure.
- P.S.: a question that opens possibility, not one that twists the knife.

# BANNED headline / closing shapes (will be caught by the headline rewriter if you miss)
- "X isn't Y, it's Z" (deflating comparison)
- "Your X is broken/dead/wrong/failing"
- "What X doesn't see/know/notice"
- "The X you're missing/losing/forgetting"
- "The X that proves/reveals/shows you Y" (threat frame)
- "The X that's killing/costing/breaking"
- "The gap between X and Y"
- "Stop/Quit/Don't X" (negative directive)
- "The hidden cost/price/tax of X"
- "Why your X is wrong/broken"

# What NOT to do
- Don't add new facts not in the original.
- Don't change source URLs or the Ancient Truth verse.
- Don't add em dashes (use commas, periods, "...").
- Don't use AI vocabulary (crucial, robust, comprehensive, nuanced, delve).
- Don't preach or shout. Direct is not negative. Sharp is not negative.
- Don't water down the specifics — "do X on Tuesday" beats "consider doing X sometime."

Return the FULL revised JSON object with the same schema as the input. No preamble, no markdown fences.`;

function extractJsonObject(text: string): string {
  const t = text.trim();
  let firstBrace = t.indexOf("{");
  if (t.startsWith("```")) {
    const lines = t.split("\n");
    if (lines.length >= 3 && lines[lines.length - 1]!.startsWith("```")) {
      const body = lines.slice(1, -1).join("\n").trim();
      firstBrace = body.indexOf("{");
      if (firstBrace === -1) throw new Error("no JSON object found");
      return findBalanced(body, firstBrace);
    }
  }
  if (firstBrace === -1) throw new Error("no JSON object found");
  return findBalanced(t, firstBrace);
}

function findBalanced(s: string, start: number): string {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced JSON");
}

function deepStripDashes<T>(v: T): T {
  if (typeof v === "string") return v.replace(/[—–‒]/g, ", ") as unknown as T;
  if (Array.isArray(v)) return v.map(deepStripDashes) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
      out[k] = deepStripDashes(vv);
    }
    return out as T;
  }
  return v;
}

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const issueDate = url.searchParams.get("issueDate");
  const writeDate = url.searchParams.get("writeDate") ?? issueDate;
  const tone = url.searchParams.get("tone") ?? "contrarian"; // "contrarian" (default, legacy) | "value-forward" (positive flip)
  const REWRITE_SYSTEM = tone === "value-forward" ? REWRITE_SYSTEM_VALUE_FORWARD : REWRITE_SYSTEM_CONTRARIAN;
  const userIntent = tone === "value-forward"
    ? "FLIP the voice from threat/problem-identification to opportunity/instruction. Keep every fact, source, URL, and verse exactly the same. The same scene, the same stats — reoriented toward the advisor's AGENCY (what they can MAKE happen) instead of their LIABILITY (what will catch them)."
    : "Sharpen the voice toward more contrarian + more engaging.";
  if (!issueDate || !writeDate) {
    return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supabaseUrl || !supabaseKey || !anthropicKey) {
    return NextResponse.json(
      { error: "missing env: SUPABASE_URL / SERVICE_ROLE / ANTHROPIC_API_KEY" },
      { status: 500 },
    );
  }

  const db = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: row, error } = await db
    .from("daily_grind_issues")
    .select("issue_date, sections, subject, headline, preheader, model")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });

  const original = row.sections as DailyGrindContent;
  if (!original || typeof original !== "object") {
    return NextResponse.json({ error: "issue has no sections" }, { status: 500 });
  }

  logger.info("rewrite_issue.start", { source_date: issueDate, target_date: writeDate });

  const client = new Anthropic({ apiKey: anthropicKey });
  const userPrompt = `Here is the original issue JSON. Rewrite it per the system instructions. ${userIntent}

ORIGINAL ISSUE:
${JSON.stringify(original, null, 2)}

Return the rewritten JSON object only.`;

  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    temperature: 0.55,
    system: REWRITE_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    return NextResponse.json({ error: "no text block in response" }, { status: 500 });
  }
  let rewritten: DailyGrindContent;
  try {
    const json = extractJsonObject(block.text);
    rewritten = deepStripDashes(JSON.parse(json) as DailyGrindContent);
  } catch (err) {
    return NextResponse.json(
      {
        error: "parse failed",
        message: err instanceof Error ? err.message : String(err),
        firstChars: block.text.slice(0, 300),
      },
      { status: 500 },
    );
  }

  // Re-render HTML and persist under writeDate
  const rendered = renderDailyGrindHtml(rewritten, {
    issueDate: writeDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?test=true",
    webArchiveUrl: "https://castorabbott.com/newsletter/grind/",
  });

  const latencyMs = Date.now() - start;
  const rewriteMeta: Record<string, unknown> = {
    source: "rewrite-issue",
    sourceDate: issueDate,
    tone,
    rewriteInputTokens: response.usage.input_tokens,
    rewriteOutputTokens: response.usage.output_tokens,
  };
  const mergedMeta = await mergePreviousVersion(db, "daily_grind_issues", writeDate, rewriteMeta);
  const { error: upsertErr } = await db.from("daily_grind_issues").upsert(
    {
      issue_date: writeDate,
      subject: rewritten.headline,
      headline: rewritten.headline,
      preheader: rewritten.preheader,
      sections: rewritten as unknown as Record<string, unknown>,
      html: rendered.html,
      text_body: rendered.text,
      model: MODEL,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost_usd: 0,
      latency_ms: latencyMs,
      generation_meta: mergedMeta,
    },
    { onConflict: "issue_date" },
  );
  if (upsertErr) {
    return NextResponse.json({ error: `upsert: ${upsertErr.message}` }, { status: 500 });
  }

  try {
    await persistIssueVersion(db, {
      brand: "daily-grind",
      issueDate: writeDate,
      subject: rewritten.headline,
      headline: rewritten.headline,
      preheader: rewritten.preheader ?? null,
      html: rendered.html,
      textBody: rendered.text,
      sections: rewritten as unknown,
      generationMeta: {
        source: "rewrite-issue",
        sourceDate: issueDate,
        tone: "more-contrarian",
        rewriteInputTokens: response.usage.input_tokens,
        rewriteOutputTokens: response.usage.output_tokens,
      },
      source: "rewrite_issue",
      sourceNote: `sourceDate=${issueDate}`,
    });
  } catch (err) {
    logger.warn("rewrite_issue.version_persist_failed", { writeDate, error: err instanceof Error ? err.message : String(err) });
  }

  return NextResponse.json({
    ok: true,
    sourceDate: issueDate,
    writeDate,
    newHeadline: rewritten.headline,
    latencyMs,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
