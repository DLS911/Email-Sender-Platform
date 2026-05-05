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
  surfaceForm: string | null;
  usedAt: string;
  lookbackUntil: string | null;
  hardBlocked: boolean;
};

export type ConceptCheckResult = {
  blocked: string[];
  near: Array<{ candidate: string; matched: ContentConcept; similarity: number }>;
};
