// Optimization policies — what agents can do autonomously vs require approval.
// Implementation lands per spec 09_optimization_policies.

export type PolicyScope = "platform" | "brand" | "experiment_class";

export type Policy = {
  id: string;
  brandId: string | null;
  scope: PolicyScope;
  policyName: string;
  policyDefinition: Record<string, unknown>;
  status: "active" | "superseded" | "revoked";
  version: number;
};
