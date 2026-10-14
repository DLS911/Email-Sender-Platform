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

async function acGet<T = Record<string, unknown>>(path: string): Promise<T | null> {
  const token = process.env.AC_API_TOKEN ?? "";
  const base = (process.env.AC_API_URL ?? "").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/3${path}`, { headers: { "Api-Token": token, "Accept": "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const listId = url.searchParams.get("listId");
  const campaignId = url.searchParams.get("campaignId");
  const recent = url.searchParams.get("recent");
  const messageIdEarly = url.searchParams.get("messageId");
  if (!listId && !campaignId && !recent && !messageIdEarly) return NextResponse.json({ error: "listId, campaignId, recent, or messageId required" }, { status: 400 });

  if (recent) {
    const limit = Math.min(100, Math.max(1, Number(recent)));
    const filterListId = url.searchParams.get("filterListId");
    // AC embeds campaign-list links; use include=lists to fetch the list ids inline.
    const pages: Array<Record<string, unknown>> = [];
    const pageSize = 100;
    for (let offset = 0; offset < limit; offset += pageSize) {
      const take = Math.min(pageSize, limit - offset);
      const r = await acGet<{ campaigns?: Array<Record<string, unknown>>; included?: Array<Record<string, unknown>> }>(
        `/campaigns?limit=${take}&offset=${offset}&orders[sdate]=DESC&include=lists`,
      );
      if (!r?.campaigns || r.campaigns.length === 0) break;
      pages.push(...r.campaigns);
      if (r.campaigns.length < take) break;
    }
    const campaigns = pages;
    // Build id→listIds map from included or from each campaign's links/relationships.
    const out = await Promise.all(campaigns.map(async (c) => {
      // AC's canonical path: /campaigns/:id/campaignListss (yes with
      // the trailing 's') or /campaigns/:id/lists. Try lists first.
      let listIds: string[] = [];
      const cid = String(c.id);
      const direct = await acGet<{ lists?: Array<{ id: string }> }>(`/campaigns/${cid}/lists`);
      if (direct?.lists) {
        listIds = direct.lists.map((l) => String(l.id));
      }
      if (listIds.length === 0) {
        const alt = await acGet<{ campaignLists?: Array<{ listid: string }> }>(`/campaigns/${cid}/campaignLists`);
        if (alt?.campaignLists) {
          listIds = alt.campaignLists.map((l) => String(l.listid));
        }
      }
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        sdate: c.sdate,
        ldate: c.ldate,
        send_amt: c.send_amt,
        opens: c.opens,
        listIds,
      };
    }));
    const filtered = filterListId ? out.filter((c) => c.listIds.includes(filterListId)) : out;
    return NextResponse.json({ recent: filtered, scannedTotal: out.length });
  }

  const out: Record<string, unknown> = {};
  const unsubsSince = url.searchParams.get("unsubsSince"); // "2026-10-09" → counts list13 unsubs after that date
  if (listId && unsubsSince) {
    // Walk contactLists on this list where status=2 (unsubscribed),
    // oldest page returned first; collect those whose sdate > the floor.
    let totalAfter = 0;
    let scanned = 0;
    const sample: Array<{ email: string | undefined; udate: string | undefined; sdate: string | undefined }> = [];
    const pageSize = 100;
    const floor = new Date(unsubsSince).getTime();
    // No short-circuit: AC's contactLists ordering is unreliable, so
    // walk every row for this list+status, filter by udate client-side.
    for (let offset = 0; offset < 10000; offset += pageSize) {
      const r = await acGet<{ contactLists?: Array<Record<string, unknown>>; contacts?: Array<Record<string, unknown>> }>(
        `/contactLists?filters[listid]=${encodeURIComponent(listId)}&filters[status]=2&limit=${pageSize}&offset=${offset}&include=contact`,
      );
      const rows = r?.contactLists ?? [];
      if (rows.length === 0) break;
      scanned += rows.length;
      const contacts = r?.contacts ?? [];
      for (const row of rows) {
        const udate = String(row.udate ?? "");
        const sdate = String(row.sdate ?? "");
        const t = Date.parse(udate || sdate);
        if (!Number.isFinite(t)) continue;
        if (t < floor) continue;
        totalAfter++;
        if (sample.length < 10) {
          const cid = String(row.contact ?? "");
          const c = contacts.find((x) => String(x.id) === cid) as { email?: string } | undefined;
          sample.push({ email: c?.email, udate: udate || undefined, sdate: sdate || undefined });
        }
      }
      if (rows.length < pageSize) break;
    }
    return NextResponse.json({ listId, unsubsSince, scanned, unsubscribes_after_date: totalAfter, sample });
  }

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
  const messageId = url.searchParams.get("messageId");
  if (messageId) {
    const m = await acGet<{ message?: Record<string, unknown> }>(`/messages/${messageId}`);
    const htmlSnip = typeof m?.message?.html === "string" ? (m.message.html as string) : "";
    return NextResponse.json({
      message: m?.message ? {
        id: m.message.id,
        name: m.message.name,
        subject: m.message.subject,
        preheader_text: m.message.preheader_text,
        fromname: m.message.fromname,
        fromemail: m.message.fromemail,
        html_len: htmlSnip.length,
        html_contains_headline_your_best: htmlSnip.includes("best clients stopped showing up"),
        html_contains_headline_ask_one: htmlSnip.includes("Ask one question"),
      } : { id: messageId, error: "not found" },
    });
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
