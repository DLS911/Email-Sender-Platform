/**
 * Sample brand voice composition — what each block composes for each
 * brand × edition. This is the shape of `brand_voice_configs.config`
 * in the database (per spec 02 § Voice configuration), with the
 * Castor Abbott v1 module list per spec 03 § Brand Voice Config.
 *
 * Once Supabase is wired, this file is replaced by a query against
 * the active brand_voice_configs row. The shape stays the same.
 */

export type BlockComposition = {
  block: string;
  modules: string[];
};

export type EditionComposition = {
  edition: "weekday" | "weekend";
  blocks: BlockComposition[];
};

export type BrandComposition = {
  brandId: string;
  brandName: string;
  version: number;
  editions: EditionComposition[];
};

const SHARED_WEEKDAY = [
  "core/voice-rules",
  "core/llm-output-discipline",
  "core/editorial-quality",
  "brands/castor-abbott/shared/mark-persona",
  "brands/castor-abbott/shared/author-credibility",
  "brands/castor-abbott/shared/audience",
];

const VOICE_WEEKDAY = [
  "brands/castor-abbott/weekday/voice-tone",
  "brands/castor-abbott/weekday/trust-stacking",
  "brands/castor-abbott/weekday/physician-model",
  "brands/castor-abbott/weekday/gap-framework",
  "brands/castor-abbott/weekday/three-torments",
  "brands/castor-abbott/weekday/offers-vs-proposals",
  "brands/castor-abbott/weekday/contrarian-positions",
  "brands/castor-abbott/weekday/language-guide",
  "brands/castor-abbott/weekday/synthesis",
];

const SHARED_WEEKEND = [
  "core/voice-rules",
  "core/llm-output-discipline",
  "core/editorial-quality",
  "brands/castor-abbott/shared/mark-persona",
  "brands/castor-abbott/shared/audience",
];

const VOICE_WEEKEND = [
  "brands/castor-abbott/weekend/voice-tone",
  "brands/castor-abbott/weekend/personal-context",
  "brands/castor-abbott/weekend/real-life-anchors",
  "brands/castor-abbott/weekend/unexpected-variable",
  "brands/castor-abbott/weekend/insight-layer",
  "brands/castor-abbott/weekend/guardrails",
  "brands/castor-abbott/weekend/what-this-voice-isnt",
];

export const castorAbbottComposition: BrandComposition = {
  brandId: "castor_abbott",
  brandName: "Castor Abbott",
  version: 1,
  editions: [
    {
      edition: "weekday",
      blocks: [
        {
          block: "topic_proposer",
          modules: [...SHARED_WEEKDAY, ...VOICE_WEEKDAY],
        },
        {
          block: "weekday_research",
          modules: [...SHARED_WEEKDAY, ...VOICE_WEEKDAY.slice(0, 4)],
        },
        {
          block: "tactic_writer",
          modules: [
            ...SHARED_WEEKDAY,
            ...VOICE_WEEKDAY,
            "brands/castor-abbott/weekday/content-type-tactic",
          ],
        },
        {
          block: "take_writer",
          modules: [
            ...SHARED_WEEKDAY,
            ...VOICE_WEEKDAY,
            "brands/castor-abbott/weekday/content-type-take",
          ],
        },
        {
          block: "story_writer",
          modules: [
            ...SHARED_WEEKDAY,
            ...VOICE_WEEKDAY,
            "brands/castor-abbott/weekday/content-type-story",
          ],
        },
        {
          block: "rant_writer",
          modules: [
            ...SHARED_WEEKDAY,
            ...VOICE_WEEKDAY,
            "brands/castor-abbott/weekday/content-type-rant",
          ],
        },
        {
          block: "ancient_truth_writer",
          modules: [
            ...SHARED_WEEKDAY,
            ...VOICE_WEEKDAY,
            "brands/castor-abbott/weekday/content-type-ancient-truth",
          ],
        },
        {
          block: "editor_pass",
          modules: [...SHARED_WEEKDAY, ...VOICE_WEEKDAY],
        },
        {
          block: "persona_evaluate",
          modules: [
            "core/voice-rules",
            "brands/castor-abbott/shared/audience",
            "brands/castor-abbott/personas/persona-1-solo-operator",
          ],
        },
      ],
    },
    {
      edition: "weekend",
      blocks: [
        {
          block: "destination_proposer",
          modules: [...SHARED_WEEKEND, ...VOICE_WEEKEND],
        },
        {
          block: "weekend_research",
          modules: [...SHARED_WEEKEND, ...VOICE_WEEKEND.slice(0, 4)],
        },
        {
          block: "weekend_writer",
          modules: [
            ...SHARED_WEEKEND,
            ...VOICE_WEEKEND,
            "brands/castor-abbott/weekend/car-spectrum",
            "brands/castor-abbott/weekend/content-type-2-luxury-insider",
          ],
        },
        {
          block: "fact_check",
          modules: ["core/voice-rules", "core/llm-output-discipline"],
        },
        {
          block: "editor_pass",
          modules: [...SHARED_WEEKEND, ...VOICE_WEEKEND],
        },
      ],
    },
  ],
};

export const allCompositions: BrandComposition[] = [castorAbbottComposition];
