/**
 * Shared formatting helpers for prompt template construction.
 * Used by multiple block templates to produce consistent prompt formatting.
 *
 * Pure functions only — no I/O, no async, no side effects.
 */

/**
 * Format a list of strings as a bulleted prose list.
 * Used when an array needs to render as a readable list inside a prompt.
 *
 * Example: formatBulletList(["a", "b", "c"]) => "- a\n- b\n- c"
 */
export function formatBulletList(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Format a numbered list with consistent indexing.
 * Used when sequence matters (e.g. tactical moves, route stops).
 */
export function formatNumberedList(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

/**
 * Format a labeled section with header and body.
 * Used to delineate sections within a long prompt.
 */
export function formatSection(label: string, body: string): string {
  return `## ${label}\n\n${body.trim()}`;
}

/**
 * Format a key-value pair as a single line.
 * Used for compact attribute display.
 */
export function formatKeyValue(key: string, value: string | number | boolean): string {
  return `${key}: ${value}`;
}

/**
 * Format an object's fields as a list of key-value lines.
 * Used for compact context display.
 */
export function formatObjectAsLines(obj: Record<string, string | number | boolean>): string {
  return Object.entries(obj)
    .map(([k, v]) => formatKeyValue(k, v))
    .join("\n");
}

/**
 * Wrap content in a labeled XML-style tag for clear prompt boundaries.
 * Some LLMs respond better when input boundaries are tagged explicitly.
 */
export function wrapInTag(tag: string, content: string): string {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

/**
 * Truncate a long string with an ellipsis indicator.
 * Used when including reference material that has length limits.
 */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

/**
 * Format an ISO timestamp into a readable date string.
 * Used in concept-check and lookback contexts.
 */
export function formatDate(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Compute days between two ISO timestamps.
 * Used in concept-check lookback windows.
 */
export function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.floor((end - start) / (1000 * 60 * 60 * 24));
}
