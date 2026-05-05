import { logger } from "./logger.js";
import { metric } from "./metric.js";

export async function span<T>(
  name: string,
  fn: () => Promise<T>,
  context: Record<string, unknown> = {},
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const elapsed = Date.now() - startedAt;
    metric.timing(`span.${name}`, elapsed, { status: "ok" });
    logger.debug("span.complete", { span: name, ms: elapsed, ...context });
    return result;
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    metric.timing(`span.${name}`, elapsed, { status: "error" });
    logger.error("span.failed", {
      span: name,
      ms: elapsed,
      error_message: err instanceof Error ? err.message : String(err),
      ...context,
    });
    throw err;
  }
}
