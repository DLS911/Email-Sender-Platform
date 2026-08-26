/**
 * Latte recommendations extractor + recorder.
 *
 * After a generated issue is persisted, walk its content and write
 * every recommendation to latte_recommendations. Loader queries the
 * same table when the next issue is generating so the writer sees the
 * full history of what's already been recommended, kind by kind.
 *
 * Two extraction paths:
 *   1. STRUCTURED — walks the SaturdayLatteContent shape and pulls
 *      the section-level picks (cover story headline, tasting titles,
 *      cooking move, drive car, sunday reset author, sabbath reference).
 *      Always fires, always reliable.
 *   2. HAIKU BODY PASS — one Haiku 4.5 call over the prose bodies
 *      (cover story, tasting menu bodies, host's corner body) that
 *      extracts specific dishes, restaurants, brands, and people
 *      mentioned inline. This is where the "peach pie" and "the
 *      brisket plate" get captured.
 *
 * The Haiku pass is best-effort — if it fails the structured
 * extraction still records the section-level picks. No throws leak.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SaturdayLatteContent } from "./saturday-latte-html-template";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const BRAND_LATTE = "saturday_latte";

export type RecommendationKind =
  | "destination"
  | "restaurant"
  | "dish"
  | "hotel_or_lodging"
  | "shop"
  | "landmark"
  | "car"
  | "book"
  | "book_creator"
  | "film"
  | "film_creator"
  | "album"
  | "album_creator"
  | "podcast"
  | "podcast_creator"
  | "drink"
  | "drink_brand"
  | "product"
  | "product_brand"
  | "cooking_move"
  | "cooking_ingredient"
  | "cooking_tool"
  | "sunday_reset_author"
  | "sabbath_reference"
  | "person";

type RecommendationRow = {
  brand: string;
  kind: RecommendationKind;
  value: string;
  normalized_value: string;
  context: string | null;
  issue_date: string;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|of|and|for|in|on|at|with|by|to)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function labelKindForTasting(label: string): "book" | "film" | "album" | "podcast" | "drink" | "product" | "unknown" {
  const l = label.toLowerCase();
  if (l.includes("reading")) return "book";
  if (l.includes("watching")) return "film";
  if (l.includes("listening")) return "album";
  if (l.includes("drinking")) return "drink";
  if (l.includes("trying")) return "product";
  return "unknown";
}

function extractCreatorFromTitle(title: string): string | null {
  const trimmed = title.trim();
  const byIdx = trimmed.search(/\s+by\s+/i);
  if (byIdx === -1) return null;
  const tail = trimmed.slice(byIdx).replace(/^\s+by\s+/i, "").trim();
  const first = tail.split(/[.,;:(]|[-—]\s/)[0]?.trim();
  return first && first.length >= 3 ? first : null;
}

/** Rule-based structured extraction. Always runs, always reliable. */
export function extractStructuredRecommendations(
  content: SaturdayLatteContent,
  issueDate: string,
): RecommendationRow[] {
  const rows: RecommendationRow[] = [];
  const push = (kind: RecommendationKind, value: string, context: string | null): void => {
    const clean = value.trim();
    if (!clean) return;
    const norm = normalize(clean);
    if (!norm) return;
    rows.push({ brand: BRAND_LATTE, kind, value: clean, normalized_value: norm, context, issue_date: issueDate });
  };

  push("destination", content.coverStoryHeadline, "cover_story_headline");

  if (Array.isArray(content.coverStoryLinks)) {
    for (const link of content.coverStoryLinks) {
      if (link.text) push("restaurant", link.text, "cover_story_link");
    }
  }

  push("car", content.theDrive.car, "the_drive");

  push("cooking_move", content.hostsCorner.moveTitle, "hosts_corner");

  for (const [i, item] of content.tastingMenu.entries()) {
    const kind = labelKindForTasting(item.label ?? "");
    const slotCtx = `tasting_${i + 1}_${item.label ?? ""}`.toLowerCase();
    if (kind === "book") {
      push("book", item.title, slotCtx);
      const creator = extractCreatorFromTitle(item.title);
      if (creator) push("book_creator", creator, slotCtx);
    } else if (kind === "film") {
      push("film", item.title, slotCtx);
    } else if (kind === "album") {
      push("album", item.title, slotCtx);
      const creator = extractCreatorFromTitle(item.title);
      if (creator) push("album_creator", creator, slotCtx);
    } else if (kind === "podcast") {
      push("podcast", item.title, slotCtx);
    } else if (kind === "drink") {
      push("drink", item.title, slotCtx);
    } else if (kind === "product") {
      push("product", item.title, slotCtx);
    }
  }

  if (content.sundayReset.author) push("sunday_reset_author", content.sundayReset.author, "sunday_reset");
  if (content.sabbath.reference) push("sabbath_reference", content.sabbath.reference, "sabbath");

  return rows;
}

