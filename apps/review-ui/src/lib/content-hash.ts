/**
 * Content hash for issue approval tokens.
 *
 * Short-circuit protection against the Sat 10-16 class of bug: user
 * approved content X in the preview, but by the time push-to-ac ran,
 * a late-arriving background regen had overwritten the DB with content
 * Y. The push shipped Y to the list.
 *
 * Fix: every preview/inspection returns a short deterministic hash of
 * the actual content that will ship (subject + html). Push accepts the
 * hash as `approvedContentHash`. If present and the hash of current DB
 * content doesn't match, push refuses with 409.
 *
 * Hash scope: subject line + rendered HTML. Changes to generation_meta,
 * extraction fields, approval status, etc. do NOT invalidate — only
 * what the recipient will actually see.
 */

import { createHash } from "node:crypto";

export function computeContentHash(input: {
  subject?: string | null;
  html?: string | null;
}): string {
  const subj = (input.subject ?? "").trim();
  const html = (input.html ?? "").trim();
  return createHash("sha256").update(`${subj}\n---\n${html}`).digest("hex").slice(0, 16);
}
