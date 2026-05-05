/**
 * One-time concept migration: a CSV export of the existing Google Sheet
 * → Supabase content_concepts.
 *
 * Per spec 12_migration_plan § Migration from Google Sheets:
 *
 *   1. Export the "Featured" sheet to CSV (via Google Sheets → File → Download → CSV)
 *   2. Run this script with --csv pointing at that file
 *   3. Each row produces one content_concepts row with appropriate
 *      lookback_until and hard_blocked flags
 *
 * Expected CSV columns (case-insensitive):
 *   - date           (ISO date or M/D/YYYY)
 *   - section        (cover_story | tasting_menu_item | tactic | the_drive | ...)
 *   - type           (optional content type subcategory)
 *   - item_name      (surface form — destination, recommended item, headline)
 *   - concept        (the semantic summary — what this row "is about")
 *   - hard_blocked   (optional, "true" / "yes" / "1" — permanent exclusion)
 *
 * Lookback windows are configured per section; defaults match the existing
 * MindStudio system. Override via --lookback section=days,section=days.
 *
 * Usage:
 *   pnpm tsx apps/pipeline/src/scripts/migrate-concepts-from-sheet.ts \
 *     --brand castor_abbott \
 *     --csv ./featured-export.csv \
 *     --dry-run
 */
import { readFile } from "node:fs/promises";
import { logger } from "@platform/observability";
import { parseCsv } from "./migrate-subscribers.js";

type Args = {
  brandId: string;
  csvPath: string;
  lookbackOverrides: Record<string, number>;
  dryRun: boolean;
};

type ConceptRow = {
  brand_id: string;
  section_name: string;
  surface_form: string | null;
  concept_summary: string;
  used_at: string;
  lookback_until: string | null;
  hard_blocked: boolean;
};

const DEFAULT_LOOKBACK_DAYS: Record<string, number> = {
  cover_story: 270,
  tasting_menu_item: 90,
  tactic: 30,
  take: 30,
  story: 60,
  the_drive: 180,
  hosts_corner: 60,
  default: 30,
};

function parseDateLoose(s: string): string {
  const t = s.trim();
  if (!t) return new Date().toISOString();
  const iso = Date.parse(t);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString();
  // M/D/YYYY fallback
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) {
    const month = Number.parseInt(m[1] ?? "0", 10);
    const day = Number.parseInt(m[2] ?? "0", 10);
    let year = Number.parseInt(m[3] ?? "0", 10);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.toISOString();
  }
  return new Date().toISOString();
}

function parseHardBlocked(s: string | undefined): boolean {
  if (!s) return false;
  const v = s.toLowerCase().trim();
  return v === "true" || v === "yes" || v === "1" || v === "y";
}

function parseLookbackOverrides(s: string | undefined): Record<string, number> {
  if (!s) return {};
  const out: Record<string, number> = {};
  for (const part of s.split(",")) {
    const [k, v] = part.split("=");
    if (k && v) {
      const days = Number.parseInt(v.trim(), 10);
      if (!Number.isNaN(days)) out[k.trim()] = days;
    }
  }
  return out;
}

function lookbackUntil(
  usedAt: string,
  sectionName: string,
  overrides: Record<string, number>,
  hardBlocked: boolean,
): string | null {
  if (hardBlocked) return null;
  const days =
    overrides[sectionName] ??
    DEFAULT_LOOKBACK_DAYS[sectionName] ??
    DEFAULT_LOOKBACK_DAYS.default ??
    30;
  const t = new Date(usedAt);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString();
}

function parseArgs(argv: string[]): Args {
  let brandId: string | undefined;
  let csvPath: string | undefined;
  let dryRun = false;
  let lookback: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--brand") brandId = argv[++i];
    else if (a === "--csv") csvPath = argv[++i];
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--lookback") lookback = argv[++i];
  }
  if (!brandId || !csvPath) {
    throw new Error("usage: --brand <id> --csv <path> [--dry-run] [--lookback section=days,...]");
  }
  return { brandId, csvPath, lookbackOverrides: parseLookbackOverrides(lookback), dryRun };
}

export function rowToConcept(
  row: Record<string, string>,
  brandId: string,
  overrides: Record<string, number>,
): ConceptRow | null {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) lower[k.toLowerCase()] = v;

  const conceptSummary = (lower.concept ?? lower.summary ?? "").trim();
  const sectionName = (lower.section ?? "default").trim();
  if (!conceptSummary || !sectionName) return null;

  const usedAt = parseDateLoose(lower.date ?? "");
  const hardBlocked = parseHardBlocked(lower.hard_blocked);

  return {
    brand_id: brandId,
    section_name: sectionName,
    surface_form: lower.item_name?.trim() || null,
    concept_summary: conceptSummary,
    used_at: usedAt,
    lookback_until: lookbackUntil(usedAt, sectionName, overrides, hardBlocked),
    hard_blocked: hardBlocked,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const text = await readFile(args.csvPath, "utf8");
  const rows = parseCsv(text);

  const concepts: ConceptRow[] = rows
    .map((r) => rowToConcept(r, args.brandId, args.lookbackOverrides))
    .filter((c): c is ConceptRow => c !== null);

  const bySection: Record<string, number> = {};
  let hardBlockedCount = 0;
  for (const c of concepts) {
    bySection[c.section_name] = (bySection[c.section_name] ?? 0) + 1;
    if (c.hard_blocked) hardBlockedCount++;
  }

  logger.info("concept_migration.parsed", {
    brand_id: args.brandId,
    csv_path: args.csvPath,
    total_rows: rows.length,
    valid_concepts: concepts.length,
    skipped: rows.length - concepts.length,
    hard_blocked: hardBlockedCount,
    by_section: bySection,
    dry_run: args.dryRun,
  });

  if (args.dryRun) {
    console.log(
      JSON.stringify({ bySection, hardBlockedCount, sample: concepts.slice(0, 3) }, null, 2),
    );
    return;
  }

  // TODO(stage-2):
  //   1. For each row, embed concept_summary via OpenAI text-embedding-3-large
  //   2. Bulk insert into content_concepts via Supabase service role client
  //   3. Write an audit_log entry summarizing the import
  logger.warn("concept_migration.write_disabled", {
    reason: "stage-2 — supabase wiring not yet enabled. run with --dry-run for now.",
  });
}

// Internal helpers exposed for unit tests.
export { parseDateLoose, parseHardBlocked, parseLookbackOverrides };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    logger.error("concept_migration.fatal", {
      error_message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
