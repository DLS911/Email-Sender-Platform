import { logger } from "@platform/observability";
import { NextResponse } from "next/server";
import { runDailyGrindCron, runDailyGrindSend } from "../../../../lib/daily-grind-cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    logger.warn("cron.daily_grind.unauthorized", {});
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const skipCache = url.searchParams.get("nocache") === "1";
  const topicHint = url.searchParams.get("topicHint") ?? undefined;
  const action = url.searchParams.get("action") ?? "send";
  const overrideIssueDate = url.searchParams.get("overrideIssueDate") ?? undefined;

  // action=full → legacy combined flow (generate + send) for manual fires.
  // action=send (default) → fast send-only path, used by the hourly cron.
  // Forcing nocache, topicHint, or skipCache implies action=full intent.
  const wantsFull = action === "full" || skipCache || topicHint || (force && action === "full");

  logger.info("cron.daily_grind.start", {
    via: auth.via,
    action,
    force,
    skipCache,
    topic_hint: topicHint ?? null,
    mode: wantsFull ? "full" : "send-only",
  });

  try {
    if (wantsFull) {
      const result = await runDailyGrindCron(
        topicHint ? { force, skipCache, topicHint } : { force, skipCache },
      );
      logger.info("cron.daily_grind.complete", {
        mode: "full",
        subscribers_checked: result.subscribersChecked,
        subscribers_due_now: result.subscribersDueNow,
        sent_count: result.sent.length,
        issue_generated: result.issueGenerated,
        issue_date: result.issueDate ?? null,
      });
      return NextResponse.json(result);
    }

    const result = await runDailyGrindSend({
      force,
      ...(overrideIssueDate ? { overrideIssueDate } : {}),
    });
    logger.info("cron.daily_grind.complete", {
      mode: "send-only",
      subscribers_checked: result.subscribersChecked,
      subscribers_due_now: result.subscribersDueNow,
      sent_count: result.sent.length,
      fallback_count: result.sent.filter((s) => s.fallback).length,
      error_count: result.errors.length,
    });
    return NextResponse.json(result);
  } catch (err) {
    const error_message = err instanceof Error ? err.message : String(err);
    logger.error("cron.daily_grind.fatal", { error_message });
    return NextResponse.json({ error: "cron_failed", message: error_message }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
