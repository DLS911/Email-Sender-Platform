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

const REWRITE_SYSTEM = `You are rewriting an existing Daily Grind newsletter issue in Mark's voice — sharper, more contrarian, more engaging. The reader is an independent financial advisor. Mark talks like a builder, not a consultant: direct, opinionated, specific, slightly wry.

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
  const userPrompt = `Here is the original issue JSON. Rewrite it per the system instructions. Keep all facts, sources, URLs, and the verse exactly the same. Sharpen the voice toward more contrarian + more engaging.

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
      generation_meta: {
        source: "rewrite-issue",
        sourceDate: issueDate,
        tone: "more-contrarian",
        rewriteInputTokens: response.usage.input_tokens,
        rewriteOutputTokens: response.usage.output_tokens,
      },
    },
    { onConflict: "issue_date" },
  );
  if (upsertErr) {
    return NextResponse.json({ error: `upsert: ${upsertErr.message}` }, { status: 500 });
  }

  const latencyMs = Date.now() - start;
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
