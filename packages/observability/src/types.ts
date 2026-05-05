export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export type LogEvent = {
  timestamp: string;
  level: LogLevel;
  event: string;
  run_id?: string;
  brand_id?: string;
  block_name?: string;
  [k: string]: unknown;
};
