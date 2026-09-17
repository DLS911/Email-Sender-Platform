/**
 * newsletter_issue_versions — append-only history/recovery table.
 *
 * Every code path that writes html/text/subject/sections back to
 * saturday_latte_issues or daily_grind_issues MUST also call
 * persistIssueVersion after the primary write succeeds. That way a
 * later regen / rewrite never destroys prior content.
 *
 * version_seq is assigned by looking up the current max for
 * (brand, issue_date) and incrementing. There's a race if two writers
 * fire in the same second — the unique index on (brand, issue_date,
 * version_seq) will reject the second insert; caller can retry once.
 * In practice the review UI serialises human edits and the cron only
 * ever writes one issue at a time.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type IssueVersionBrand = "latte" | "daily-grind";
export type IssueVersionSource =
  | "generate"
  | "regenerate_slot"
  | "rewrite_passage"
  | "rewrite_issue";

export type IssueVersionInput = {
  brand: IssueVersionBrand;
  issueDate: string;
  subject: string | null;
  headline: string | null;
  preheader: string | null;
  html: string;
  textBody: string | null;
  sections: unknown;
  generationMeta: unknown;
  source: IssueVersionSource;
  sourceNote?: string | null;
};

export type PersistedIssueVersion = { id: string; versionSeq: number };

/**
 * Insert a new version row. Returns the new row's id + assigned
 * version_seq. On unique-index conflict (two writers same second),
 * retries once with the next seq.
 */
export async function persistIssueVersion(
  db: SupabaseClient,
  input: IssueVersionInput,
): Promise<PersistedIssueVersion> {
  const attempt = async (seq: number): Promise<PersistedIssueVersion> => {
    const { data, error } = await db
      .from("newsletter_issue_versions")
      .insert({
        brand: input.brand,
        issue_date: input.issueDate,
        version_seq: seq,
        subject: input.subject,
        headline: input.headline,
        preheader: input.preheader,
        html: input.html,
        text_body: input.textBody,
        sections: input.sections ?? null,
        generation_meta: input.generationMeta ?? null,
        source: input.source,
        source_note: input.sourceNote ?? null,
      })
      .select("id, version_seq")
      .single();
    if (error) throw new Error(`persist_issue_version: ${error.message}`);
    return { id: String(data.id), versionSeq: Number(data.version_seq) };
  };

  const { data: existing, error: readErr } = await db
    .from("newsletter_issue_versions")
    .select("version_seq")
    .eq("brand", input.brand)
    .eq("issue_date", input.issueDate)
    .order("version_seq", { ascending: false })
    .limit(1);
  if (readErr) throw new Error(`persist_issue_version.max_lookup: ${readErr.message}`);
  const nextSeq = ((existing?.[0]?.version_seq as number | undefined) ?? 0) + 1;

  try {
    return await attempt(nextSeq);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Unique index conflict on (brand, issue_date, version_seq) → retry
    // once with the next seq. Anything else re-throws.
    if (!msg.includes("duplicate key value") && !msg.includes("23505")) throw err;
    return attempt(nextSeq + 1);
  }
}

/**
 * After a successful preview email send, attach the resend_id to the
 * matching version row. Best-effort — failures are logged by caller.
 */
export async function attachPreviewResendId(
  db: SupabaseClient,
  versionId: string,
  resendId: string,
): Promise<void> {
  const { error } = await db
    .from("newsletter_issue_versions")
    .update({ preview_resend_id: resendId })
    .eq("id", versionId);
  if (error) throw new Error(`attach_preview_resend_id: ${error.message}`);
}

/**
 * After a successful AC push, tag the version with the AC campaign +
 * message ids. Called from push-to-activecampaign.
 */
export async function attachAcIds(
  db: SupabaseClient,
  brand: IssueVersionBrand,
  issueDate: string,
  acCampaignId: string,
  acMessageId: string,
): Promise<void> {
  const { data: latest, error: readErr } = await db
    .from("newsletter_issue_versions")
    .select("id")
    .eq("brand", brand)
    .eq("issue_date", issueDate)
    .order("version_seq", { ascending: false })
    .limit(1);
  if (readErr) throw new Error(`attach_ac_ids.lookup: ${readErr.message}`);
  const row = latest?.[0];
  if (!row) return;
  const { error } = await db
    .from("newsletter_issue_versions")
    .update({ ac_campaign_id: acCampaignId, ac_message_id: acMessageId })
    .eq("id", String(row.id));
  if (error) throw new Error(`attach_ac_ids: ${error.message}`);
}
