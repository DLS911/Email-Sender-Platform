/**
 * POST /api/admin/push-to-activecampaign
 *   {
 *     brand: "latte" | "daily-grind",
 *     issueDate: "YYYY-MM-DD",
 *     listId?: <override, default env AC_LIST_ID>,
 *     sendAtISO?: "2026-09-15T20:00:00Z",   // omit for draft (Latte)
 *     asDraft?: true                          // force draft even with sendAt
 *   }
 *
 * Loads the persisted HTML/text/subject for the issue and pushes it
 * to AC as: 1) a Message, 2) a Campaign associated with the list.
 * Returns campaignId + AC dashboard URL. Idempotency: not enforced —
 * calling twice creates two campaigns.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import { createCampaign, createMessage, getCampaign, scheduleCampaign } from "../../../../lib/activecampaign";
import { attachAcIds } from "../../../../lib/issue-versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  return authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
}

function tableFor(brand: string): string | null {
  if (brand === "latte") return "saturday_latte_issues";
  if (brand === "daily-grind") return "daily_grind_issues";
  return null;
}
function headlineCol(brand: string): string {
  return brand === "latte" ? "cover_story_headline" : "headline";
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    brand?: string;
    issueDate?: string;
    listId?: string | number;
    sendAtISO?: string;
    asDraft?: boolean;
    /**
     * Optional literal string replacements applied to the HTML + text
     * before the AC message is created. Used for one-off relabels
     * (e.g. "Saturday Morning Latte" → "Sunday Morning Latte" when the
     * Saturday issue is being reused as a Sunday send). Does NOT touch
     * the DB row — the persisted content stays as-generated.
     */
    replacements?: Array<{ from: string; to: string }>;
    /** Override env AC_FROM_NAME for this push (e.g. "Mark F."). */
    fromName?: string;
    /** Override env AC_FROM_ADDRESS for this push. */
    fromAddress?: string;
    /**
     * Explicit opt-in to push to a list that isn't in the newsletter
     * safelist (NEWSLETTER_LIST_IDS below). Required to prevent the
     * Sat 10-10 class of bug: forgetting a listId override and silently
     * routing a newsletter to a stale/legacy sales list via env default.
     */
    confirmListChange?: boolean;
    /** Human-readable reason, required when confirmListChange is true. */
    reason?: string;
  };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const brand = body.brand?.trim();
  const issueDate = body.issueDate?.trim();
  if (!brand || (brand !== "latte" && brand !== "daily-grind")) return NextResponse.json({ error: "brand must be 'latte' or 'daily-grind'" }, { status: 400 });
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });

  const listId = String(body.listId ?? process.env.AC_LIST_ID ?? "").trim();
  if (!listId) return NextResponse.json({ error: "listId required (pass in body or set AC_LIST_ID env)" }, { status: 400 });

  // Safelist of list IDs that newsletter sends are allowed to go to.
  // Overridable via NEWSLETTER_LIST_IDS env (comma-separated) in case a
  // second newsletter list ever gets added; default locks to list 43
  // "First 400 launch" after Sat 10-10 Latte accidentally shipped to
  // list 13 (legacy sales/workshop list, 6,985 recipients) because a
  // body.listId override was forgotten and env default was still at
  // the stale initial value of 13.
  const safelist = (process.env.NEWSLETTER_LIST_IDS ?? "43")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!safelist.includes(listId)) {
    if (body.confirmListChange !== true || !body.reason?.trim()) {
      return NextResponse.json({
        error: `listId ${listId} is NOT in the newsletter safelist (${safelist.join(", ")}). Refusing push to prevent accidental delivery to a non-newsletter list. To override intentionally, pass {confirmListChange: true, reason: "<why>"} in the body.`,
        safelist,
        attemptedListId: listId,
      }, { status: 400 });
    }
    logger.warn("ac_push.list_safelist_override", {
      brand, issueDate, listId, safelist, reason: body.reason.trim(),
    });
  }

  const fromAddress = body.fromAddress?.trim() || process.env.AC_FROM_ADDRESS;
  const fromName = body.fromName?.trim() || process.env.AC_FROM_NAME;
  if (!fromAddress || !fromName) return NextResponse.json({ error: "AC_FROM_ADDRESS / AC_FROM_NAME env missing (or pass fromAddress/fromName in body)" }, { status: 500 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const table = tableFor(brand)!;
  const hCol = headlineCol(brand);
  const { data, error } = await db
    .from(table)
    .select(`issue_date, subject, ${hCol}, html, text_body, approval_status`)
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no ${brand} issue for ${issueDate}` }, { status: 404 });

  const row = data as unknown as { issue_date: string; subject: string | null; html: string | null; text_body: string | null; approval_status: string | null } & Record<string, string | null>;
  if (!row.html) return NextResponse.json({ error: "no rendered html for this issue" }, { status: 400 });

  // Rewrite the render-time placeholder URL to AC's per-recipient
  // %UNSUBSCRIBELINK% merge tag. Without this, every recipient sees
  // the static placeholder and clicking it goes nowhere — the reason
  // we recorded 0 unsubs on the first four sends. AC substitutes the
  // merge tag with a real per-contact signed unsubscribe URL at send.
  const PLACEHOLDER = "https://send.castorabbott.com/unsubscribe?placeholder=1";
  let rewrittenHtml = (row.html ?? "").split(PLACEHOLDER).join("%UNSUBSCRIBELINK%");
  let rewrittenText = (row.text_body ?? "").split(PLACEHOLDER).join("%UNSUBSCRIBELINK%");
  let rewrittenSubject: string | null = null;

  // Apply caller-supplied literal replacements (relabel for one-off
  // reuse — e.g. Saturday → Sunday when a Saturday issue ships as a
  // Sunday send). Also applies to the subject line so the AC campaign
  // header + inbox subject stay consistent.
  for (const r of body.replacements ?? []) {
    if (!r?.from) continue;
    rewrittenHtml = rewrittenHtml.split(r.from).join(r.to ?? "");
    rewrittenText = rewrittenText.split(r.from).join(r.to ?? "");
    if (row.subject) {
      rewrittenSubject = (rewrittenSubject ?? row.subject).split(r.from).join(r.to ?? "");
    }
  }

  // Latte (weekend) must be explicitly approved before push. DG
  // (weekday) can push without approval — the send-schedule cron
  // pushes it directly. The pushToAC step is the "send" for AC
  // subscribers so an unapproved Latte push would ship to the real
  // list before Mark reviewed it. Block that.
  if (brand === "latte" && row.approval_status !== "approved") {
    return NextResponse.json({ error: `latte issue must be approved before AC push (current: ${row.approval_status ?? "pending"})` }, { status: 400 });
  }

  const subject = rewrittenSubject ?? row.subject ?? row[hCol] ?? `Issue ${issueDate}`;
  const campaignName = `${brand === "latte" ? "Saturday Latte" : "Daily Grind"} — ${issueDate}`;

  try {
    const message = await createMessage({
      subject, html: rewrittenHtml, text: rewrittenText, fromAddress, fromName, listId,
    });

    const sendAtISO = body.asDraft ? undefined : body.sendAtISO;
    // Always create as draft first — AC drops the sdate on the create
    // call. Then, if a schedule was requested, PUT the campaign back
    // with status:1 + sdate in a follow-up call.
    const campaign = await createCampaign({
      name: campaignName,
      listId,
      messageId: message.id,
      fromAddress,
      fromName,
    });
    if (sendAtISO) {
      try {
        await scheduleCampaign({ id: campaign.id, sendAtISO });
      } catch (schedErr) {
        console.warn("ac_push.schedule_step_failed", { campaignId: campaign.id, error: schedErr instanceof Error ? schedErr.message : String(schedErr) });
      }
    }

    // Record the AC push on the issue row for audit. MERGE into the
    // existing generation_meta — don't overwrite it. Prior behaviour
    // wiped contentType / formatStyle / pipeline / previousVersions /
    // all the research-stage metadata, destroying the format-rotation
    // audit trail on every AC push.
    const { data: existingRow } = await db
      .from(table)
      .select("generation_meta")
      .eq("issue_date", issueDate)
      .maybeSingle();
    const existingMeta = (existingRow?.generation_meta ?? {}) as Record<string, unknown>;
    const nextGenMeta = {
      ...existingMeta,
      ac_campaign_id: campaign.id,
      ac_message_id: message.id,
      ac_pushed_at: new Date().toISOString(),
      ac_send_at: sendAtISO ?? null,
    };
    await db.from(table).update({ generation_meta: nextGenMeta }).eq("issue_date", issueDate);

    try {
      await attachAcIds(db, brand as "latte" | "daily-grind", issueDate, String(campaign.id), String(message.id));
    } catch (err) {
      console.warn("ac_push.version_tag_failed", { brand, issueDate, error: err instanceof Error ? err.message : String(err) });
    }

    const acHost = (process.env.AC_API_URL ?? "").replace(/\/api\/3\/?$/, "").replace(/\.api-us\d\.com/, ".activehosted.com");
    const dashboardUrl = `${acHost}/app/campaigns/${campaign.id}`;

    // Verify what AC actually stored — status codes: 0=draft, 1=scheduled,
    // 2=sending, 5=sent. If we asked for scheduled but AC kept it as draft,
    // return that mismatch so the caller sees the truth.
    const verify = await getCampaign(campaign.id);
    const acStoredStatus = verify ? String(verify.status ?? "") : "";
    const acStoredSdate = verify ? String(verify.sdate ?? "") : "";
    const stickinessOk = !sendAtISO || acStoredStatus === "1";

    logger.info("ac_push.success", {
      brand, issueDate, campaignId: campaign.id, messageId: message.id,
      sendAtISO: sendAtISO ?? null, acStoredStatus, acStoredSdate, stickinessOk,
    });
    return NextResponse.json({
      ok: true,
      brand, issueDate,
      messageId: message.id,
      campaignId: campaign.id,
      requestedStatus: sendAtISO ? "scheduled" : "draft",
      acStoredStatus,
      acStoredSdate,
      stickinessOk,
      sendAtISO: sendAtISO ?? null,
      listId,
      dashboardUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("ac_push.failed", { brand, issueDate, error: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
