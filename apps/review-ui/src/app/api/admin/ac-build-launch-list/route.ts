/**
 * POST /api/admin/ac-build-launch-list
 *   { segmentIds: [1,2,3], targetCount: 200, listName: "First 200 launch" }
 *
 * Reads contacts from each segment, samples proportionally (rounded up
 * for the last segment so the total hits targetCount), creates a new
 * AC list, and enrolls each sampled contact. Returns the new listId
 * and a per-segment sample manifest so we can audit exactly who's
 * on it.
 *
 * Safe to call multiple times only with a different listName —
 * AC will accept a duplicate list name but the "stringid" auto-
 * generated slug should be unique.
 */

import { NextResponse } from "next/server";
import { addContactToList, createList, listContactsInSegment, type ACContact } from "../../../../lib/activecampaign";

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

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    segmentIds?: Array<string | number>;
    targetCount?: number;
    listName?: string;
    senderAddress?: string;
    senderCity?: string;
    senderZip?: string;
    senderCountry?: string;
    senderUrl?: string;
    senderRemindMe?: string;
  };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const segmentIds = (body.segmentIds ?? []).map(String).filter(Boolean);
  const targetCount = Math.max(1, Math.min(2000, body.targetCount ?? 200));
  const listName = (body.listName ?? "First 200 launch").trim();
  if (segmentIds.length === 0) return NextResponse.json({ error: "segmentIds required" }, { status: 400 });

  const senderAddress1 = body.senderAddress ?? "1 Sender St";
  const senderCity = body.senderCity ?? "Sender City";
  const senderZip = body.senderZip ?? "00000";
  const senderCountry = body.senderCountry ?? "United States";
  const senderUrl = body.senderUrl ?? "https://castorabbott.com";
  const senderRemindMe = body.senderRemindMe ?? "You subscribed to the Castor Abbott newsletter.";

  try {
    // 1. Pull contacts from each segment.
    const perSegment = await Promise.all(segmentIds.map(async (segId) => {
      const contacts = await listContactsInSegment(segId, 500);
      return { segmentId: segId, contacts };
    }));

    const totals = perSegment.map((s) => ({ segmentId: s.segmentId, size: s.contacts.length }));

    // 2. Compute a per-segment slice count: proportional to segment size
    //    unless a segment is smaller than its share, in which case the
    //    remainder redistributes to others. Deduplicate across segments
    //    (a contact in multiple segments only counts once).
    const seenEmails = new Set<string>();
    const sampled: Array<ACContact & { segmentId: string }> = [];

    const totalAvailable = perSegment.reduce((s, x) => s + x.contacts.length, 0);
    if (totalAvailable === 0) {
      return NextResponse.json({ error: "no contacts across the given segments" }, { status: 400 });
    }
    // Fair-share allocation (largest-remainder). Skips duplicates.
    const shares = perSegment.map((s) => {
      const raw = (s.contacts.length / totalAvailable) * targetCount;
      return { segmentId: s.segmentId, contacts: s.contacts, share: Math.floor(raw), remainder: raw - Math.floor(raw) };
    });
    let assigned = shares.reduce((sum, s) => sum + s.share, 0);
    // Give leftover to segments with the largest remainders.
    const remaining = targetCount - assigned;
    if (remaining > 0) {
      const ranked = [...shares].sort((a, b) => b.remainder - a.remainder);
      for (let i = 0; i < remaining && i < ranked.length; i++) ranked[i]!.share += 1;
      assigned = shares.reduce((sum, s) => sum + s.share, 0);
    }

    for (const s of shares) {
      let takenFromThis = 0;
      for (const c of s.contacts) {
        if (takenFromThis >= s.share) break;
        if (!c.email || seenEmails.has(c.email.toLowerCase())) continue;
        seenEmails.add(c.email.toLowerCase());
        sampled.push({ ...c, segmentId: s.segmentId });
        takenFromThis += 1;
      }
    }

    // If dedup left us short, backfill from any segment.
    if (sampled.length < targetCount) {
      for (const s of perSegment) {
        for (const c of s.contacts) {
          if (sampled.length >= targetCount) break;
          if (!c.email || seenEmails.has(c.email.toLowerCase())) continue;
          seenEmails.add(c.email.toLowerCase());
          sampled.push({ ...c, segmentId: s.segmentId });
        }
        if (sampled.length >= targetCount) break;
      }
    }

    // 3. Create the new list.
    const newList = await createList({
      name: listName,
      senderUrl,
      senderRemindMe,
      senderAddress1,
      senderCity,
      senderZip,
      senderCountry,
    });

    // 4. Enroll each sampled contact into the new list. Sequential to
    //    keep AC's rate limits happy on a first-time integration.
    const enrolled: Array<{ email: string; ok: boolean; error?: string }> = [];
    for (const c of sampled) {
      try {
        await addContactToList(c.id, newList.id);
        enrolled.push({ email: c.email, ok: true });
      } catch (err) {
        enrolled.push({ email: c.email, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({
      newList,
      totals,
      sampled: sampled.map((s) => ({ email: s.email, segmentId: s.segmentId })),
      enrolledCount: enrolled.filter((e) => e.ok).length,
      failedCount: enrolled.filter((e) => !e.ok).length,
      failures: enrolled.filter((e) => !e.ok).slice(0, 20),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
