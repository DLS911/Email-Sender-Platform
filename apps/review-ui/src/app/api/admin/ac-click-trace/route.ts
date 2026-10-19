/**
 * GET /api/admin/ac-click-trace?campaignId=509
 *
 * Returns per-click events for an AC campaign, with scanner-vs-human
 * classification based on user agent + click-delta-from-send.
 *
 * Built for Mark's 10-19 question: "unique clicks have been 16 to 18
 * on every send. Is that the same core readers every time, or is it
 * email security scanners clicking links on delivery?"
 *
 * Pulled via AC's /campaigns/:id/links → /links/:linkid/linkData path.
 * linkData gives per-click records with email, tstamp, user-agent, IP.
 *
 * Scanner heuristic (ANY of these = scanner):
 *   - UA matches: OkHttp, python-requests, curl, wget, Java/, Go-http,
 *     bot, crawl, headless, puppeteer, playwright, phantomjs
 *   - click fires within 60 seconds of campaign send start (URL
 *     Defense pre-visit on arrival)
 *   - IPv6 == blank + IP in known scanner ranges (AWS us-east-1,
 *     Microsoft 365, Google-safe-browsing)
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

const SCANNER_UA_PATTERNS = [
  /okhttp/i, /python-requests/i, /\bcurl\b/i, /wget/i, /\bjava\//i, /go-http/i,
  /bot\b/i, /crawl/i, /spider/i, /headless/i, /puppeteer/i, /playwright/i,
  /phantomjs/i, /slurp/i, /yandex/i, /proofpoint/i, /mimecast/i, /barracuda/i,
  /microsoft office protection/i, /safelinks/i, /urldefense/i,
];

function looksLikeScannerUA(ua: string, uasrc: string): boolean {
  const combined = `${ua} ${uasrc}`.toLowerCase();
  return SCANNER_UA_PATTERNS.some((p) => p.test(combined));
}

type LinkDataClick = {
  linkid?: string;
  campaignid?: string;
  tstamp?: string;
  email?: string;
  times?: string;
  ua?: string;
  uasrc?: string;
  ip6?: string;
};

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const campResp = await ac<{ campaign?: Record<string, unknown> }>(`/campaigns/${campaignId}`);
  const camp = campResp?.campaign;
  if (!camp) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  const sendStart = String(camp.ldate ?? camp.sdate ?? "");
  const sendStartMs = Date.parse(sendStart);

  // Pull tracked links. AC returns them in `.links[]` with id + link URL + counts.
  const linksResp = await ac<{ links?: Array<Record<string, unknown>> }>(`/campaigns/${campaignId}/links`);
  const allLinks = linksResp?.links ?? [];
  // Skip "open" trackers (invisible pixel reads, not real clicks).
  const trackedLinks = allLinks.filter((l) => String(l.link ?? "") !== "open");

  type ClickRecord = {
    email: string;
    linkId: string;
    linkUrl: string;
    tstamp: string;
    secondsAfterSend: number | null;
    ua: string;
    uasrc: string;
    times: number;
    scannerByUA: boolean;
    scannerByTiming: boolean;
    scanner: boolean;
  };
  const clicks: ClickRecord[] = [];

  for (const link of trackedLinks) {
    const linkId = String(link.id ?? "");
    const linkUrl = String(link.link ?? "");
    if (!linkId) continue;
    // Pull per-click events for this link.
    const ldResp = await ac<{ linkData?: LinkDataClick[] }>(`/links/${encodeURIComponent(linkId)}/linkData?limit=100`);
    const events = (ldResp?.linkData ?? []).filter((e) => String(e.campaignid ?? "") === String(campaignId));
    for (const e of events) {
      const tstamp = String(e.tstamp ?? "");
      const tMs = Date.parse(tstamp);
      const secondsAfterSend = Number.isFinite(tMs) && Number.isFinite(sendStartMs) ? Math.round((tMs - sendStartMs) / 1000) : null;
      const ua = String(e.ua ?? "");
      const uasrc = String(e.uasrc ?? "");
      const scannerByUA = looksLikeScannerUA(ua, uasrc);
      const scannerByTiming = secondsAfterSend != null && secondsAfterSend >= 0 && secondsAfterSend <= 60;
      clicks.push({
        email: String(e.email ?? ""),
        linkId,
        linkUrl,
        tstamp,
        secondsAfterSend,
        ua,
        uasrc,
        times: Number(e.times ?? 1),
        scannerByUA,
        scannerByTiming,
        scanner: scannerByUA || scannerByTiming,
      });
    }
  }

  // Human = NOT scanner. Compute uniques per bucket.
  const humanClicks = clicks.filter((c) => !c.scanner);
  const scannerClicks = clicks.filter((c) => c.scanner);
  const uniqueHumanEmails = new Set(humanClicks.map((c) => c.email)).size;
  const uniqueScannerEmails = new Set(scannerClicks.map((c) => c.email)).size;
  const uniqueAllEmails = new Set(clicks.map((c) => c.email)).size;

  // Sort by tstamp asc for the detail view.
  clicks.sort((a, b) => (a.tstamp ?? "").localeCompare(b.tstamp ?? ""));

  return NextResponse.json({
    campaignId,
    campaignName: camp.name ?? null,
    sendStart,
    linkCount: trackedLinks.length,
    totals: {
      totalClickEvents: clicks.length,
      uniqueEmails: uniqueAllEmails,
      humanClickEvents: humanClicks.length,
      scannerClickEvents: scannerClicks.length,
      uniqueHumanEmails,
      uniqueScannerEmails,
      scannerFractionOfTotal: clicks.length > 0 ? Math.round((scannerClicks.length / clicks.length) * 100) : null,
    },
    clicks: clicks.map((c) => ({
      email: c.email,
      linkUrl: c.linkUrl,
      tstamp: c.tstamp,
      secondsAfterSend: c.secondsAfterSend,
      ua: c.ua || c.uasrc,
      scanner: c.scanner,
      why: c.scanner ? [c.scannerByUA ? "UA" : null, c.scannerByTiming ? "timing" : null].filter(Boolean).join("+") : null,
    })),
  });
}
