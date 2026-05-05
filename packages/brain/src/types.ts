export type FrameworkFamily =
  | "opening_pattern"
  | "closing_pattern"
  | "section_structure"
  | "voice_mechanism";

export type FrameworkConcept = {
  id: string;
  brandId: string;
  frameworkName: string;
  frameworkFamily: FrameworkFamily;
  description: string;
  status: "active" | "experimental" | "deprecated";
  performanceScore: number | null;
  useCount: number;
  lastUsedAt: string | null;
};

export type ContentConcept = {
  id: string;
  brandId: string;
  episodeId: string | null;
  sectionName: string;
  conceptSummary: string;
  conceptEmbedding?: number[] | undefined;
  surfaceForm: string | null;
  usedAt: string;
  lookbackUntil: string | null;
  hardBlocked: boolean;
};

export type ConceptCheckInput = {
  brandId: string;
  sectionName: string;
  candidates: Array<{ slug: string; summary: string; embedding?: number[] }>;
  similarityThreshold?: number;
};

export type ConceptCheckMatch = {
  candidate: string;
  matchedConcept: ContentConcept;
  similarity: number;
};

export type ConceptCheckResult = {
  blocked: string[];
  near: ConceptCheckMatch[];
  passed: boolean;
};
