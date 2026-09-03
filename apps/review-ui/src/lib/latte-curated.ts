/**
 * Curated items — Austin's manual pre-selections that the writer
 * MUST prefer over shelf/research picks.
 *
 * Backed by latte_curated_items in Supabase (see migration 0013).
 * Loader is called by the generator; writer prompt gets a
 * PRIORITY CURATED LIST block per kind that has active items.
 */

import { SupabaseClient } from "@supabase/supabase-js";

export type CuratedKind = "car" | "drink" | "book" | "product";
export const CURATED_KINDS: CuratedKind[] = ["car", "drink", "book", "product"];

export type CuratedItem = {
  id: string;
  kind: CuratedKind;
  title: string;
  normalized_title: string;
  notes: string | null;
  reference_url: string | null;
  status: "active" | "used" | "archived";
  used_in_issue_date: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeCuratedTitle(s: string): string {
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

export async function loadActiveCurated(db: SupabaseClient): Promise<Record<CuratedKind, CuratedItem[]>> {
  const empty: Record<CuratedKind, CuratedItem[]> = { car: [], drink: [], book: [], product: [] };
  const { data, error } = await db
    .from("latte_curated_items")
    .select("id, kind, title, normalized_title, notes, reference_url, status, used_in_issue_date, added_by, created_at, updated_at")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error || !data) return empty;
  const grouped = { ...empty };
  for (const row of data as CuratedItem[]) {
    if (CURATED_KINDS.includes(row.kind)) grouped[row.kind].push(row);
  }
  return grouped;
}

/**
 * Format the curated list as a writer-prompt block. Only kinds with
 * active items are included. Returns the empty string if nothing is
 * curated (writer falls back to normal picking).
 */
export function formatCuratedForWriter(
  grouped: Record<CuratedKind, CuratedItem[]>,
): string {
  const lines: string[] = [];
  const kindLabel: Record<CuratedKind, string> = {
    car: "Cars (The Drive)",
    drink: "Drinks (Worth Drinking)",
    book: "Books (Worth Reading)",
    product: "Products (Worth Trying)",
  };
  let anyActive = false;
  for (const kind of CURATED_KINDS) {
    const items = grouped[kind];
    if (items.length === 0) continue;
    anyActive = true;
    lines.push(`\n## ${kindLabel[kind]} — ${items.length} curated available`);
    for (const it of items) {
      const note = it.notes ? ` (${it.notes})` : "";
      lines.push(`- ${it.title}${note}`);
    }
  }
  if (!anyActive) return "";
  return `\n# ⭐ PRIORITY CURATED LIST — HARD RULE
Austin has pre-selected specific items for the writer to pick from. For any KIND below with items listed, this issue MUST pick from that curated list. Only if a kind has NO curated items are you free to pick from shelves / research as normal. The lists are ordered oldest-first; when in doubt, pick the oldest curated item that fits the issue's theme.
${lines.join("\n")}

If a curated item's spelling / brand / year differs slightly from what's in your research, USE THE CURATED TITLE VERBATIM — the curator's spelling is authoritative.`;
}

/**
 * Mark curated items as USED after an issue has been persisted. Matches
 * on kind + normalized_title. Ambiguous / cross-kind matches are
 * skipped. Safe to call even if no curated items were used — no-op.
 */
export async function markCuratedUsed(
  db: SupabaseClient,
  issueDate: string,
  usedTitles: Array<{ kind: CuratedKind; title: string }>,
): Promise<{ marked: number }> {
  if (usedTitles.length === 0) return { marked: 0 };
  let marked = 0;
  for (const u of usedTitles) {
    const norm = normalizeCuratedTitle(u.title);
    if (!norm) continue;
    const { data, error } = await db
      .from("latte_curated_items")
      .update({ status: "used", used_in_issue_date: issueDate, updated_at: new Date().toISOString() })
      .eq("kind", u.kind)
      .eq("normalized_title", norm)
      .eq("status", "active")
      .select("id");
    if (!error && Array.isArray(data)) marked += data.length;
  }
  return { marked };
}
