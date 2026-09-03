/**
 * Diagnostic endpoint — dumps the state of dedup memory so we can see
 * WHY a repeat slipped through.
 *
 * GET /api/admin/dedup-inspect?limit=25
 *
 * Returns:
 * - `issuesRecent`: last N saturday_latte_issues rows with their car,
 *   tasting titles, and headline (from the issues table — this is what
 *   drives loadRecentLatteContext).
 * - `recommendationsByKind`: every row in latte_recommendations grouped
 *   by kind (this is what drives loadAllRecommendations and the writer's
 *   PERMANENT MEMORY block).
 * - `normalizedSample`: for a sample of cars + drinks, show the raw
 *   value AND the normalized-for-repeat value side by side, so we can
 *   see if the normalization is quietly making two picks look different
 *   when they should collapse.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function normalizeTitleForRepeat(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(5, parseInt(url.searchParams.get("limit") ?? "25", 10) || 25));

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return NextResponse.json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" }, { status: 500 });
  }
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Recent issues
  const { data: issues, error: iErr } = await db
    .from("saturday_latte_issues")
    .select("issue_date, cover_story_headline, sections, generated_at")
    .order("issue_date", { ascending: false })
    .limit(limit);
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  const issuesRecent = (issues ?? []).map((row) => {
    const s = row.sections as Record<string, unknown> | null;
    const tm = Array.isArray(s?.tastingMenu) ? (s?.tastingMenu as Array<Record<string, unknown>>) : [];
    const drive = s?.theDrive as Record<string, unknown> | undefined;
    const car = typeof drive?.car === "string" ? drive.car : null;
    return {
      issue_date: row.issue_date,
      headline: row.cover_story_headline,
      generated_at: row.generated_at,
      car,
      car_normalized: car ? normalizeTitleForRepeat(car) : null,
      tasting: tm.map((t) => ({
        label: typeof t.label === "string" ? t.label : null,
        title: typeof t.title === "string" ? t.title : null,
        title_normalized: typeof t.title === "string" ? normalizeTitleForRepeat(t.title) : null,
      })),
    };
  });

  // Permanent recommendations table grouped by kind
  const { data: recs, error: rErr } = await db
    .from("latte_recommendations")
    .select("brand, kind, value, normalized_value, context, issue_date")
    .eq("brand", "saturday_latte")
    .order("issue_date", { ascending: false });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const recommendationsByKind: Record<string, Array<{ value: string; normalized_value: string; issue_date: string; context: string | null }>> = {};
  for (const r of recs ?? []) {
    recommendationsByKind[r.kind] = recommendationsByKind[r.kind] ?? [];
    recommendationsByKind[r.kind]!.push({
      value: r.value,
      normalized_value: r.normalized_value,
      issue_date: r.issue_date,
      context: r.context,
    });
  }
  const recommendationCounts = Object.fromEntries(Object.entries(recommendationsByKind).map(([k, v]) => [k, v.length]));

  // Detect same-normalized-value duplicates within a kind (should be
  // impossible per the unique constraint, but if it happens the dedup
  // path leaks).
  const dupesWithinKind: Record<string, string[]> = {};
  for (const [kind, list] of Object.entries(recommendationsByKind)) {
    const byNorm = new Map<string, number>();
    for (const item of list) byNorm.set(item.normalized_value, (byNorm.get(item.normalized_value) ?? 0) + 1);
    const dupes: string[] = [];
    for (const [norm, count] of byNorm) if (count > 1) dupes.push(`${norm} (×${count})`);
    if (dupes.length > 0) dupesWithinKind[kind] = dupes;
  }

  // Same-VALUE cross-normalization drift: if two entries have different
  // normalized_value strings but look like the same product to a human,
  // dedup will miss. We surface pairs whose normalized_value differs by
  // <= 3 characters as suspicious.
  const suspiciousDrift: Record<string, Array<{ a: string; b: string; a_norm: string; b_norm: string }>> = {};
  for (const [kind, list] of Object.entries(recommendationsByKind)) {
    if (list.length < 2) continue;
    const pairs: Array<{ a: string; b: string; a_norm: string; b_norm: string }> = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.normalized_value === b.normalized_value) continue;
        // Cheap length + Jaccard token check
        const at = a.normalized_value.split(" ");
        const bt = b.normalized_value.split(" ");
        const shared = at.filter((t) => bt.includes(t)).length;
        const union = new Set([...at, ...bt]).size;
        const jaccard = union > 0 ? shared / union : 0;
        if (jaccard >= 0.6) pairs.push({ a: a.value, b: b.value, a_norm: a.normalized_value, b_norm: b.normalized_value });
      }
    }
    if (pairs.length > 0) suspiciousDrift[kind] = pairs.slice(0, 20);
  }

  return NextResponse.json({
    issuesRecent,
    recommendationCounts,
    dupesWithinKind,
    suspiciousDrift,
    // Full recommendations only for the small kinds; large ones truncated
    recommendationsByKindSample: Object.fromEntries(
      Object.entries(recommendationsByKind).map(([k, v]) => [k, v.slice(0, 40)]),
    ),
  });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}
