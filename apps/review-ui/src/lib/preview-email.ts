/**
 * Preview email sent to Mark after each newsletter issue is generated.
 *
 * Wraps the rendered issue HTML with a header banner containing two
 * signed action buttons: Approve for Send (green) and Needs Work (amber).
 * The buttons are signed with CRON_SECRET so a leaked link can only
 * approve or flag the exact issue it was minted for.
 *
 * The send cron refuses to send unless approval_status = 'approved'
 * at cron-fire time, so this preview is the sole gate between the
 * writer's draft and thousands of inboxes.
 */

import { Resend } from "resend";
import { approvalUrl, type ApprovalBrand } from "./approval-token";

const DEFAULT_APPROVER = "mark@castorabbott.com";
const DEFAULT_FROM = "latte@send.castorabbott.com";

export type PreviewEmailBrand = ApprovalBrand;

type PreviewInput = {
  brand: PreviewEmailBrand;
  issueDate: string;
  subject: string;
  issueHtml: string;
  issueText?: string;
  baseUrl: string;
};

type PreviewSendResult = { ok: true; resendId: string } | { ok: false; error: string };

function brandLabel(brand: PreviewEmailBrand): string {
  return brand === "latte" ? "Saturday Morning Latte" : "Daily Grind";
}

/**
 * Build the wrapper HTML: a banner at the top with issue metadata and
 * the two action buttons, then the actual rendered issue below.
 */
export function renderPreviewHtml(input: PreviewInput): string {
  const approveHref = approvalUrl(input.baseUrl, input.brand, input.issueDate, "approve");
  const needsWorkHref = approvalUrl(input.baseUrl, input.brand, input.issueDate, "needs-work");
  const label = brandLabel(input.brand);

  const banner = `
<div style="max-width:640px;margin:0 auto 24px auto;padding:24px;background:#fefaf3;border:1px solid #e6d9c3;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Georgia,serif;color:#2d2926">
  <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;letter-spacing:1.5px;color:#a5905b;text-transform:uppercase">Preview for review · ${label}</p>
  <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#2d2926">${escapeHtml(input.subject)}</p>
  <p style="margin:0 0 20px 0;font-size:13px;color:#6a6360">Scheduled to send on <strong>${input.issueDate}</strong>. Nothing goes out to subscribers until you click Approve.</p>
  <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    <tr>
      <td style="padding-right:12px">
        <a href="${approveHref}" style="display:inline-block;padding:14px 28px;background:#2d7a3f;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Georgia,serif">✅ Approve for Send</a>
      </td>
      <td>
        <a href="${needsWorkHref}" style="display:inline-block;padding:14px 28px;background:#c47a1a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Georgia,serif">⚠️ Needs Work</a>
      </td>
    </tr>
  </table>
  <p style="margin:16px 0 0 0;font-size:12px;color:#8f867f;line-height:1.5">Below is the full issue exactly as subscribers would see it. Scroll down to review.</p>
</div>
<hr style="max-width:640px;margin:0 auto;border:none;border-top:1px solid #e6d9c3"/>
`;

  return banner + input.issueHtml;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send the preview to Mark. Best-effort — on transient failure, returns
 * ok:false with an error string so the caller can log; do NOT throw and
 * fail the entire generate run just because the preview email couldn't
 * be sent. The send cron will still refuse to ship a pending issue.
 */
export async function sendPreviewEmail(input: PreviewInput): Promise<PreviewSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };

  const to = process.env.PREVIEW_APPROVER_EMAIL || DEFAULT_APPROVER;
  const fromAddress = process.env.RESEND_FROM_ADDRESS || DEFAULT_FROM;
  const label = brandLabel(input.brand);
  const html = renderPreviewHtml(input);
  const text = `[${label} · Preview for ${input.issueDate}] ${input.subject}

Approve for send: ${approvalUrl(input.baseUrl, input.brand, input.issueDate, "approve")}
Needs work: ${approvalUrl(input.baseUrl, input.brand, input.issueDate, "needs-work")}

${input.issueText ?? ""}`;

  const resend = new Resend(apiKey);
  try {
    const result = await resend.emails.send({
      from: `Latte Preview <${fromAddress}>`,
      to: [to],
      subject: `[Preview · ${input.issueDate}] ${input.subject}`,
      html,
      text,
      tags: [
        { name: "brand", value: input.brand === "latte" ? "saturday_latte" : "daily_grind" },
        { name: "issue_date", value: input.issueDate },
        { name: "mode", value: "preview_for_approval" },
      ],
    });
    if (result.error) {
      return { ok: false, error: result.error.message ?? "resend error" };
    }
    if (!result.data?.id) return { ok: false, error: "no resend id" };
    return { ok: true, resendId: result.data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
