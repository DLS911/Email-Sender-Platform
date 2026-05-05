/**
 * Svix-compatible webhook signature verification using Node's crypto.
 *
 * Resend (and many other providers) use the Svix format:
 *   svix-id        — unique message id
 *   svix-timestamp — unix seconds
 *   svix-signature — space-separated list of "v1,<base64-hmac>" signatures
 *
 * The HMAC is SHA-256 of `${id}.${timestamp}.${rawBody}` using the
 * signing secret (which arrives base64-prefixed with "whsec_").
 *
 * No external dep — pure Node crypto. Constant-time comparison.
 *
 * Reference:
 *   https://docs.svix.com/receiving/verifying-payloads/how-manual
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 5 * 60;

export type VerifyInput = {
  id: string;
  timestamp: string;
  signatureHeader: string;
  rawBody: string;
  signingSecret: string;
  /** Optional override for replay tolerance window (default 5 minutes). */
  toleranceSeconds?: number;
  /** Optional clock injection for tests (epoch seconds). */
  now?: number;
};

export type VerifyResult = { ok: true } | { ok: false; reason: string };

function decodeSecret(secret: string): Buffer {
  const stripped = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(stripped, "base64");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifySvixSignature(input: VerifyInput): VerifyResult {
  if (!input.id || !input.timestamp || !input.signatureHeader) {
    return { ok: false, reason: "missing svix headers" };
  }
  if (!input.signingSecret) return { ok: false, reason: "missing signing secret" };

  const ts = Number.parseInt(input.timestamp, 10);
  if (Number.isNaN(ts)) return { ok: false, reason: "invalid timestamp" };

  const tolerance = input.toleranceSeconds ?? TOLERANCE_SECONDS;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > tolerance) {
    return { ok: false, reason: "timestamp outside tolerance window" };
  }

  let secretKey: Buffer;
  try {
    secretKey = decodeSecret(input.signingSecret);
  } catch {
    return { ok: false, reason: "could not decode signing secret" };
  }

  const toSign = `${input.id}.${input.timestamp}.${input.rawBody}`;
  const computed = createHmac("sha256", secretKey).update(toSign).digest("base64");

  // Header may contain multiple signatures separated by spaces, each prefixed
  // with the version (v1,). Accept if any matches.
  const candidates = input.signatureHeader
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("v1,") ? s.slice(3) : s));

  for (const sig of candidates) {
    if (safeEqual(sig, computed)) return { ok: true };
  }

  return { ok: false, reason: "signature mismatch" };
}

/**
 * Compute a v1 signature for testing. Mirrors what a sender does so we
 * can test verification round-trip.
 */
export function computeSvixSignature(input: {
  id: string;
  timestamp: string;
  rawBody: string;
  signingSecret: string;
}): string {
  const secretKey = decodeSecret(input.signingSecret);
  const toSign = `${input.id}.${input.timestamp}.${input.rawBody}`;
  const sig = createHmac("sha256", secretKey).update(toSign).digest("base64");
  return `v1,${sig}`;
}
