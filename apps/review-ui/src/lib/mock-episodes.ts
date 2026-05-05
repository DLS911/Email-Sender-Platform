import { mockInbox } from "./mock-inbox";

export type MockSection = {
  name: string;
  body: string;
  wordCount?: number;
};

export type MockPersonaScore = {
  persona: string;
  segment: "highest_engagement" | "moderate_engagement" | "at_risk";
  love: number;
  share: number;
  unsub: number;
};

export type MockEpisode = {
  id: string;
  brandId: string;
  brandName: string;
  edition: "weekday" | "weekend";
  contentType: string;
  scheduledSendAt: string;
  status: string;
  headline: string;
  alternateHeadlines: string[];
  voiceConfigVersion: number;
  sections: MockSection[];
  qualityScore: { love: number; share: number; churn: number; passed: boolean };
  personaScores: MockPersonaScore[];
  flags: Array<{ severity: "info" | "warn" | "block"; message: string; section?: string }>;
};

const sharedQuality = (love: number, share: number, churn: number) => ({
  love,
  share,
  churn,
  passed: churn < 25,
});

export const mockEpisodes: Record<string, MockEpisode> = {
  "ep-001": {
    id: "ep-001",
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    edition: "weekday",
    contentType: "tactic",
    scheduledSendAt: "2026-05-06T09:00:00Z",
    status: "pending_review",
    headline: "The pre-meeting ritual that turns prospects into clients in one sitting",
    alternateHeadlines: [
      "Before the meeting matters more than the meeting",
      "The 15 minutes that separate a discovery call from a close",
    ],
    voiceConfigVersion: 1,
    sections: [
      {
        name: "First Pull",
        body: "Most advisors prep for first meetings by rehearsing what they're going to say. Wrong frame. The prep that matters happens before they sit down — and it's not about you.",
      },
      {
        name: "Worth Knowing",
        body: "Three contrarian moves the top performers actually do before a discovery call. Each one increases the odds of a 'yes' by more than any post-meeting follow-up tactic.",
      },
      {
        name: "Tactic",
        body: "The 15-minute pre-meeting research ritual: 5 minutes on their LinkedIn looking for non-financial signal. 5 minutes on their company filings or website looking for what's actually changed in the last 90 days. 5 minutes drafting the one question that you genuinely want them to answer — not the one you think they'll find impressive.\n\nWhen you walk in, you're prepared to listen, not to perform. That's the whole game.",
      },
      {
        name: "Grounds for Thought",
        body: "If your first meeting feels like a sales pitch, you skipped the prep. If it feels like a conversation, you did the work. Trust Stacking is built before you sit down, not during.",
      },
    ],
    qualityScore: sharedQuality(78, 42, 12),
    personaScores: [
      { persona: "solo_operator", segment: "highest_engagement", love: 82, share: 51, unsub: 5 },
      { persona: "rising_star", segment: "highest_engagement", love: 80, share: 48, unsub: 6 },
      {
        persona: "wirehouse_refugee",
        segment: "moderate_engagement",
        love: 75,
        share: 38,
        unsub: 12,
      },
      {
        persona: "fee_only_purist",
        segment: "moderate_engagement",
        love: 72,
        share: 35,
        unsub: 14,
      },
      { persona: "veteran", segment: "at_risk", love: 68, share: 28, unsub: 22 },
    ],
    flags: [
      {
        severity: "info",
        message: "framework: Trust Stacking (3rd use in 30 days — within budget)",
      },
    ],
  },
  "ep-002": {
    id: "ep-002",
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    edition: "weekday",
    contentType: "take",
    scheduledSendAt: "2026-05-07T09:00:00Z",
    status: "pending_review",
    headline: "Why most niche selection advice is wrong",
    alternateHeadlines: [
      "The niche selection trap nobody warns you about",
      "Your niche is a marketing tactic, not an identity",
    ],
    voiceConfigVersion: 1,
    sections: [
      {
        name: "First Pull",
        body: "The industry has been telling advisors to 'pick a niche' for a decade. The advice itself isn't wrong. The framing is.",
      },
      {
        name: "Worth Knowing",
        body: "When a niche becomes the brand instead of the entry point, you stop being able to grow into adjacent audiences. The most successful practices treat niche as a wedge, not a wall.",
      },
      {
        name: "The Take",
        body: "Niche is a marketing tactic. Identity is who you serve when nobody's watching. Confusing the two locks you out of natural growth and forces you to stay 'on brand' even when the work changes.\n\nThe operators who win started niche, then expanded once they had reputation and operational depth. They didn't see niche as a destination.",
      },
      {
        name: "Grounds for Thought",
        body: "If you can't articulate who you'd serve next without picking another niche, the niche is running you.",
      },
    ],
    qualityScore: sharedQuality(71, 51, 18),
    personaScores: [
      { persona: "solo_operator", segment: "highest_engagement", love: 76, share: 58, unsub: 11 },
      { persona: "rising_star", segment: "highest_engagement", love: 73, share: 55, unsub: 13 },
      {
        persona: "wirehouse_refugee",
        segment: "moderate_engagement",
        love: 68,
        share: 49,
        unsub: 18,
      },
      { persona: "niche_specialist", segment: "at_risk", love: 60, share: 38, unsub: 30 },
    ],
    flags: [
      {
        severity: "warn",
        message: "niche_specialist persona unsub > 25 — review framing",
        section: "The Take",
      },
    ],
  },
  "ep-003": {
    id: "ep-003",
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    edition: "weekend",
    contentType: "type_2_luxury_insider",
    scheduledSendAt: "2026-05-09T13:00:00Z",
    status: "pending_review",
    headline: "Skip the famous Tuscan estate. Here's where the actual operators stay.",
    alternateHeadlines: [
      "The Tuscan property nobody books that's better than the one everybody does",
      "What chefs and winemakers do when they go to Tuscany",
    ],
    voiceConfigVersion: 1,
    sections: [
      {
        name: "Cover Story",
        body: "Everybody books Castello Banfi. The pictures are great. The wine is fine. The experience is for tour buses with Wi-Fi.\n\nThirty minutes south, a working olive operation rents a 4-bedroom farmhouse to people who actually cook. Not curated. Not Instagram-staged. Just real.",
      },
      {
        name: "Tasting Menu",
        body: "Three things the locals know:\n- The market in Pienza on Friday morning is half the price of the Saturday market in Montepulciano.\n- The one good restaurant in Montalcino is closed Mondays. Plan around it.\n- The estate's oil press runs in November. If you book that week, you eat dinner with the family.",
      },
      {
        name: "The Drive",
        body: "Don't rent the SUV. The roads here punish 18-inch wheels. A used Alfa Stelvio from a local agency is half the price and twice as fun.",
      },
    ],
    qualityScore: sharedQuality(84, 38, 9),
    personaScores: [
      { persona: "solo_operator", segment: "highest_engagement", love: 88, share: 42, unsub: 3 },
      { persona: "veteran", segment: "highest_engagement", love: 86, share: 35, unsub: 5 },
      {
        persona: "wirehouse_refugee",
        segment: "moderate_engagement",
        love: 82,
        share: 38,
        unsub: 8,
      },
    ],
    flags: [],
  },
};

export function getMockEpisode(id: string): MockEpisode | null {
  return mockEpisodes[id] ?? null;
}

export function listMockEpisodeIds(): string[] {
  return mockInbox.map((row) => row.id);
}
