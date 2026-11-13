/**
 * POST /api/admin/ac-grow-list-from-list
 *   {
 *     sourceListId: 13,            // the parent list to draw from
 *     targetListId: 43,            // the list to grow
 *     addCount: 1046,              // how many NEW members to enroll this call
 *     prioritySegmentIds?: [383, 385],  // fill from these segments first, in order
 *     dryRun?: true                // plan only, enroll nothing
 *   }
 *
 * Grows an existing list from a bigger parent list. Built 2026-11-13 when
 * Mark asked to take "First 400 launch" (list 43, 908 active) to 3,000.
 * List 43 is a subset of list 13 "Castor Abbott Newsletter" (901/908
 * overlap), and the existing ac-build-launch-list tool samples from
 * SEGMENTS with a 500-read cap, so it couldn't do this.
 *
 * Candidate order: members of prioritySegmentIds[0] first, then [1], ...,
 * then the rest of the source list in AC's natural order. Anyone already
 * on the target list is excluded. Enrollment is sequential with a small
 * delay so AC's rate limit stays happy; call in batches of ~1,000 to stay
 * under the route timeout.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { addContactToList } from "../../../../lib/activecampaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

type Contact = { id: string; email: string };

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const url = new URL(req.url);
  const q = url.searchParams.get("test");
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${cronSecret}` || q === cronSecret;
}

function acBase(): { base: string; token: string } {
  const token = process.env.AC_API_TOKEN;
  const base = (process.env.AC_API_URL ?? "").replace(/\/$/, "") + "/api/3";
  if (!token || !base.includes("api-us")) throw new Error("AC env missing");
  return { base, token };
}

/** Page every contact matching an AC /contacts query. */
async function pageContacts(query: string, hardCap = 10000): Promise<Contact[]> {
  const { base, token } = acBase();
  const out: Contact[] = [];
  const pageSize = 100;
  let offset = 0;
  while (out.length < hardCap) {
    const res = await fetch(`${base}/contacts?${query}&limit=${pageSize}&offset=${offset}`, {
      headers: { "Api-Token": token, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`pageContacts(${query}): HTTP ${res.status}`);
    const data = (await res.json()) as { contacts?: Array<{ id?: string; email?: string }> };
    const rows = data.contacts ?? [];
    for (const r of rows) {
      if (r.id && r.email) out.push({ id: String(r.id), email: r.email.toLowerCase() });
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

/** Order source candidates: priority segments first (in order), then the rest. */
function planAdditions(
  source: Contact[],
  excludeEmails: Set<string>,
  prioritySets: Array<{ segmentId: string; emails: Set<string> }>,
  addCount: number,
): { picks: Array<Contact & { bucket: string }>; perBucket: Record<string, number> } {
  const seen = new Set<string>(excludeEmails);
  const picks: Array<Contact & { bucket: string }> = [];
  const perBucket: Record<string, number> = {};
  const take = (c: Contact, bucket: string): void => {
    if (picks.length >= addCount || seen.has(c.email)) return;
    seen.add(c.email);
    picks.push({ ...c, bucket });
    perBucket[bucket] = (perBucket[bucket] ?? 0) + 1;
  };
  for (const p of prioritySets) {
    for (const c of source) if (p.emails.has(c.email)) take(c, `segment:${p.segmentId}`);
  }
  for (const c of source) take(c, "rest");
  return { picks, perBucket };
}

async function enroll(picks: Contact[], targetListId: string): Promise<{ ok: number; failed: Array<{ email: string; error: string }> }> {
  let ok = 0;
  const failed: Array<{ email: string; error: string }> = [];
  for (const c of picks) {
    try {
      await addContactToList(c.id, targetListId);
      ok += 1;
    } catch (err) {
      failed.push({ email: c.email, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  return { ok, failed };
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: {
    sourceListId?: string | number;
    targetListId?: string | number;
    addCount?: number;
    prioritySegmentIds?: Array<string | number>;
    dryRun?: boolean;
  };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const sourceListId = String(body.sourceListId ?? "").trim();
  const targetListId = String(body.targetListId ?? "").trim();
  const addCount = Math.max(1, Math.min(1500, Math.floor(body.addCount ?? 0)));
  const prioritySegmentIds = (body.prioritySegmentIds ?? []).map(String).filter(Boolean);
  const dryRun = body.dryRun === true;
  if (!sourceListId || !targetListId) return NextResponse.json({ error: "sourceListId + targetListId required" }, { status: 400 });
  if (sourceListId === targetListId) return NextResponse.json({ error: "source and target must differ" }, { status: 400 });
  if (!body.addCount) return NextResponse.json({ error: "addCount required" }, { status: 400 });

  try {
    const [source, target, prioritySets] = await Promise.all([
      pageContacts(`listid=${encodeURIComponent(sourceListId)}&status=1`),
      pageContacts(`listid=${encodeURIComponent(targetListId)}`),
      Promise.all(prioritySegmentIds.map(async (segmentId) => ({
        segmentId,
        emails: new Set((await pageContacts(`segmentid=${encodeURIComponent(segmentId)}`)).map((c) => c.email)),
      }))),
    ]);
    const excludeEmails = new Set(target.map((c) => c.email));
    const { picks, perBucket } = planAdditions(source, excludeEmails, prioritySets, addCount);

    const summary = {
      sourceListId, targetListId, dryRun,
      sourceActive: source.length,
      targetAlreadyOn: target.length,
      requested: addCount,
      planned: picks.length,
      perBucket,
      samplePicks: picks.slice(0, 5).map((p) => ({ email: p.email, bucket: p.bucket })),
    };
    if (dryRun) return NextResponse.json({ ...summary, enrolled: 0, failed: [] });

    const result = await enroll(picks, targetListId);
    logger.info("ac_grow_list_from_list.success", { sourceListId, targetListId, enrolled: result.ok, failed: result.failed.length, perBucket });
    return NextResponse.json({ ...summary, enrolled: result.ok, failedCount: result.failed.length, failed: result.failed.slice(0, 20) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("ac_grow_list_from_list.failed", { sourceListId, targetListId, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
