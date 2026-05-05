import type { BrandId } from "./mock-inbox";

export type BrandStats = {
  brandId: BrandId;
  brandName: string;
  audienceSize: number;
  sendsLast30: number;
  openRate: number; // percentage 0-100
  clickRate: number;
  replyRate: number;
  unsubRate: number;
  bounceRate: number;
};

export type RecentSend = {
  episodeId: string;
  brandId: BrandId;
  brandName: string;
  subjectLine: string;
  sentAt: string;
  recipients: number;
  opens: number;
  clicks: number;
  replies: number;
};

export const brandStats: BrandStats[] = [
  {
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    audienceSize: 4_820,
    sendsLast30: 24,
    openRate: 47.2,
    clickRate: 8.6,
    replyRate: 1.4,
    unsubRate: 0.32,
    bounceRate: 0.18,
  },
  {
    brandId: "cortex",
    brandName: "Cortex",
    audienceSize: 1_240,
    sendsLast30: 8,
    openRate: 51.4,
    clickRate: 11.2,
    replyRate: 2.1,
    unsubRate: 0.41,
    bounceRate: 0.22,
  },
  {
    brandId: "fidelon",
    brandName: "Fidelon",
    audienceSize: 2_180,
    sendsLast30: 12,
    openRate: 38.6,
    clickRate: 6.4,
    replyRate: 0.9,
    unsubRate: 0.55,
    bounceRate: 0.31,
  },
  {
    brandId: "treasure_financial",
    brandName: "Treasure Financial",
    audienceSize: 18_400,
    sendsLast30: 12,
    openRate: 32.1,
    clickRate: 5.2,
    replyRate: 0.4,
    unsubRate: 0.78,
    bounceRate: 0.42,
  },
];

export const recentSends: RecentSend[] = [
  {
    episodeId: "ep-001",
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    subjectLine: "The pre-meeting ritual that turns prospects into clients",
    sentAt: "2026-05-04T09:00:00Z",
    recipients: 4_812,
    opens: 2_286,
    clicks: 411,
    replies: 68,
  },
  {
    episodeId: "ep-002",
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    subjectLine: "Why most niche selection advice is wrong",
    sentAt: "2026-05-03T09:00:00Z",
    recipients: 4_809,
    opens: 2_140,
    clicks: 488,
    replies: 71,
  },
  {
    episodeId: "ep-006",
    brandId: "treasure_financial",
    brandName: "Treasure Financial",
    subjectLine: "Three account moves to make this month before the rate cut",
    sentAt: "2026-05-03T09:00:00Z",
    recipients: 18_392,
    opens: 5_934,
    clicks: 956,
    replies: 51,
  },
  {
    episodeId: "ep-005",
    brandId: "fidelon",
    brandName: "Fidelon",
    subjectLine: "Q2 advisor transparency scores: who moved, who didn't",
    sentAt: "2026-05-02T09:00:00Z",
    recipients: 2_171,
    opens: 836,
    clicks: 138,
    replies: 19,
  },
  {
    episodeId: "ep-003",
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    subjectLine: "Skip the famous Tuscan estate. Here's where the operators stay.",
    sentAt: "2026-05-02T13:00:00Z",
    recipients: 4_801,
    opens: 2_434,
    clicks: 392,
    replies: 56,
  },
  {
    episodeId: "ep-004",
    brandId: "cortex",
    brandName: "Cortex",
    subjectLine: "How agentic content systems actually scale",
    sentAt: "2026-05-01T09:00:00Z",
    recipients: 1_236,
    opens: 644,
    clicks: 142,
    replies: 27,
  },
];