/**
 * Haiku pass that reads the cover story + host's corner + tasting bodies
 * and extracts inline mentions the structured extractor can't see:
 * specific dishes ("the peach pie"), specific tools ("a Baking Steel"),
 * specific people ("Kenji López-Alt"), and specific spots ("Grady's").
 *
 * Returns a list of typed rows or an empty list on failure. Never throws.
 */
export async function extractHaikuBodyRecommendations(
  content: SaturdayLatteContent,
  issueDate: string,
): Promise<RecommendationRow[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const client = new Anthropic({ apiKey });

  const coverBody = (content.coverStoryParagraphs ?? []).join("\n\n");
  const hcBody = content.hostsCorner.moveBody ?? "";
  const tastingBodies = content.tastingMenu.map((t) => `[${t.label}] ${t.title}\n${t.body}`).join("\n\n---\n\n");

  const prompt = `Extract every specific named entity that a reader could act on or recognize from the passages below. For each entity, choose ONE kind from this fixed list:
- restaurant, dish, hotel_or_lodging, shop, landmark
- book, book_creator, film, film_creator, album, album_creator, podcast, podcast_creator
- drink, drink_brand
- product, product_brand
- cooking_ingredient, cooking_tool
- person (a named person referenced who isn't a book/film/album author)

STRICT RULES:
- Only extract SPECIFIC names, not generic categories. "the peach pie at Grady's" → dish="peach pie", restaurant="Grady's". "some barbecue" → skip (generic).
- Do NOT extract the destination itself (the city/region — that's captured separately).
- Do NOT extract obvious commodity words ("water," "coffee" as concept). Extract branded specifics ("Blue Bottle," "Cortado at Bar Cotto").
- No duplicates in your output.

Return ONLY a JSON array of objects: [{"kind": "restaurant", "value": "Grady's"}, ...] — no preamble, no code fence.

=== COVER STORY BODY ===
${coverBody}

=== HOST'S CORNER BODY ===
${hcBody}

=== TASTING MENU BODIES ===
${tastingBodies}`;

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1500,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    });
    let text = "";
    for (const block of response.content) if (block.type === "text") text += block.text;
    const stripped = text.replace(/```json\s*|\s*```/g, "").trim();
    const start = stripped.indexOf("[");
    const end = stripped.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as Array<{ kind: string; value: string }>;
    const validKinds = new Set<string>([
      "restaurant", "dish", "hotel_or_lodging", "shop", "landmark",
      "book", "book_creator", "film", "film_creator", "album", "album_creator", "podcast", "podcast_creator",
      "drink", "drink_brand", "product", "product_brand",
      "cooking_ingredient", "cooking_tool", "person",
    ]);
    const rows: RecommendationRow[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const kind = String(item.kind ?? "").trim();
      const value = String(item.value ?? "").trim();
      if (!kind || !value || !validKinds.has(kind)) continue;
      const norm = normalize(value);
      if (!norm) continue;
      rows.push({
        brand: BRAND_LATTE,
        kind: kind as RecommendationKind,
        value,
        normalized_value: norm,
        context: "haiku_body_pass",
        issue_date: issueDate,
      });
    }
    return rows;
  } catch (err) {
    console.warn(
      "latte.haiku_body_extraction_failed",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/** Write extracted rows into latte_recommendations. Idempotent via unique index. */
export async function recordRecommendations(
  db: SupabaseClient,
  rows: RecommendationRow[],
): Promise<{ inserted: number; error: string | null }> {
  if (rows.length === 0) return { inserted: 0, error: null };
  const deduped = new Map<string, RecommendationRow>();
  for (const r of rows) {
    const key = `${r.brand}|${r.kind}|${r.normalized_value}`;
    if (!deduped.has(key)) deduped.set(key, r);
  }
  const arr = Array.from(deduped.values());
  const { error, count } = await db
    .from("latte_recommendations")
    .upsert(arr, { onConflict: "brand,kind,normalized_value", ignoreDuplicates: true, count: "exact" });
  if (error) return { inserted: 0, error: error.message };
  return { inserted: count ?? arr.length, error: null };
}

/** Load every recommendation ever made for the brand, grouped by kind. */
export async function loadAllRecommendations(
  db: SupabaseClient,
  brand: string = BRAND_LATTE,
): Promise<Record<string, string[]>> {
  const { data, error } = await db
    .from("latte_recommendations")
    .select("kind, value")
    .eq("brand", brand)
    .order("created_at", { ascending: false });
  if (error) return {};
  const grouped: Record<string, string[]> = {};
  for (const row of (data ?? []) as Array<{ kind: string; value: string }>) {
    if (!grouped[row.kind]) grouped[row.kind] = [];
    grouped[row.kind]!.push(row.value);
  }
  return grouped;
}
