/**
 * In-row overwrite protection for issue tables.
 *
 * saturday_latte_issues + daily_grind_issues use issue_date as the
 * unique key. Every regen / rewrite / regenerate-slot upserts the
 * row and replaces html/text/subject/sections in place. Prior to this
 * helper any prior content for that issue_date was permanently lost.
 *
 * We *also* have newsletter_issue_versions (see migration 0014) as
 * a proper append-only table — but the migration hasn't landed in prod
 * yet, and every save path needs to work even without it. So we do
 * BOTH:
 *   1. Snapshot the old row's payload into generation_meta.previousVersions
 *      (JSONB, no migration needed — works today)
 *   2. Also try newsletter_issue_versions insert as before (best-effort;
 *      no-op if the table is missing)
 *
 * Callers use it like:
 *   const nextMeta = await mergePreviousVersion(db, table, issueDate, computedMeta);
 *   await db.from(table).upsert({ ... generation_meta: nextMeta ... });
 *
 * The previous-versions array is capped at 20 entries to keep row size
 * bounded — realistic worst case is ~500KB per row at that cap.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type IssueTable = "saturday_latte_issues" | "daily_grind_issues";

const MAX_KEPT_VERSIONS = 20;

type ArchivedVersion = {
  savedAt: string;
  subject: string | null;
  headline: string | null;
  preheader: string | null;
  html: string | null;
  textBody: string | null;
  sections: unknown;
  approvalStatus: string | null;
  generationMeta: unknown;
};

/**
 * Read the current row (if any) at issueDate, snapshot its content
 * into a `previousVersions[]` array, and merge that array into the
 * incoming generation_meta. The array is capped at MAX_KEPT_VERSIONS,
 * FIFO — oldest snapshots roll off first.
 *
 * Also chains: if the existing row already has generation_meta.previousVersions,
 * those are preserved (this new snapshot is appended after them).
 */
export async function mergePreviousVersion(
  db: SupabaseClient,
  table: IssueTable,
  issueDate: string,
  incomingGenerationMeta: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown>> {
  const headlineCol = table === "saturday_latte_issues" ? "cover_story_headline" : "headline";
  const selectCols = `subject, ${headlineCol}, preheader, html, text_body, sections, approval_status, generation_meta`;

  const { data: existing, error } = await db
    .from(table)
    .select(selectCols)
    .eq("issue_date", issueDate)
    .maybeSingle();

  // If the row doesn't exist yet or the select failed, there's nothing
  // to preserve — just return the incoming meta unchanged.
  if (error) return { ...(incomingGenerationMeta ?? {}) };
  if (!existing) return { ...(incomingGenerationMeta ?? {}) };

  const existingRow = existing as unknown as Record<string, unknown>;
  const existingMeta = (existingRow.generation_meta ?? {}) as Record<string, unknown>;
  // When the caller has fresh meta (cron regen), use it. When the caller
  // is only doing a partial edit (rewrite-passage / regenerate-slot /
  // rewrite-issue on same-date), seed from the existing meta so we don't
  // blow away tokens/pipeline/etc. Either way, previousVersions is set
  // below and takes precedence.
  const meta: Record<string, unknown> = incomingGenerationMeta
    ? { ...incomingGenerationMeta }
    : { ...existingMeta };
  const priorList = Array.isArray(existingMeta.previousVersions)
    ? (existingMeta.previousVersions as ArchivedVersion[])
    : [];

  // Skip snapshotting if the existing row has no html — it's effectively
  // empty and there's nothing worth preserving.
  const existingHtml = existingRow.html as string | null;
  if (!existingHtml) {
    if (priorList.length > 0) meta.previousVersions = priorList;
    return meta;
  }

  // Build the archive entry from the OLD row before we overwrite it.
  // Strip previousVersions out of the archived generation_meta so we
  // don't recursively store previous snapshots inside snapshots — that
  // would explode row size.
  const archivedMeta = { ...existingMeta };
  delete archivedMeta.previousVersions;

  const snapshot: ArchivedVersion = {
    savedAt: new Date().toISOString(),
    subject: (existingRow.subject as string | null) ?? null,
    headline: (existingRow[headlineCol] as string | null) ?? null,
    preheader: (existingRow.preheader as string | null) ?? null,
    html: existingHtml,
    textBody: (existingRow.text_body as string | null) ?? null,
    sections: existingRow.sections ?? null,
    approvalStatus: (existingRow.approval_status as string | null) ?? null,
    generationMeta: archivedMeta,
  };

  const nextList = [...priorList, snapshot].slice(-MAX_KEPT_VERSIONS);
  meta.previousVersions = nextList;
  return meta;
}
