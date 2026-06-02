/**
 * Send-side compliance helpers (item J+K).
 *
 * - isSuppressed: check before sending so we never email a suppressed address.
 * - rewriteUnsubscribeUrl: replace the rendered placeholder with a per-recipient
 *   signed URL.
 * - listUnsubscribeHeaders: List-Unsubscribe + List-Unsubscribe-Post (RFC 8058)
 *   one-click headers, supported by Gmail/Outlook/Apple Mail.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { unsubscribeUrl, type SubscriberList } from "./unsubscribe-token";

export const UNSUBSCRIBE_PLACEHOLDER =
  "https://send.castorabbott.com/unsubscribe?placeholder=1";

export function getBaseUrl(): string {
  // Prefer an explicit BASE_URL env if set; otherwise fall back to the
  // production Vercel URL (configured per project).
  return (
    process.env.BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "https://email-sndr-platform.vercel.app"
  );
}

export async function isSuppressed(db: SupabaseClient, email: string): Promise<boolean> {
  const { data, error } = await db
    .from("suppression_list")
    .select("email")
    .ilike("email", email.trim().toLowerCase())
    .maybeSingle();
  if (error) return false; // fail-open on transient DB error; webhook will catch repeat bounces
  return Boolean(data);
}

export function rewriteUnsubscribeUrl(
  html: string,
  text: string,
  email: string,
  list: SubscriberList,
): { html: string; text: string; url: string } {
  const url = unsubscribeUrl(email, list, getBaseUrl());
  return {
    html: html.split(UNSUBSCRIBE_PLACEHOLDER).join(url),
    text: text.split(UNSUBSCRIBE_PLACEHOLDER).join(url),
    url,
  };
}

/** RFC 8058 List-Unsubscribe headers — both mailto and one-click. */
export function listUnsubscribeHeaders(
  email: string,
  list: SubscriberList,
): Record<string, string> {
  const url = unsubscribeUrl(email, list, getBaseUrl());
  // Mailto fallback uses a plus-tag so inbound replies are routable.
  const fromHost = process.env.RESEND_FROM_ADDRESS?.split("@")[1] ?? "send.castorabbott.com";
  const mailto = `unsubscribe+${list}@${fromHost}`;
  return {
    "List-Unsubscribe": `<${url}>, <mailto:${mailto}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
