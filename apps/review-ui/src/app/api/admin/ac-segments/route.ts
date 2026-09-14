/**
 * GET /api/admin/ac-segments?test=<CRON_SECRET>
 *
 * Lists every segment in the AC account so we can identify the IDs
 * of the three named segments ("ca new contact 2026", "ca subbed not
 * engaged 2026", "ca subbed and engaged"). Also returns every list
 * for reference.
 */

import { NextResponse } from "next/server";
import { listSegments, listLists } from "../../../../lib/activecampaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  return authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const [segments, lists] = await Promise.all([listSegments(), listLists()]);
    return NextResponse.json({ segments, lists });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
