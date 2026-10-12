/**
 * POST /api/admin/ac-cancel-campaign
 *   { campaignId }
 *
 * Cancels a scheduled AC campaign by setting status=0 (draft), then
 * attempts delete. AC refuses to delete a scheduled campaign — unschedule
 * first. Returns both step results so the caller can see what happened.
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

async function acPut(path: string, bodyObj: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: string }> {
  const token = process.env.AC_API_TOKEN ?? "";
  const base = (process.env.AC_API_URL ?? "").replace(/\/$/, "");
  const url = `${base}/api/3${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Api-Token": token, "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 600) };
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { campaignId?: string | number; confirmCancel?: boolean };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const id = body.campaignId;
  if (!id) return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  if (body.confirmCancel !== true) {
    return NextResponse.json({
      error: "destructive: pass confirmCancel:true to proceed. Use /api/admin/ac-inspect?campaignId=... for a read-only status check.",
    }, { status: 400 });
  }

  const unschedule = await acPut(`/campaigns/${id}`, { campaign: { status: 0, sdate: null } });
  const del = await deleteCampaign(id);
  logger.info("ac_cancel_campaign", { campaignId: id, unscheduleOk: unschedule.ok, unscheduleStatus: unschedule.status, deleteOk: del });
  return NextResponse.json({
    campaignId: id,
    unschedule: { ok: unschedule.ok, status: unschedule.status, body: unschedule.body },
    deleteOk: del,
  });
}
