/**
 * Per-recipient unsubscribe tokens (item J).
 *
 * Deterministic HMAC over the email + list, signed with CRON_SECRET. No
 * additional env var to manage. Verifying is a constant-time compare on the
 * regenerated HMAC — the URL is unforgeable without the secret.
 */

import crypto from "crypto";

export type SubscriberList = "daily-grind" | "latte";

function getSecret(): string {
  const s = process.env.CRON_SECRET;
  if (!s) throw new Error("CRON_SECRET missing — required to sign unsubscribe tokens");
  return s;
}

export function unsubscribeToken(email: string, list: SubscriberList): string {
  const h = crypto.createHmac("sha256", getSecret());
  h.update(email.trim().toLowerCase());
  h.update("|");
  h.update(list);
  // 16 hex chars (64 bits) is plenty against guessing while keeping URLs short.
  return h.digest("hex").slice(0, 16);
}

export function verifyUnsubscribeToken(
  email: string,
  list: SubscriberList,
  token: string,
): boolean {
  const expected = unsubscribeToken(email, list);
  if (token.length !== expected.length) return false;
  // Constant-time compare to avoid timing leaks.
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(token, "hex"));
}

/** Build the absolute unsubscribe URL for an email's footer + List-Unsubscribe header. */
export function unsubscribeUrl(email: string, list: SubscriberList, baseUrl: string): string {
  const token = unsubscribeToken(email, list);
  return `${baseUrl.replace(/\/+$/, "")}/api/unsubscribe?email=${encodeURIComponent(email)}&list=${list}&token=${token}`;
}
