/**
 * POST /api/admin/ac-backfill-cohort-tags
 *   {
 *     listId: "43",                           // which list to backfill
 *     cutoffISO: "2026-10-01T00:00:00Z",      // contacts added before = launch cohort
 *     launchTag: "cohort-launch",             // tag for pre-cutoff contacts
 *     importTag: "cohort-oct-import",         // tag for post-cutoff contacts
 *     dryRun?: false                          // true = report what would happen without writing
 *   }
 *
 * For Mark's 10-19 ask: "Can we tag the original ~200 and the October
 * group separately so we can report on each one?"
 *
 * Iterates list contacts (bounded page walk), splits by contact.cdate
 * vs cutoffISO, creates both tags if missing, and attaches the correct
 * tag to each contact. Idempotent — a second run is a no-op for
 * contacts already tagged.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  return authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
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

async function acPost<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T | null }> {
  const token = process.env.AC_API_TOKEN ?? "";
  const base = (process.env.AC_API_URL ?? "").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/3${path}`, {
      method: "POST",
      headers: { "Api-Token": token, "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = res.ok ? ((await res.json()) as T) : null;
    return { ok: res.ok, status: res.status, data };
  } catch { return { ok: false, status: 0, data: null }; }
}

async function findOrCreateTag(name: string): Promise<string | null> {
  const list = await acGet<{ tags?: Array<{ id: string; tag: string }> }>(`/tags?search=${encodeURIComponent(name)}&limit=25`);
  const match = (list?.tags ?? []).find((t) => t.tag === name);
  if (match) return match.id;
  const create = await acPost<{ tag?: { id: string } }>(`/tags`, {
    tag: { tag: name, tagType: "contact", description: `Cohort tag backfilled ${new Date().toISOString().slice(0, 10)}` },
  });
  return create.data?.tag?.id ?? null;
}

async function listContactIdsOnList(listId: string, hardCap = 5000): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 100;
  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const r = await acGet<{ contactLists?: Array<{ contact?: string }> }>(
      `/contactLists?filters[listid]=${encodeURIComponent(listId)}&filters[status]=1&limit=${pageSize}&offset=${offset}`,
    );
    const rows = r?.contactLists ?? [];
    if (rows.length === 0) break;
    for (const row of rows) if (row.contact) ids.push(String(row.contact));
    if (rows.length < pageSize) break;
  }
  return ids;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: {
    listId?: string;
    cutoffISO?: string;
    launchTag?: string;
    importTag?: string;
    dryRun?: boolean;
  };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const listId = String(body.listId ?? "43");
  const cutoffISO = body.cutoffISO ?? "2026-10-01T00:00:00Z";
  const launchTag = (body.launchTag ?? "cohort-launch").trim();
  const importTag = (body.importTag ?? "cohort-oct-import").trim();
  const dryRun = body.dryRun === true;
  const cutoffMs = Date.parse(cutoffISO);
  if (!Number.isFinite(cutoffMs)) return NextResponse.json({ error: "invalid cutoffISO" }, { status: 400 });

  // 1. Ensure both tags exist (skip in dry-run).
  let launchTagId: string | null = null;
  let importTagId: string | null = null;
  if (!dryRun) {
    launchTagId = await findOrCreateTag(launchTag);
    importTagId = await findOrCreateTag(importTag);
    if (!launchTagId || !importTagId) {
      return NextResponse.json({ error: "failed to find/create tags", launchTagId, importTagId }, { status: 500 });
    }
  }

  // 2. List all active contacts on the target list.
  const contactIds = await listContactIdsOnList(listId);
  logger.info("backfill_cohort.contacts_loaded", { listId, count: contactIds.length });

  // 3. Walk each contact, read cdate, bucket into cohort, tag.
  let launchCount = 0;
  let importCount = 0;
  let unknownDateCount = 0;
  let taggedCount = 0;
  let errorCount = 0;
  for (const cid of contactIds) {
    const c = await acGet<{ contact?: { cdate?: string; email?: string } }>(`/contacts/${encodeURIComponent(cid)}`);
    const cdate = c?.contact?.cdate;
    if (!cdate) { unknownDateCount++; continue; }
    const createdMs = Date.parse(cdate);
    if (!Number.isFinite(createdMs)) { unknownDateCount++; continue; }
    const whichTag = createdMs < cutoffMs ? "launch" : "import";
    if (whichTag === "launch") launchCount++; else importCount++;
    if (dryRun) continue;
    const tagId = whichTag === "launch" ? launchTagId! : importTagId!;
    const res = await acPost(`/contactTags`, { contactTag: { contact: cid, tag: tagId } });
    // Idempotent 422 (already tagged) counts as success.
    if (res.ok || res.status === 422) taggedCount++;
    else errorCount++;
  }

  logger.info("backfill_cohort.done", {
    listId, cutoffISO, launchCount, importCount, unknownDateCount, taggedCount, errorCount, dryRun,
  });
  return NextResponse.json({
    ok: true,
    dryRun,
    listId,
    cutoffISO,
    totals: {
      scanned: contactIds.length,
      launchCohort: launchCount,
      octImportCohort: importCount,
      unknownCdate: unknownDateCount,
      taggedInThisRun: taggedCount,
      errors: errorCount,
    },
    tags: { launch: { name: launchTag, id: launchTagId }, import: { name: importTag, id: importTagId } },
  });
}
