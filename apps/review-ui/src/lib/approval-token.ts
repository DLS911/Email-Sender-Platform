/**
 * HMAC-signed approval tokens for the Mark-review flow.
 *
 * Token payload: brand ("latte" | "daily-grind") + issue_date + action
 * ("approve" | "needs-work"). Signed with CRON_SECRET so any tampering
 * (a link crafted for a different issue, or a different action) fails
 * verification. Base64url-encoded so it lives cleanly in a URL query
 * string.
 *
 * Tokens are stateless — verification does not require a DB lookup,
 * only the shared CRON_SECRET. The state of the approval lives in the
 * issues table (approval_status). Single-use is enforced there: once
 * an issue leaves 'pending', a second click just no-ops.
 */

import { createHmac, timingSafeEqual } from "crypto";

export type ApprovalBrand = "latte" | "daily-grind";
export type ApprovalAction = "approve" | "needs-work";

const TOKEN_VERSION = "v1";

function getSecret(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("approval-token: CRON_SECRET missing or too short");
  }
  return secret;
}

function payloadString(
  brand: ApprovalBrand,
  issueDate: string,
  action: ApprovalAction,
): string {
  return `${TOKEN_VERSION}|${brand}|${issueDate}|${action}`;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = 4 - (s.length % 4);
  const padded = pad === 4 ? s : s + "=".repeat(pad);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signApprovalToken(
  brand: ApprovalBrand,
  issueDate: string,
  action: ApprovalAction,
): string {
  const payload = payloadString(brand, issueDate, action);
  const mac = createHmac("sha256", getSecret()).update(payload).digest();
  return b64url(mac);
}

export function verifyApprovalToken(
  brand: ApprovalBrand,
  issueDate: string,
  action: ApprovalAction,
  token: string,
): boolean {
  try {
    const expected = createHmac("sha256", getSecret())
      .update(payloadString(brand, issueDate, action))
      .digest();
    const provided = fromB64url(token);
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

/** Convenience: build the absolute approval URL for an email button. */
export function approvalUrl(
  baseUrl: string,
  brand: ApprovalBrand,
  issueDate: string,
  action: ApprovalAction,
): string {
  const token = signApprovalToken(brand, issueDate, action);
  const path = action === "approve" ? "approve" : "needs-work";
  return `${baseUrl.replace(/\/$/, "")}/api/${path}/${brand}/${issueDate}?t=${token}`;
}
