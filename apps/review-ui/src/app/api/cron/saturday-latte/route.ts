import { logger } from "@platform/observability";
import { NextResponse } from "next/server";
import { runLatteSend } from "../../../../lib/saturday-latte-cron";

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
    logger.warn("cron.saturday_latte.unauthorized", {});
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const overrideIssueDate = url.searchParams.get("overrideIssueDate") ?? undefined;

  logger.info("cron.saturday_latte.start", { via: auth.via, force, overrideIssueDate });

  try {
    const result = await runLatteSend({ force, ...(overrideIssueDate ? { overrideIssueDate } : {}) });
    logger.info("cron.saturday_latte.complete", {
      subscribers_checked: result.subscribersChecked,
      subscribers_due_now: result.subscribersDueNow,
      sent_count: result.sent.length,
      fallback_count: result.sent.filter((s) => s.fallback).length,
      error_count: result.errors.length,
    });
    return NextResponse.json(result);
  } catch (err) {
    const error_message = err instanceof Error ? err.message : String(err);
    logger.error("cron.saturday_latte.fatal", { error_message });
    return NextResponse.json({ error: "cron_failed", message: error_message }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
