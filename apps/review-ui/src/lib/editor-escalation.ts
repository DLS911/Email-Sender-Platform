/**
 * Editor escalation emails.
 *
 * Two scenarios trigger a message to the editor (Austin by default):
 *   1. Mark clicks "Needs Work" on a preview → NeedsWorkNotice.
 *   2. A send cron finds a pending or needs_work issue at send time →
 *      SendBlockedNotice.
 *
 * Escalations go to EDITOR_ESCALATION_EMAIL (defaults to
 * austin@castorabbott.com). They are best-effort — a Resend failure is
 * logged but does not throw further up the call stack.
 */

import { Resend } from "resend";
import type { ApprovalBrand } from "./approval-token";

const DEFAULT_EDITOR = "austin@castorabbott.com";
const DEFAULT_FROM = "latte@send.castorabbott.com";

export type NeedsWorkNotice = {
  kind: "needs_work";
  brand: ApprovalBrand;
  issueDate: string;
  subject: string;
  baseUrl: string;
};

export type SendBlockedNotice = {
  kind: "send_blocked";
  brand: ApprovalBrand;
  issueDate: string;
  subject: string;
  currentStatus: "pending" | "needs_work";
  baseUrl: string;
};

type EscalationInput = NeedsWorkNotice | SendBlockedNotice;

function brandLabel(brand: ApprovalBrand): string {
  return brand === "latte" ? "Saturday Morning Latte" : "Daily Grind";
}

function renderHtml(input: EscalationInput): { subject: string; html: string; text: string } {
  const label = brandLabel(input.brand);
  if (input.kind === "needs_work") {
    const subject = `[Needs Work] ${label} · ${input.issueDate}`;
    const html = `
<div style="max-width:640px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Georgia,serif;color:#2d2926;background:#ffffff">
  <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;letter-spacing:1.5px;color:#c47a1a;text-transform:uppercase">Mark flagged this issue</p>
  <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600">${label} · ${input.issueDate}</h1>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6">Mark clicked <strong>Needs Work</strong> on today's preview.</p>
  <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6"><strong>Subject:</strong> ${escapeHtml(input.subject)}</p>
  <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#6a6360">The send cron will NOT ship this issue until you regenerate or explicitly approve it. The scheduled send time will simply be skipped, and this notice will not repeat for the same issue.</p>
</div>`;
    const text = `Mark clicked Needs Work on ${label} · ${input.issueDate}.\nSubject: ${input.subject}\n\nThe send cron will NOT ship this issue until you regenerate or explicitly approve it.`;
    return { subject, html, text };
  }

  const subject = `[Send Blocked] ${label} · ${input.issueDate}`;
  const statusPhrase =
    input.currentStatus === "needs_work"
      ? "Mark previously flagged it as Needs Work"
      : "Mark never clicked Approve on the preview";
  const html = `
<div style="max-width:640px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Georgia,serif;color:#2d2926;background:#ffffff">
  <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;letter-spacing:1.5px;color:#8b1e1e;text-transform:uppercase">Scheduled send skipped</p>
  <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600">${label} · ${input.issueDate}</h1>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6">The send cron fired at its scheduled time, but the issue was still <strong>${input.currentStatus.replace("_", " ")}</strong>. ${statusPhrase}. Nothing went out to subscribers.</p>
  <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6"><strong>Subject:</strong> ${escapeHtml(input.subject)}</p>
  <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#6a6360">Fix options: regenerate the issue and re-approve, or manually approve as-is with a signed link. This notice will not repeat for the same issue.</p>
</div>`;
  const text = `Send blocked: ${label} · ${input.issueDate}.\nStatus: ${input.currentStatus}. ${statusPhrase}. Nothing went out.\nSubject: ${input.subject}`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendEditorEscalation(
  input: EscalationInput,
): Promise<{ ok: true; resendId: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };
  const to = process.env.EDITOR_ESCALATION_EMAIL || DEFAULT_EDITOR;
  const fromAddress = process.env.RESEND_FROM_ADDRESS || DEFAULT_FROM;
  const { subject, html, text } = renderHtml(input);

  const resend = new Resend(apiKey);
  try {
    const result = await resend.emails.send({
      from: `Newsletter Editor <${fromAddress}>`,
      to: [to],
      subject,
      html,
      text,
    });
    if (result.error) return { ok: false, error: result.error.message ?? "resend error" };
    if (!result.data?.id) return { ok: false, error: "no resend id" };
    return { ok: true, resendId: result.data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
