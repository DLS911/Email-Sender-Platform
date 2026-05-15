import { logger } from "@platform/observability";
import { NextResponse } from "next/server";
import { runDailyGrindGenerate } from "../../../../lib/daily-grind-cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: Request): { ok: boolean; via: "cron" | "manual" | "none" } {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");

  if (!cronSecret) return { ok: false, via: "none" };
  if (authHeader === `Bearer ${cronSecret}`) return { ok: true, via: "cron" };
  if (querySecret && querySecret === cronSecret) return { ok: true, via: "manual" };
  return { ok: false, via: "none" };
}

async function handle(req: Request): Promise<NextResponse> {
  const auth = isAuthorized(req);
  if (!auth.ok) {
    logger.warn("cron.daily_grind_generate.unauthorized", {});
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  let targetDate = url.searchParams.get("targetDate") ?? undefined;
  const topicHint = url.searchParams.get("topicHint") ?? undefined;
  const regenerate = url.searchParams.get("regenerate") === "1";
  const mode = url.searchParams.get("mode");
  if (!targetDate && mode) {
    const now = new Date();
    if (mode === "today") {
      targetDate = now.toISOString().slice(0, 10);
    } else if (mode === "tomorrow") {
      targetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
  }

  logger.info("cron.daily_grind_generate.start", {
    via: auth.via,
    target_date: targetDate ?? null,
    topic_hint: topicHint ?? null,
    regenerate,
  });

  try {
    const result = await runDailyGrindGenerate({
      ...(targetDate ? { targetDate } : {}),
      ...(topicHint ? { topicHint } : {}),
      regenerate,
    });
    logger.info("cron.daily_grind_generate.complete", {
      target_date: result.targetDate,
      generated: result.generated,
      reused_existing: result.reusedExisting,
      cost_usd: result.costUsd ?? 0,
      latency_ms: result.latencyMs ?? 0,
      brain_concepts: result.brainConceptsPersisted ?? 0,
      error: result.error ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    const error_message = err instanceof Error ? err.message : String(err);
    logger.error("cron.daily_grind_generate.fatal", { error_message });
    return NextResponse.json({ error: "generate_failed", message: error_message }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
