/**
 * GET /api/admin/ac-click-trace?campaignId=509
 *
 * Returns per-contact click events for an AC campaign:
 *   contact email → list of clicks (link URL, timestamp, seconds-since-send).
 *
 * Built for Mark's 10-19 question: "unique clicks have been 16 to 18 on
 * every send. Is that the same core readers every time, or is it email
 * security scanners clicking links on delivery?" A click within 30-60s
 * of the campaign send start is almost certainly a scanner (Mimecast,
 * Barracuda, Proofpoint URL Defense all pre-visit links on arrival).
 *
 * AC's /campaigns/:id/trackedLinks returns the tracked links with
 * aggregate counts; /contactLinks?filters[linkid]=X returns per-contact
 * events with lastclick + total_clicks. We can't get every click
 * individually via API (that's the reports CSV export), but lastclick
 * timestamp + the campaign send timestamp lets us compute delta-seconds
 * for each clicker, which answers the scanner question.
 */

import { NextResponse } from "next/server";

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

async function ac<T = Record<string, unknown>>(path: string): Promise<T | null> {
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
  const campaignId = url.searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  // 1. Fetch campaign to anchor send timestamp.
  const campResp = await ac<{ campaign?: Record<string, unknown> }>(`/campaigns/${campaignId}`);
  const camp = campResp?.campaign;
  if (!camp) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  const sendStart = String(camp.ldate ?? camp.sdate ?? "");
  const sendStartMs = Date.parse(sendStart);

  // 2. Fetch tracked links for the campaign.
  const linksResp = await ac<{ campaignLinks?: Array<Record<string, unknown>>; links?: Array<Record<string, unknown>> }>(
    `/campaigns/${campaignId}/links`,
  );
  const trackedLinks = linksResp?.campaignLinks ?? linksResp?.links ?? [];

  // 3. For each link, pull contactLinks (per-contact click records with lastclick + total_clicks).
  const perLinkClicks: Array<{
    link: { id: string; url: string; totalClicks: number; uniqueClicks: number };
    clicks: Array<{ contactId: string; totalClicks: number; firstClick: string | null; lastClick: string | null; secondsAfterSend: number | null }>;
  }> = [];

  const contactIds = new Set<string>();
  for (const link of trackedLinks) {
    const linkId = String(link.id ?? "");
    const linkUrl = String(link.link ?? link.url ?? "");
    const totalClicks = Number(link.clicks ?? link.totalClicks ?? 0);
    const uniqueClicks = Number(link.uniqueClicks ?? 0);
    if (!linkId) continue;
    const clickResp = await ac<{ contactLinks?: Array<Record<string, unknown>> }>(
      `/contactLinks?filters[linkid]=${encodeURIComponent(linkId)}&limit=100`,
    );
    const perContact = (clickResp?.contactLinks ?? []).map((cl) => {
      const contactId = String(cl.contact ?? "");
      if (contactId) contactIds.add(contactId);
      const total = Number(cl.clicks ?? cl.totalClicks ?? 0);
      const firstClick = cl.firstclick ? String(cl.firstclick) : null;
      const lastClick = cl.lastclick ? String(cl.lastclick) : null;
      const anchor = firstClick ?? lastClick;
      const anchorMs = anchor ? Date.parse(anchor) : NaN;
      const seconds = Number.isFinite(anchorMs) && Number.isFinite(sendStartMs) ? Math.round((anchorMs - sendStartMs) / 1000) : null;
      return { contactId, totalClicks: total, firstClick, lastClick, secondsAfterSend: seconds };
    });
    perLinkClicks.push({
      link: { id: linkId, url: linkUrl, totalClicks, uniqueClicks },
      clicks: perContact,
    });
  }

  // 4. Resolve contact IDs → emails (one batch).
  const emailById = new Map<string, string>();
  for (const cid of contactIds) {
    const c = await ac<{ contact?: { email?: string } }>(`/contacts/${encodeURIComponent(cid)}`);
    const email = c?.contact?.email ?? "";
    if (email) emailById.set(cid, email);
  }

  // 5. Build the human-readable click summary.
  const summary = perLinkClicks.map((pl) => ({
    link: pl.link,
    clicks: pl.clicks.map((c) => ({
      email: emailById.get(c.contactId) ?? c.contactId,
      totalClicks: c.totalClicks,
      firstClick: c.firstClick,
      secondsAfterSend: c.secondsAfterSend,
      // Scanner flag: first click within 60 seconds of campaign send
      // start is almost certainly automated URL-defense pre-visit.
      likelyScanner: c.secondsAfterSend != null && c.secondsAfterSend >= 0 && c.secondsAfterSend <= 60,
    })),
  }));

  // Aggregate scanner-vs-human split across all links.
  const flatClicks = summary.flatMap((s) => s.clicks);
  const scannerCount = flatClicks.filter((c) => c.likelyScanner).length;
  const humanCount = flatClicks.length - scannerCount;

  return NextResponse.json({
    campaignId,
    campaignName: camp.name ?? null,
    sendStart,
    totalContactsWithClickRecords: contactIds.size,
    linkCount: trackedLinks.length,
    aggregate: {
      scannerLikelyClicks: scannerCount,
      humanClicks: humanCount,
      scannerFraction: flatClicks.length > 0 ? Math.round((scannerCount / flatClicks.length) * 100) : null,
    },
    links: summary,
  });
}
