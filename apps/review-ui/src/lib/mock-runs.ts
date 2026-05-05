/**
 * Mock pipeline run + block_executions data. Models what the
 * observability layer will surface from real runs per spec 10.
 */

export type BlockExecution = {
  id: string;
  blockName: string;
  blockType:
    | "topic_proposer"
    | "concept_check"
    | "research"
    | "draft"
    | "editor"
    | "fact_check"
    | "persona_eval"
    | "score_aggregate"
    | "concept_extract"
    | "assemble_html";
  sequence: number;
  provider: "anthropic" | "openai" | "google" | null;
  model: string | null;
  temperature: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  retryCount: number;
  fallbackUsed: boolean;
  validationStatus: "passed" | "auto_healed" | "fallback_validated" | "failed";
  status: "success" | "retry" | "fallback_used" | "failed";
  startedAt: string;
  completedAt: string;
};

export type PipelineRun = {
  id: string;
  brandId: string;
  brandName: string;
  edition: "weekday" | "weekend";
  status: "running" | "completed" | "failed" | "cancelled";
  triggeredBy: "scheduled_cron" | "manual" | "experiment" | "replay";
  startedAt: string;
  completedAt: string | null;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  episodeId: string | null;
  blockExecutions: BlockExecution[];
};

const RUN_BASE = "2026-05-05T05:00:00Z";

function block(
  partial: Partial<BlockExecution> & {
    blockName: string;
    blockType: BlockExecution["blockType"];
    sequence: number;
  },
): BlockExecution {
  const startedAt = new Date(new Date(RUN_BASE).getTime() + partial.sequence * 8000).toISOString();
  const latency = partial.latencyMs ?? 4_500 + partial.sequence * 200;
  const completedAt = new Date(new Date(startedAt).getTime() + latency).toISOString();
  return {
    id: `blk-${partial.sequence.toString().padStart(2, "0")}`,
    provider: partial.provider ?? "anthropic",
    model: partial.model ?? "claude-sonnet-4-5-20250929",
    temperature: partial.temperature ?? 0.3,
    inputTokens: partial.inputTokens ?? 8_000,
    outputTokens: partial.outputTokens ?? 1_400,
    costUsd: partial.costUsd ?? 0.045,
    latencyMs: latency,
    retryCount: partial.retryCount ?? 0,
    fallbackUsed: partial.fallbackUsed ?? false,
    validationStatus: partial.validationStatus ?? "passed",
    status: partial.status ?? "success",
    startedAt,
    completedAt,
    ...partial,
  };
}

export const mockRuns: Record<string, PipelineRun> = {
  "run-001": {
    id: "run-001",
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    edition: "weekday",
    status: "completed",
    triggeredBy: "scheduled_cron",
    startedAt: RUN_BASE,
    completedAt: "2026-05-05T05:02:14Z",
    totalCostUsd: 0.412,
    totalInputTokens: 64_280,
    totalOutputTokens: 9_840,
    episodeId: "ep-001",
    blockExecutions: [
      block({ blockName: "topic_proposer", blockType: "topic_proposer", sequence: 0 }),
      block({
        blockName: "concept_check",
        blockType: "concept_check",
        sequence: 1,
        provider: null,
        model: null,
        temperature: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }),
      block({
        blockName: "weekday_research",
        blockType: "research",
        sequence: 2,
        inputTokens: 12_500,
        outputTokens: 2_100,
        costUsd: 0.069,
      }),
      block({
        blockName: "weekday_writer",
        blockType: "draft",
        sequence: 3,
        inputTokens: 18_400,
        outputTokens: 2_900,
        costUsd: 0.099,
      }),
      block({
        blockName: "editor",
        blockType: "editor",
        sequence: 4,
        inputTokens: 8_200,
        outputTokens: 1_800,
        retryCount: 1,
        validationStatus: "auto_healed",
        status: "retry",
      }),
      block({
        blockName: "fact_check",
        blockType: "fact_check",
        sequence: 5,
        inputTokens: 6_800,
        outputTokens: 800,
        costUsd: 0.024,
      }),
      block({
        blockName: "persona_panel",
        blockType: "persona_eval",
        sequence: 6,
        inputTokens: 9_200,
        outputTokens: 1_400,
        costUsd: 0.048,
      }),
      block({
        blockName: "score_aggregate",
        blockType: "score_aggregate",
        sequence: 7,
        provider: null,
        model: null,
        temperature: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }),
      block({
        blockName: "concept_extract",
        blockType: "concept_extract",
        sequence: 8,
        inputTokens: 4_200,
        outputTokens: 600,
        costUsd: 0.022,
      }),
      block({
        blockName: "assemble_html",
        blockType: "assemble_html",
        sequence: 9,
        provider: null,
        model: null,
        temperature: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }),
    ],
  },
  "run-002": {
    id: "run-002",
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    edition: "weekday",
    status: "completed",
    triggeredBy: "scheduled_cron",
    startedAt: "2026-05-04T05:00:00Z",
    completedAt: "2026-05-04T05:03:08Z",
    totalCostUsd: 0.578,
    totalInputTokens: 78_120,
    totalOutputTokens: 11_240,
    episodeId: "ep-002",
    blockExecutions: [
      block({ blockName: "topic_proposer", blockType: "topic_proposer", sequence: 0 }),
      block({
        blockName: "concept_check",
        blockType: "concept_check",
        sequence: 1,
        provider: null,
        model: null,
        temperature: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }),
      block({
        blockName: "weekday_research",
        blockType: "research",
        sequence: 2,
        inputTokens: 14_200,
        outputTokens: 2_400,
        costUsd: 0.078,
        retryCount: 2,
        fallbackUsed: true,
        provider: "anthropic",
        model: "claude-opus-4-20250514",
        validationStatus: "fallback_validated",
        status: "fallback_used",
      }),
      block({
        blockName: "weekday_writer",
        blockType: "draft",
        sequence: 3,
        inputTokens: 19_800,
        outputTokens: 3_100,
        costUsd: 0.106,
      }),
      block({
        blockName: "editor",
        blockType: "editor",
        sequence: 4,
        inputTokens: 8_900,
        outputTokens: 2_000,
      }),
      block({
        blockName: "fact_check",
        blockType: "fact_check",
        sequence: 5,
        inputTokens: 7_200,
        outputTokens: 850,
      }),
      block({
        blockName: "persona_panel",
        blockType: "persona_eval",
        sequence: 6,
        inputTokens: 9_800,
        outputTokens: 1_500,
      }),
      block({
        blockName: "score_aggregate",
        blockType: "score_aggregate",
        sequence: 7,
        provider: null,
        model: null,
        temperature: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }),
      block({
        blockName: "concept_extract",
        blockType: "concept_extract",
        sequence: 8,
        inputTokens: 4_400,
        outputTokens: 700,
      }),
      block({
        blockName: "assemble_html",
        blockType: "assemble_html",
        sequence: 9,
        provider: null,
        model: null,
        temperature: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }),
    ],
  },
};

export function getMockRun(id: string): PipelineRun | null {
  return mockRuns[id] ?? null;
}

export function listMockRunIds(): string[] {
  return Object.keys(mockRuns);
}
