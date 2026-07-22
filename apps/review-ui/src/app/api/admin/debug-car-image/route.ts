/**
 * Debug endpoint for The Drive car reference lookup.
 *
 *   GET /api/admin/debug-car-image?car=2024%20BMW%20M2%20(G87)&test=<CRON_SECRET>
 *
 * Returns Haiku's candidate URLs and the download attempt result for each.
 * Used to diagnose why driveUsedReference:False keeps happening in prod.
 */

import { NextResponse } from "next/server";
import { diagnoseCarReferenceLookup } from "../../../../lib/saturday-latte-car-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const car = url.searchParams.get("car")?.trim();
  if (!car) {
    return NextResponse.json({ error: "missing ?car parameter" }, { status: 400 });
  }
  try {
    const result = await diagnoseCarReferenceLookup(car);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: "diagnose_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
