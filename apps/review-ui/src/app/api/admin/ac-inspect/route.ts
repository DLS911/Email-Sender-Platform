/**
 * GET /api/admin/ac-inspect?listId=13&campaignId=502
 *
 * READ-ONLY. Fetches an AC list and/or campaign and returns the key
 * fields. Built after a near-miss where ac-cancel-campaign was used
 * for "status check" and destroyed a live campaign record.
 *
 * Pass either or both of listId / campaignId. No side effects.
 */

import { NextResponse } from "next/server";
import { getCampaign, getList } from "../../../../lib/activecampaign";

async function acGetMetaTotal(path: string): Promise<number | null> {
  const token = process.env.AC_API_TOKEN ?? "";
  const base = (process.env.AC_API_URL ?? "").replace(/\/$/, "");
  const url = `${base}/api/3${path}`;
  try {
    const res = await fetch(url, { headers: { "Api-Token": token, "Accept": "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as { meta?: { total?: string | number } };
    const t = j.meta?.total;
    if (t == null) return null;
    const n = typeof t === "string" ? Number(t) : t;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const q = url.searchParams.get("test");
  return authHeader === `Bearer ${cronSecret}` || q === cronSecret;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const listId = url.searchParams.get("listId");
  const campaignId = url.searchParams.get("campaignId");
  if (!listId && !campaignId) return NextResponse.json({ error: "listId or campaignId required" }, { status: 400 });

  const out: Record<string, unknown> = {};
  if (listId) {
    const [l, activeCount, unsubCount, allCount] = await Promise.all([
      getList(listId),
      acGetMetaTotal(`/contacts?listid=${encodeURIComponent(listId)}&status=1&limit=1`),
      acGetMetaTotal(`/contacts?listid=${encodeURIComponent(listId)}&status=2&limit=1`),
      acGetMetaTotal(`/contacts?listid=${encodeURIComponent(listId)}&limit=1`),
    ]);
    if (!l) {
      out.list = { id: listId, error: "not found" };
    } else {
      out.list = {
        id: l.id,
        name: l.name,
        active_subscribers: activeCount,
        unsubscribed: unsubCount,
        total_on_list_any_status: allCount,
        sender_addr1: l.sender_addr1,
        stringid: l.stringid,
      };
    }
  }
  if (campaignId) {
    const c = await getCampaign(campaignId);
    if (!c) {
      out.campaign = { id: campaignId, error: "not found" };
    } else {
      out.campaign = {
        id: c.id,
        name: c.name,
        status: c.status,
        sdate: c.sdate,
        ldate: c.ldate,
        send_amt: c.send_amt,
        total_amt: c.total_amt,
        opens: c.opens,
        uniqueopens: c.uniqueopens,
        linkclicks: c.linkclicks,
        uniquelinkclicks: c.uniquelinkclicks,
        unsubscribes: c.unsubscribes,
        hardbounces: c.hardbounces,
        softbounces: c.softbounces,
      };
    }
  }
  return NextResponse.json(out);
}
