/**
 * Typed error hierarchy. Every error in the platform extends PlatformError
 * and carries a stable `code` string. Application code matches on `code`,
 * not class name.
 *
 * Documented in docs/runbooks/errors.md.
 */

export type ErrorContext = Record<string, unknown>;

export class PlatformError extends Error {
  readonly code: string;
  readonly context: ErrorContext;
  override readonly cause?: Error;

  constructor(
    code: string,
    message: string,
    opts: { context?: ErrorContext | undefined; cause?: Error | undefined } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = opts.context ?? {};
    if (opts.cause !== undefined) {
      this.cause = opts.cause;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      cause: this.cause ? { name: this.cause.name, message: this.cause.message } : undefined,
    };
  }
}

type ErrorOpts = { context?: ErrorContext | undefined; cause?: Error | undefined };

export class LLMGenerationError extends PlatformError {
  constructor(message: string, opts?: ErrorOpts) {
    super("llm.generation_failed", message, opts);
  }
}

export class SchemaValidationError extends PlatformError {
  constructor(message: string, opts?: ErrorOpts) {
    super("schema.validation_failed", message, opts);
  }
}

export class BrainQueryError extends PlatformError {
  constructor(message: string, opts?: ErrorOpts) {
    super("brain.query_failed", message, opts);
  }
}

export class DistributionError extends PlatformError {
  constructor(message: string, opts?: ErrorOpts) {
    super("distribution.send_failed", message, opts);
  }
}

export class PolicyViolationError extends PlatformError {
  constructor(message: string, opts?: ErrorOpts) {
    super("policy.violation", message, opts);
  }
}

export class PipelineError extends PlatformError {
  constructor(code: string, message: string, opts?: ErrorOpts) {
    super(`pipeline.${code}`, message, opts);
  }
}

export class ConfigError extends PlatformError {
  constructor(message: string, opts?: ErrorOpts) {
    super("config.invalid", message, opts);
  }
}
