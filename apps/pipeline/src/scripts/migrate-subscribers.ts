/**
 * One-time subscriber migration: ActiveCampaign CSV export → Supabase subscribers.
 *
 * Usage:
 *   pnpm tsx apps/pipeline/src/scripts/migrate-subscribers.ts \
 *     --brand castor_abbott \
 *     --csv ./subscribers.csv \
 *     --dry-run
 *
 * The CSV is expected to have at minimum: email, status. Optional: name,
 * subscribed_at, source, plus any custom fields that get folded into
 * custom_fields jsonb.
 *
 * Status mapping (ActiveCampaign → our subscribers.status):
 *   "active"        → "active"
 *   "unsubscribed"  → "unsubscribed"
 *   "bounced"       → "bounced"
 *   "complained"    → "complained"
 *   anything else   → "suppressed"
 *
 * The script also emits a summary count and writes an audit_log row.
 */
import { readFile } from "node:fs/promises";
import { logger } from "@platform/observability";

type Args = {
  brandId: string;
  csvPath: string;
  dryRun: boolean;
};

type CsvRow = Record<string, string>;

type SubscriberRow = {
  brand_id: string;
  email: string;
  name: string | null;
  status: "active" | "unsubscribed" | "bounced" | "complained" | "suppressed";
  source: string | null;
  subscribed_at: string;
  custom_fields: Record<string, string>;
};

const KNOWN_STATUSES = new Set(["active", "unsubscribed", "bounced", "complained", "suppressed"]);

function parseArgs(argv: string[]): Args {
  let brandId: string | undefined;
  let csvPath: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--brand") brandId = argv[++i];
    else if (a === "--csv") csvPath = argv[++i];
    else if (a === "--dry-run") dryRun = true;
  }
  if (!brandId || !csvPath) {
    throw new Error("usage: --brand <id> --csv <path> [--dry-run]");
  }
  return { brandId, csvPath, dryRun };
}

/**
 * Tiny CSV parser. Handles quoted fields with embedded commas and escaped
 * quotes ("") but does NOT handle every RFC 4180 edge case. ActiveCampaign
 * exports are clean enough that this works.
 */
export function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: CsvRow = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i] ?? "";
      row[key] = cells[i] ?? "";
    }
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normalizeStatus(raw: string): SubscriberRow["status"] {
  const v = raw.toLowerCase().trim();
  if (KNOWN_STATUSES.has(v)) return v as SubscriberRow["status"];
  return "suppressed";
}

export function rowToSubscriber(row: CsvRow, brandId: string): SubscriberRow | null {
  const email = row.email?.toLowerCase().trim();
  if (!email || !email.includes("@")) return null;

  const status = normalizeStatus(row.status ?? "active");
  const subscribedAt = row.subscribed_at || row.created_at || new Date().toISOString();

  const known = new Set(["email", "name", "status", "source", "subscribed_at", "created_at"]);
  const customFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!known.has(k) && v) customFields[k] = v;
  }

  return {
    brand_id: brandId,
    email,
    name: row.name || null,
    status,
    source: row.source || "import",
    subscribed_at: subscribedAt,
    custom_fields: customFields,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const text = await readFile(args.csvPath, "utf8");
  const rows = parseCsv(text);

  const subscribers = rows
    .map((r) => rowToSubscriber(r, args.brandId))
    .filter((s): s is SubscriberRow => s !== null);

  const counts: Record<string, number> = {};
  for (const s of subscribers) {
    counts[s.status] = (counts[s.status] ?? 0) + 1;
  }

  logger.info("subscriber_migration.parsed", {
    brand_id: args.brandId,
    csv_path: args.csvPath,
    total_rows: rows.length,
    valid_subscribers: subscribers.length,
    skipped: rows.length - subscribers.length,
    by_status: counts,
    dry_run: args.dryRun,
  });

  if (args.dryRun) {
    console.log(JSON.stringify({ counts, sample: subscribers.slice(0, 3) }, null, 2));
    return;
  }

  // TODO(stage-2): batch insert into subscribers via Supabase service role
  //   client.from("subscribers").upsert(subscribers, { onConflict: "brand_id,email" })
  // Then write an audit_log row recording the migration.
  logger.warn("subscriber_migration.write_disabled", {
    reason: "stage-2 — supabase wiring not yet enabled. run with --dry-run for now.",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    logger.error("subscriber_migration.fatal", {
      error_message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
