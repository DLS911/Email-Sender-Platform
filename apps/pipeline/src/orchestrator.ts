/**
 * Pipeline orchestrator.
 *
 * Wires the blocks together for one issue of one brand. The control flow
 * is explicit per spec 04 — no graph compiler, no DSL, just typed code.
 *
 * The orchestrator is generic over BlockBundle so we can swap in real
 * implementations or mocks without changing this file. Stage 3 swaps in
 * real blocks; today the integration test runs against `mockBlocks`.
 */
import { logger } from "@platform/observability";
import { PipelineError, type RunContext } from "@platform/schemas";
import type { BlockBundle, DraftOutput } from "./blocks/types.js";

export type OrchestrateInput = {
  context: RunContext;
  edition: "weekday" | "weekend";
  brandName: string;
  blocks: BlockBundle;
  /** previous topics to avoid repeating; comes from the brain in stage 3 */
  recentTopics?: string[];
  /** max revision cycles when quality gate fails */
  maxRevisionCycles?: number;
};

export type OrchestrateResult = {
  episode: DraftOutput;
  html: string;
  text: string;
  subject: string;
  qualityScore: { loveRate: number; shareRate: number; churnRisk: number };
  revisionCycles: number;
};

const DEFAULT_MAX_REVISION_CYCLES = 3;

export async function runIssue(input: OrchestrateInput): Promise<OrchestrateResult> {
  const { context, edition, brandName, blocks } = input;
  const maxRevisionCycles = input.maxRevisionCycles ?? DEFAULT_MAX_REVISION_CYCLES;

  logger.info("pipeline.start", {
    run_id: context.runId,
    brand_id: context.brandId,
    edition,
  });

  // 1. Topic proposal
  const topic = await blocks.topicProposer({
    context,
    edition,
    recentTopics: input.recentTopics ?? [],
  });
  logger.info("pipeline.topic_proposed", {
    run_id: context.runId,
    content_type: topic.contentType,
    topic: topic.topic,
  });

  // 2. Concept check — make sure topic isn't a recent dupe
  const conceptCheck = await blocks.conceptCheck({
    context,
    candidates: [topic.topic],
  });
  if (!conceptCheck.passed) {
    throw new PipelineError("concept_check_failed", "topic blocked by concept check", {
      context: { run_id: context.runId, blocked: conceptCheck.blocked },
    });
  }

  // 3. Research
  const research = await blocks.research({
    context,
    topic: topic.topic,
    contentType: topic.contentType,
  });

  // 4. Initial draft
  let draft = await blocks.draft({
    context,
    research,
    contentType: topic.contentType,
    edition,
  });

  // 5. Editor + quality gate revision loop
  let revisionCycles = 0;
  let editorResult = await blocks.editor({ context, draft });
  draft = editorResult.edited;

  let panel = await blocks.personaPanel({ context, draft });

  while (!panel.passed && revisionCycles < maxRevisionCycles) {
    revisionCycles++;
    logger.info("pipeline.revision_started", {
      run_id: context.runId,
      cycle: revisionCycles,
      reason: panel.recommendations,
    });
    editorResult = await blocks.editor({
      context,
      draft,
      revisionFeedback: panel.recommendations,
    });
    draft = editorResult.edited;
    panel = await blocks.personaPanel({ context, draft });
  }

  if (!panel.passed) {
    throw new PipelineError(
      "quality_gate_exceeded_revisions",
      `quality gate did not pass after ${maxRevisionCycles} revisions`,
      {
        context: {
          run_id: context.runId,
          revisions: revisionCycles,
          recommendations: panel.recommendations,
        },
      },
    );
  }

  // 6. Fact check
  const factCheck = await blocks.factCheck({
    context,
    draft,
    sources: research.sources,
  });
  if (!factCheck.passed) {
    throw new PipelineError("fact_check_failed", "fact check found unresolved issues", {
      context: { run_id: context.runId, issues: factCheck.issues },
    });
  }

  // 7. Concept extract — write back to brain
  await blocks.conceptExtract({ context, episode: draft });

  // 8. Render HTML for distribution
  const rendered = await blocks.assembleHtml({
    context,
    episode: draft,
    brandName,
    edition,
  });

  logger.info("pipeline.complete", {
    run_id: context.runId,
    revisions: revisionCycles,
    love_rate: panel.loveRate,
    share_rate: panel.shareRate,
    churn_risk: panel.churnRisk,
  });

  return {
    episode: draft,
    html: rendered.html,
    text: rendered.text,
    subject: rendered.subject,
    qualityScore: {
      loveRate: panel.loveRate,
      shareRate: panel.shareRate,
      churnRisk: panel.churnRisk,
    },
    revisionCycles,
  };
}
