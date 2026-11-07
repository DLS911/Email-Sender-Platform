/**
 * GET /api/admin/debug-env-key?test=<cron secret>
 *
 * Returns the FIRST 8 CHARS of GOOGLE_API_KEY at runtime to confirm which
 * key the running function actually has. Full key is NEVER returned.
 * Built 2026-11-07 to debug why Gemini image calls kept returning 429
 * after Mark rotated the key via Vercel env var.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const url = new URL(req.url);
  const q = url.searchParams.get("test");
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${cronSecret}` || q === cronSecret;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = process.env.GOOGLE_API_KEY ?? "";
  return NextResponse.json({
    envName: "GOOGLE_API_KEY",
    present: raw.length > 0,
    firstEight: raw.slice(0, 8),
    length: raw.length,
    deploymentUrl: process.env.VERCEL_URL ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    region: process.env.VERCEL_REGION ?? null,
  });
}
