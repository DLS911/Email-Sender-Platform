/**
 * Research-only diagnostic endpoint.
 *
 * Runs ONLY the research phase (Gemini → Anthropic fallback) and returns
 * the bundle + funnel stats. Skips the writer phase entirely, so each
 * call is ~$0.05 (Gemini) or ~$0.30 (Anthropic fallback) instead of the
 * full ~$0.20-0.50 of a complete generation.
 *
 * Use this for stress testing the research pipeline. Hit it 5-10 times
 * with different dates to verify reliability and source quality without
 * burning writer-call cost.
 */

import { logger } from "@platform/observability";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { runGeminiResearch } from "../../../../lib/daily-grind-research-gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const targetDate = url.searchParams.get("targetDate") ?? new Date().toISOString().slice(0, 10);
  const topicHint = url.searchParams.get("topicHint") ?? undefined;
  const recentTopicsParam = url.searchParams.get("recentTopics");
  const recentTopics = recentTopicsParam ? recentTopicsParam.split("|").filter(Boolean) : [];

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_API_KEY missing" }, { status: 500 });
  }

  logger.info("research_only.start", { target_date: targetDate });

  const start = Date.now();
  try {
    // Try Gemini twice; if both fail, attempt Anthropic web_search fallback.
    const gemOpts: Parameters<typeof runGeminiResearch>[0] = {
      issueDate: targetDate,
      recentTopics,
      recentConcepts: [],
    };
    if (topicHint) gemOpts.topicHint = topicHint;

    let geminiResult: Awaited<ReturnType<typeof runGeminiResearch>> | null = null;
    let geminiErrors: string[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        geminiResult = await runGeminiResearch(gemOpts);
        break;
      } catch (err) {
        geminiErrors.push(err instanceof Error ? err.message : String(err));
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    if (geminiResult) {
      return NextResponse.json({
        backend: "gemini",
        targetDate,
        totalLatencyMs: Date.now() - start,
        costUsd: geminiResult.costUsd,
        itemCount: geminiResult.bundle.items.length,
        sources: [...new Set(geminiResult.bundle.items.map((i) => i.source))],
        items: geminiResult.bundle.items.map((i) => ({
          source: i.source,
          title: i.title,
          url: i.url,
        })),
        funnel: geminiResult.funnel,
        geminiErrors,
      });
    }

    // Anthropic fallback (lightweight inline run — research phase only)
    return NextResponse.json({
      backend: "gemini-failed",
      targetDate,
      totalLatencyMs: Date.now() - start,
      geminiErrors,
      note: "Gemini exhausted 2 attempts. Anthropic fallback would run in the full pipeline; this endpoint stops here to keep costs low for stress testing.",
    });
  } catch (err) {
    const error_message = err instanceof Error ? err.message : String(err);
    logger.error("research_only.fatal", { error_message });
    return NextResponse.json({ error: "research_failed", message: error_message }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
