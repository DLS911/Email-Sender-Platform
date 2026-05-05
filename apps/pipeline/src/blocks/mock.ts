/**
 * Mock block implementations. Every block returns canned data shaped
 * to match its contract. Used by the orchestrator integration test
 * and as a placeholder until real blocks land in stage 3.
 *
 * Each mock is deterministic — same input produces same output — so
 * tests against the orchestrator are reliable.
 */
import { renderWeekday, renderWeekend } from "@platform/email-templates";
import type {
  AssembleHtmlInput,
  AssembleHtmlOutput,
  Block,
  BlockBundle,
  ConceptCheckInput,
  ConceptCheckOutput,
  ConceptExtractInput,
  ConceptExtractOutput,
  DraftInput,
  DraftOutput,
  EditorInput,
  EditorOutput,
  FactCheckInput,
  FactCheckOutput,
  PersonaPanelInput,
  PersonaPanelOutput,
  ResearchInput,
  ResearchOutput,
  TopicProposerInput,
  TopicProposerOutput,
} from "./types.js";

const mockTopicProposer: Block<TopicProposerInput, TopicProposerOutput> = async (input) => ({
  contentType: input.edition === "weekday" ? "tactic" : "type_2_luxury_insider",
  topic: input.edition === "weekday" ? "pre-meeting research ritual" : "Tuscan working estate",
  angle:
    input.edition === "weekday"
      ? "the prep matters more than the meeting"
      : "skip the famous estate; book the working olive farm",
});

const mockConceptCheck: Block<ConceptCheckInput, ConceptCheckOutput> = async (input) => ({
  passed: true,
  blocked: input.candidates.filter((c) => c.toLowerCase().includes("blocked")),
});

const mockResearch: Block<ResearchInput, ResearchOutput> = async (input) => ({
  keyClaims: [
    `${input.topic}: contrarian thesis here`,
    "supporting evidence claim",
    "counter-argument addressed",
  ],
  sources: [
    { url: "https://example.com/source-1", title: "Reference source" },
    { url: "https://example.com/source-2", title: "Counterpoint" },
  ],
  contrarianAngle: `the conventional take on ${input.topic} misses the upstream factor`,
});

const mockDraft: Block<DraftInput, DraftOutput> = async (input) => {
  if (input.edition === "weekday") {
    return {
      headline: "The pre-meeting ritual that makes discovery calls land",
      sections: [
        {
          name: "First Pull",
          body: "Most advisors prep the wrong way for first meetings.\n\nThe fix is upstream of the meeting itself.",
        },
        {
          name: "Tactic",
          body: "Fifteen minutes of focused research on their LinkedIn, their company, and one question you genuinely want answered.\n\nWalk in to listen, not perform.",
        },
      ],
    };
  }
  return {
    headline: "Skip the famous Tuscan estate. Book the working olive farm.",
    sections: [
      {
        name: "Cover Story",
        body: "Everybody books Castello Banfi.\n\nThirty minutes south, a working olive farm rents a four-bedroom farmhouse to people who actually cook.",
      },
      {
        name: "Tasting Menu",
        body: "- Pienza Friday market: half the price of Saturday Montepulciano\n- Olive press week: book in November to eat with the family",
      },
      {
        name: "The Drive",
        body: "Used Alfa Stelvio.\n\nThese roads punish 18-inch wheels.",
      },
    ],
  };
};

const mockEditor: Block<EditorInput, EditorOutput> = async (input) => ({
  edited: input.draft,
  flags: [],
});

const mockFactCheck: Block<FactCheckInput, FactCheckOutput> = async (_input) => ({
  passed: true,
  issues: [],
});

const mockPersonaPanel: Block<PersonaPanelInput, PersonaPanelOutput> = async (_input) => ({
  passed: true,
  loveRate: 78,
  shareRate: 42,
  churnRisk: 12,
  recommendations: [],
});

const mockConceptExtract: Block<ConceptExtractInput, ConceptExtractOutput> = async (input) => ({
  contentConcepts: input.episode.sections.map((s) => `${s.name}: ${s.body.slice(0, 40)}…`),
  frameworkConcepts: ["opening_pattern", "section_structure"],
});

const mockAssembleHtml: Block<AssembleHtmlInput, AssembleHtmlOutput> = async (input) => {
  const unsubscribeUrl = `https://mail.example.com/u/${input.context.runId}`;
  if (input.edition === "weekday") {
    const rendered = renderWeekday({
      brandName: input.brandName,
      brandSlug: input.brandName.toLowerCase().replace(/\s+/g, "-"),
      episodeId: input.context.runId,
      headline: input.episode.headline,
      preheader: input.episode.headline.slice(0, 110),
      contentType: "tactic",
      sections: input.episode.sections.map((s) => ({ name: s.name, body: s.body })),
      unsubscribeUrl,
    });
    return { html: rendered.html, text: rendered.text, subject: rendered.subject };
  }
  const rendered = renderWeekend({
    brandName: input.brandName,
    brandSlug: input.brandName.toLowerCase().replace(/\s+/g, "-"),
    episodeId: input.context.runId,
    headline: input.episode.headline,
    preheader: input.episode.headline.slice(0, 110),
    contentType: "type_2_luxury_insider",
    sections: [
      { kind: "cover_story", openingHook: input.episode.sections[0]?.body ?? "", body: "" },
    ],
    unsubscribeUrl,
  });
  return { html: rendered.html, text: rendered.text, subject: rendered.subject };
};

export const mockBlocks: BlockBundle = {
  topicProposer: mockTopicProposer,
  conceptCheck: mockConceptCheck,
  research: mockResearch,
  draft: mockDraft,
  editor: mockEditor,
  factCheck: mockFactCheck,
  personaPanel: mockPersonaPanel,
  conceptExtract: mockConceptExtract,
  assembleHtml: mockAssembleHtml,
};
