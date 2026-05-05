/**
 * Block contract — every pipeline block conforms to this shape.
 *
 * Real implementations land in stage 3. The orchestrator depends only
 * on these types, not on concrete implementations, so we can run the
 * full pipeline end-to-end with mocks and swap in real blocks one at
 * a time later.
 */
import type { RunContext } from "@platform/schemas";

export type Block<TInput, TOutput> = (input: TInput & { context: RunContext }) => Promise<TOutput>;

export type BlockBundle = {
  topicProposer: Block<TopicProposerInput, TopicProposerOutput>;
  conceptCheck: Block<ConceptCheckInput, ConceptCheckOutput>;
  research: Block<ResearchInput, ResearchOutput>;
  draft: Block<DraftInput, DraftOutput>;
  editor: Block<EditorInput, EditorOutput>;
  factCheck: Block<FactCheckInput, FactCheckOutput>;
  personaPanel: Block<PersonaPanelInput, PersonaPanelOutput>;
  conceptExtract: Block<ConceptExtractInput, ConceptExtractOutput>;
  assembleHtml: Block<AssembleHtmlInput, AssembleHtmlOutput>;
};

// Block I/O — narrow shapes for the orchestrator's purposes.
// The full Zod schemas in @platform/schemas are the runtime validators
// that real blocks use; these are the structural types the orchestrator
// works against.

export type TopicProposerInput = {
  edition: "weekday" | "weekend";
  recentTopics: string[];
};
export type TopicProposerOutput = {
  contentType: string;
  topic: string;
  angle: string;
};

export type ConceptCheckInput = {
  candidates: string[];
};
export type ConceptCheckOutput = {
  passed: boolean;
  blocked: string[];
};

export type ResearchInput = {
  topic: string;
  contentType: string;
};
export type ResearchOutput = {
  keyClaims: string[];
  sources: Array<{ url: string; title: string }>;
  contrarianAngle: string;
};

export type DraftInput = {
  research: ResearchOutput;
  contentType: string;
  edition: "weekday" | "weekend";
};
export type DraftOutput = {
  headline: string;
  sections: Array<{ name: string; body: string }>;
};

export type EditorInput = {
  draft: DraftOutput;
  revisionFeedback?: string[];
};
export type EditorOutput = {
  edited: DraftOutput;
  flags: Array<{ severity: "info" | "warn" | "block"; message: string }>;
};

export type FactCheckInput = {
  draft: DraftOutput;
  sources: Array<{ url: string; title: string }>;
};
export type FactCheckOutput = {
  passed: boolean;
  issues: string[];
};

export type PersonaPanelInput = {
  draft: DraftOutput;
};
export type PersonaPanelOutput = {
  passed: boolean;
  loveRate: number;
  shareRate: number;
  churnRisk: number;
  recommendations: string[];
};

export type ConceptExtractInput = {
  episode: DraftOutput;
};
export type ConceptExtractOutput = {
  contentConcepts: string[];
  frameworkConcepts: string[];
};

export type AssembleHtmlInput = {
  episode: DraftOutput;
  brandName: string;
  edition: "weekday" | "weekend";
};
export type AssembleHtmlOutput = {
  html: string;
  text: string;
  subject: string;
};
