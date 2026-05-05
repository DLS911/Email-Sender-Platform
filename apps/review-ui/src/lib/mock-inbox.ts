/**
 * Mock inbox data for development. Replaced by real Supabase queries
 * once the DB is provisioned and authenticated UI lands per spec 08.
 */

export type BrandId = "castor_abbott" | "cortex" | "fidelon" | "treasure_financial";

export type InboxRow = {
  id: string;
  brandId: BrandId;
  brandName: string;
  edition: "weekday" | "weekend";
  scheduledSendAt: string;
  contentType: string;
  headline: string;
  status: "pending_review" | "approved" | "scheduled";
  qualityScore: { love: number; share: number; churn: number; passed: boolean };
};

export const BRANDS: Record<BrandId, { name: string; audience: string; color: string }> = {
  castor_abbott: { name: "Castor Abbott", audience: "B2B advisors", color: "#7dd3fc" },
  cortex: { name: "Cortex", audience: "B2B platform", color: "#c4b5fd" },
  fidelon: { name: "Fidelon", audience: "B2B + B2C", color: "#fbbf24" },
  treasure_financial: { name: "Treasure Financial", audience: "B2C retail", color: "#86efac" },
};

export const mockInbox: InboxRow[] = [
  {
    id: "ep-001",
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    edition: "weekday",
    scheduledSendAt: "2026-05-06T09:00:00Z",
    contentType: "tactic",
    headline: "The pre-meeting ritual that turns prospects into clients in one sitting",
    status: "pending_review",
    qualityScore: { love: 78, share: 42, churn: 12, passed: true },
  },
  {
    id: "ep-002",
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    edition: "weekday",
    scheduledSendAt: "2026-05-07T09:00:00Z",
    contentType: "take",
    headline: "Why most niche selection advice is wrong",
    status: "pending_review",
    qualityScore: { love: 71, share: 51, churn: 18, passed: true },
  },
  {
    id: "ep-003",
    brandId: "castor_abbott",
    brandName: "Castor Abbott",
    edition: "weekend",
    scheduledSendAt: "2026-05-09T13:00:00Z",
    contentType: "type_2_luxury_insider",
    headline: "Skip the famous Tuscan estate. Here's where the actual operators stay.",
    status: "pending_review",
    qualityScore: { love: 84, share: 38, churn: 9, passed: true },
  },
  {
    id: "ep-004",
    brandId: "cortex",
    brandName: "Cortex",
    edition: "weekday",
    scheduledSendAt: "2026-05-06T09:00:00Z",
    contentType: "deep_dive",
    headline: "How agentic content systems actually scale: the architecture pattern that works",
    status: "pending_review",
    qualityScore: { love: 76, share: 55, churn: 14, passed: true },
  },
  {
    id: "ep-005",
    brandId: "fidelon",
    brandName: "Fidelon",
    edition: "weekday",
    scheduledSendAt: "2026-05-06T09:00:00Z",
    contentType: "scorecard_update",
    headline: "Q2 advisor transparency scores: who moved, who didn't, and why it matters",
    status: "pending_review",
    qualityScore: { love: 69, share: 48, churn: 22, passed: true },
  },
  {
    id: "ep-006",
    brandId: "treasure_financial",
    brandName: "Treasure Financial",
    edition: "weekday",
    scheduledSendAt: "2026-05-06T09:00:00Z",
    contentType: "education",
    headline: "Three account moves to make this month before the rate cut",
    status: "pending_review",
    qualityScore: { love: 73, share: 62, churn: 11, passed: true },
  },
];
