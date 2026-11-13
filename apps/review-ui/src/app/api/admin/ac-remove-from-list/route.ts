/**
 * POST /api/admin/ac-remove-from-list
 *   { listId: 43, contactIds: ["123", "456"], reason: "...", dryRun?: true }
 *
 * Unsubscribes the given contacts from ONE list (AC contactList status=2).
 * Does not touch their membership on any other list and does not set a
 * global unsubscribe. Built 2026-11-13 to pull 146 contacts off list 43
 * who had been on the legacy list alone — Mark: "if they are a part of
 * several lists thats fine, just not that legacy list alone."
 *
 * Hard-capped at 500 contacts per call. reason is required and logged.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const url = new URL(req.url);
  const q = url.searchParams.get("test");
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${cronSecret}` || q === cronSecret;
}

async function unsubscribeFromList(contactId: string, listId: string): Promise<void> {
  const token = process.env.AC_API_TOKEN;
  const base = (process.env.AC_API_URL ?? "").replace(/\/$/, "") + "/api/3";
  if (!token || !base.includes("api-us")) throw new Error("AC env missing");
  const res = await fetch(`${base}/contactLists`, {
    method: "POST",
    headers: { "Api-Token": token, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ contactList: { contact: contactId, list: listId, status: 2 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { listId?: string | number; contactIds?: Array<string | number>; reason?: string; dryRun?: boolean };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const listId = String(body.listId ?? "").trim();
  const contactIds = Array.from(new Set((body.contactIds ?? []).map(String).filter(Boolean)));
  const reason = (body.reason ?? "").trim();
  const dryRun = body.dryRun === true;
  if (!listId) return NextResponse.json({ error: "listId required" }, { status: 400 });
  if (contactIds.length === 0) return NextResponse.json({ error: "contactIds required" }, { status: 400 });
  if (contactIds.length > 500) return NextResponse.json({ error: "max 500 contactIds per call" }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "reason required" }, { status: 400 });
  if (dryRun) return NextResponse.json({ listId, dryRun: true, wouldRemove: contactIds.length, removed: 0, failed: [] });

  let removed = 0;
  const failed: Array<{ contactId: string; error: string }> = [];
  for (const id of contactIds) {
    try {
      await unsubscribeFromList(id, listId);
      removed += 1;
    } catch (err) {
      failed.push({ contactId: id, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  logger.info("ac_remove_from_list.done", { listId, requested: contactIds.length, removed, failed: failed.length, reason });
  return NextResponse.json({ listId, requested: contactIds.length, removed, failedCount: failed.length, failed: failed.slice(0, 20) });
}
