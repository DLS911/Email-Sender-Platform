/**
 * Mock inbox data for development. Replaced by real Supabase queries
 * once the DB is provisioned and authenticated UI lands per spec 08.
 */

export type InboxRow = {
  id: string;
  brandId: "castor_abbott" | "cortex" | "fidelon" | "treasure_financial";
  brandName: string;
  edition: "weekday" | "weekend";
  scheduledSendAt: string;
  contentType: string;
  headline: string;
  status: "pending_review" | "approved" | "scheduled";
  qualityScore: { love: number; share: number; churn: number; passed: boolean };
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
];
