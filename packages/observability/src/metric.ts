import { logger } from "./logger.js";

type Tags = Record<string, string | number | boolean>;

export const metric = {
  increment: (name: string, tags: Tags = {}, value = 1): void => {
    logger.info("metric.increment", { metric_name: name, value, ...tags });
  },
  gauge: (name: string, value: number, tags: Tags = {}): void => {
    logger.info("metric.gauge", { metric_name: name, value, ...tags });
  },
  timing: (name: string, ms: number, tags: Tags = {}): void => {
    logger.info("metric.timing", { metric_name: name, value_ms: ms, ...tags });
  },
};
