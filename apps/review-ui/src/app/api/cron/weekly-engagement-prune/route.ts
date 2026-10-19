/**
 * Weekly engagement pruner — tags list-43 contacts who've had zero
 * clicks in the last 30 days with `low-engagement-30d`.
 *
 * Mark's 10-19 ask (#5): "Can we set up a rule that moves anyone with
 * no clicks in 30 days to a less frequent send?"
 *
 * Pattern: our platform maintains the TAG. Mark sets up the AC
 * Automation on his end:
 *   - Trigger: tag `low-engagement-30d` added
 *   - Action: remove from list 43, add to "Monthly Latte Only" list
 *     (or whatever Mark names the lower-frequency list).
 *
 * Why tag-only (not list-move) here: AC's list membership is Mark's
 * mental model, and he should see what's happening in the AC UI. The
 * tag is the signal; the AC Automation is the policy.
 *
 * Schedule: run every Sunday 15:00 UTC (10am ET) so the current week
 * sees a stable list before Monday's DG goes out.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: Request): { ok: boolean; via: "cron" | "manual" | "none" } {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return { ok: false, via: "none" };
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  if (authHeader === `Bearer ${cronSecret}`) return { ok: true, via: "cron" };
  if (querySecret && querySecret === cronSecret) return { ok: true, via: "manual" };
  return { ok: false, via: "none" };
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

async function acPost(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number }> {
  const token = process.env.AC_API_TOKEN ?? "";
  const base = (process.env.AC_API_URL ?? "").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/3${path}`, {
      method: "POST",
      headers: { "Api-Token": token, "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status };
  } catch { return { ok: false, status: 0 }; }
}

async function findOrCreateTag(name: string): Promise<string | null> {
  const list = await acGet<{ tags?: Array<{ id: string; tag: string }> }>(`/tags?search=${encodeURIComponent(name)}&limit=25`);
  const match = (list?.tags ?? []).find((t) => t.tag === name);
  if (match) return match.id;
  const token = process.env.AC_API_TOKEN ?? "";
  const base = (process.env.AC_API_URL ?? "").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/3/tags`, {
      method: "POST",
      headers: { "Api-Token": token, "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ tag: { tag: name, tagType: "contact", description: "Auto-maintained by weekly-engagement-prune" } }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { tag?: { id: string } };
    return j.tag?.id ?? null;
  } catch { return null; }
}

async function hasRecentClick(contactId: string, sinceMs: number): Promise<boolean> {
  const resp = await acGet<{ contactLinks?: Array<{ lastclick?: string }> }>(
    `/contacts/${encodeURIComponent(contactId)}/contactLinks?limit=100`,
  );
  const rows = resp?.contactLinks ?? [];
  for (const row of rows) {
    const t = row.lastclick ? Date.parse(row.lastclick) : NaN;
    if (Number.isFinite(t) && t >= sinceMs) return true;
  }
  return false;
}

async function handle(req: Request): Promise<NextResponse> {
  const auth = isAuthorized(req);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const listId = String(url.searchParams.get("listId") ?? process.env.NEWSLETTER_LIST_IDS?.split(",")[0] ?? "43");
  const days = Number(url.searchParams.get("days") ?? 30);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const tagName = url.searchParams.get("tagName") ?? "low-engagement-30d";
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  logger.info("weekly_engagement_prune.start", { via: auth.via, listId, days, dryRun, tagName });

  // 1. Ensure tag exists (skip in dry-run).
  let tagId: string | null = null;
  if (!dryRun) {
    tagId = await findOrCreateTag(tagName);
    if (!tagId) return NextResponse.json({ error: "failed to find/create tag" }, { status: 500 });
  }

  // 2. List all active contacts on target list.
  const contactIds: string[] = [];
  const pageSize = 100;
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const r = await acGet<{ contactLists?: Array<{ contact?: string }> }>(
      `/contactLists?filters[listid]=${encodeURIComponent(listId)}&filters[status]=1&limit=${pageSize}&offset=${offset}`,
    );
    const rows = r?.contactLists ?? [];
    if (rows.length === 0) break;
    for (const row of rows) if (row.contact) contactIds.push(String(row.contact));
    if (rows.length < pageSize) break;
  }

  // 3. For each contact, check if they clicked anything in the window.
  let scanned = 0;
  let noClickCount = 0;
  let tagged = 0;
  let errors = 0;
  const noClickSample: Array<{ contactId: string; email: string | undefined }> = [];
  for (const cid of contactIds) {
    scanned++;
    const recent = await hasRecentClick(cid, sinceMs);
    if (recent) continue;
    noClickCount++;
    if (noClickSample.length < 10) {
      const c = await acGet<{ contact?: { email?: string } }>(`/contacts/${encodeURIComponent(cid)}`);
      noClickSample.push({ contactId: cid, email: c?.contact?.email });
    }
    if (dryRun) continue;
    const res = await acPost(`/contactTags`, { contactTag: { contact: cid, tag: tagId } });
    if (res.ok || res.status === 422) tagged++;
    else errors++;
  }

  logger.info("weekly_engagement_prune.done", { listId, days, dryRun, scanned, noClickCount, tagged, errors });
  return NextResponse.json({
    ok: true,
    via: auth.via,
    listId,
    windowDays: days,
    cutoffISO: new Date(sinceMs).toISOString(),
    dryRun,
    tagName,
    tagId,
    totals: { scanned, noClickCount, tagged, errors },
    noClickSample,
    note: "Set up the AC Automation: trigger on tag `low-engagement-30d` added → remove from list 43, add to a 'Monthly Latte Only' list. This endpoint only maintains the tag.",
  });
}

export async function GET(req: Request): Promise<NextResponse> { return handle(req); }
export async function POST(req: Request): Promise<NextResponse> { return handle(req); }
