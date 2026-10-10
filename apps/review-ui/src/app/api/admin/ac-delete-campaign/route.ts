/**
 * POST /api/admin/ac-delete-campaign
 *   { campaignId }
 *
 * Deletes an AC campaign by id. Used to cancel a scheduled send when
 * the issue content has changed and we need to re-push updated HTML
 * (AC caches the message HTML at push time).
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { deleteCampaign } from "../../../../lib/activecampaign";

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

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { campaignId?: string | number };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const id = body.campaignId;
  if (!id) return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  const ok = await deleteCampaign(id);
  logger.info("ac_delete_campaign", { campaignId: id, ok });
  return NextResponse.json({ ok, campaignId: id });
}
