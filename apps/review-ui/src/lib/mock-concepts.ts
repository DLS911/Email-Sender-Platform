/**
 * Mock brain concept data. Models what the brain layer surfaces from
 * framework_concepts and content_concepts per spec 05.
 *
 * The architectural separation is the point: framework concepts are
 * reusable (performance-tracked, high-performers eligible for reuse);
 * content concepts are locked out per their lookback window.
 */

export type FrameworkConcept = {
  id: string;
  brandId: string;
  frameworkName: string;
  frameworkFamily: "opening_pattern" | "closing_pattern" | "section_structure" | "voice_mechanism";
  description: string;
  status: "active" | "experimental" | "deprecated";
  performanceScore: number | null;
  useCount: number;
  lastUsedAt: string | null;
};

export type ContentConcept = {
  id: string;
  brandId: string;
  sectionName: string;
  conceptSummary: string;
  surfaceForm: string | null;
  usedAt: string;
  lookbackUntil: string | null;
  hardBlocked: boolean;
};

export const mockFrameworkConcepts: FrameworkConcept[] = [
  {
    id: "fw-001",
    brandId: "castor_abbott",
    frameworkName: "say_do_gap_with_knife_twist",
    frameworkFamily: "opening_pattern",
    description:
      "Open with a contrarian stat exposing the say/do gap, then twist the knife in the third sentence with a specific cost.",
    status: "active",
    performanceScore: 82.4,
    useCount: 14,
    lastUsedAt: "2026-04-29T09:00:00Z",
  },
  {
    id: "fw-002",
    brandId: "castor_abbott",
    frameworkName: "physics_payload_close",
    frameworkFamily: "closing_pattern",
    description:
      "End with a one-line mic drop that lands as conviction, not hedge. Names the stakes explicitly.",
    status: "active",
    performanceScore: 78.1,
    useCount: 21,
    lastUsedAt: "2026-05-02T09:00:00Z",
  },
  {
    id: "fw-003",
    brandId: "castor_abbott",
    frameworkName: "luxury_insider_flow",
    frameworkFamily: "section_structure",
    description:
      "Famous option → better alternative → 3-4 specific advantages → booking intelligence → when it's worth it.",
    status: "active",
    performanceScore: 86.2,
    useCount: 8,
    lastUsedAt: "2026-04-26T13:00:00Z",
  },
  {
    id: "fw-004",
    brandId: "castor_abbott",
    frameworkName: "kitty_litter_test",
    frameworkFamily: "voice_mechanism",
    description: "At least one irreverent dig per piece. Earns trust by refusing to perform.",
    status: "active",
    performanceScore: 71.9,
    useCount: 32,
    lastUsedAt: "2026-05-04T09:00:00Z",
  },
  {
    id: "fw-005",
    brandId: "castor_abbott",
    frameworkName: "five_paragraph_diagnosis",
    frameworkFamily: "section_structure",
    description: "Unused experimental — diagnosis-first weekday structure for tactical pieces.",
    status: "experimental",
    performanceScore: null,
    useCount: 1,
    lastUsedAt: "2026-04-15T09:00:00Z",
  },
  {
    id: "fw-006",
    brandId: "castor_abbott",
    frameworkName: "old_referral_script_template",
    frameworkFamily: "section_structure",
    description:
      "Deprecated — early scripted-referral template that violates contrarian positions.",
    status: "deprecated",
    performanceScore: 41.2,
    useCount: 3,
    lastUsedAt: "2026-02-10T09:00:00Z",
  },
];

const dayOffset = (days: number) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString();
};

export const mockContentConcepts: ContentConcept[] = [
  {
    id: "c-001",
    brandId: "castor_abbott",
    sectionName: "tactic",
    conceptSummary: "15-minute pre-meeting client research ritual",
    surfaceForm: "The pre-meeting ritual",
    usedAt: dayOffset(-6),
    lookbackUntil: dayOffset(24),
    hardBlocked: false,
  },
  {
    id: "c-002",
    brandId: "castor_abbott",
    sectionName: "take",
    conceptSummary: "demographic niches have hit saturation",
    surfaceForm: "Why niche selection advice is wrong",
    usedAt: dayOffset(-3),
    lookbackUntil: dayOffset(27),
    hardBlocked: false,
  },
  {
    id: "c-003",
    brandId: "castor_abbott",
    sectionName: "tasting_menu_item",
    conceptSummary: "Lodge cast iron — permanent block (Mark hates it)",
    surfaceForm: "Lodge cast iron",
    usedAt: "2025-09-01T13:00:00Z",
    lookbackUntil: null,
    hardBlocked: true,
  },
  {
    id: "c-004",
    brandId: "castor_abbott",
    sectionName: "tasting_menu_item",
    conceptSummary: "Le Creuset Dutch oven — permanent block (saturated coverage)",
    surfaceForm: "Le Creuset Dutch oven",
    usedAt: "2025-08-15T13:00:00Z",
    lookbackUntil: null,
    hardBlocked: true,
  },
  {
    id: "c-005",
    brandId: "castor_abbott",
    sectionName: "cover_story",
    conceptSummary: "Tuscan working olive farm rental over Castello Banfi",
    surfaceForm: "Tuscan working estate",
    usedAt: dayOffset(-1),
    lookbackUntil: dayOffset(269),
    hardBlocked: false,
  },
  {
    id: "c-006",
    brandId: "castor_abbott",
    sectionName: "the_drive",
    conceptSummary: "Cadillac CT5-V Blackwing as overlooked sports sedan",
    surfaceForm: "CT5-V Blackwing",
    usedAt: dayOffset(-21),
    lookbackUntil: dayOffset(159),
    hardBlocked: false,
  },
  {
    id: "c-007",
    brandId: "castor_abbott",
    sectionName: "tactic",
    conceptSummary: "Handling the 'I need to think about it' client objection",
    surfaceForm: "Think about it response",
    usedAt: dayOffset(-15),
    lookbackUntil: dayOffset(15),
    hardBlocked: false,
  },
];
