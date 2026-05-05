---
spec: 09_optimization_policies
title: Agentic Governance & Optimization Policies
version: 1.0
status: draft
audience: dev_team, agentic_orchestrator, brand_admins
dependencies:
  - 00_overview
  - 01_foundation
  - 02_data_model
  - 04_content_pipeline
  - 05_brain_and_learning
  - 07_experiment_framework
  - 08_review_interface
consumed_by:
  - 10_observability
  - 11_deployment
purpose: Define the policy framework that controls what agents can do autonomously, what requires human approval, and what is prohibited entirely. Hierarchical policies (platform, brand, experiment-class). The audit and escalation paths. The architectural answer to "is this AI system safe to run autonomously?"
---

# Agentic Governance & Optimization Policies

## What This Spec Covers

The governance layer that makes the platform safe to operate. What agents — the learning analyzer, the experiment runner, the orchestrator's autonomous decisions — are permitted to do without asking a human. What they must escalate. What they're prohibited from doing entirely.

This is the architectural answer to a question every operator will ask: "Can I trust this system to run while I'm asleep?" The answer is "yes, within the policies you define." This spec is how policies get defined, enforced, audited, and revised.

The spec covers the policy data model, the policy evaluation engine, the hierarchical structure (platform / brand / experiment-class), the standard policies that ship with v1, and the escalation paths when agents encounter situations outside their policy bounds.

This spec does not cover specific UI for managing policies (that's `08_review_interface`) or the underlying learning loop modes (those are in `05_brain_and_learning`, this spec assumes them as substrate).

## Why This Matters

The closed feedback loop is powerful and dangerous in equal measure. Powerful because the system can adapt without human intervention; dangerous because the same property means it can adapt in ways the operator didn't intend. Without explicit governance, autonomous learning systems collapse into one of two failure modes: either humans overcorrect with constant manual review (defeating the autonomy benefits) or humans undercorrect with implicit trust (eventually getting burned by a bad autonomous decision).

The right architecture isn't "more autonomous" or "less autonomous." It's "explicit about what's autonomous." Every consequential decision in the system has a defined policy: who can make it, under what conditions, with what oversight. Mark approves the policy framework once; agents operate within it; humans intervene when policies don't cover a novel situation.

This is the same pattern that lets human organizations operate at scale. A junior employee can spend up to $X without approval. A manager can hire up to Y people without approval. The CEO has authority over Z. The policies are the trust architecture; without them, every decision needs the founder's eyeballs and nothing scales.

## The Policy Concept

A policy is a structured rule that determines what's allowed for a given action class.

Each policy has:

- **A scope** — platform-wide, brand-specific, or experiment-class-specific.
- **An action class** — what kind of action this policy governs (framework promotion, voice module changes, experiment proposals, etc.).
- **A decision rule** — the conditions under which the action is permitted.
- **An approval requirement** — who, if anyone, must approve before the action takes effect.
- **A confidence threshold** — the minimum confidence level required for autonomous action.
- **A scope of effect** — what the action can change.
- **Versioning** — policies are versioned; changes are audited.

Policies are not code. They're data, stored in the `optimization_policies` table (per `02_data_model`). They can be created, edited, and revoked without code changes. The policy evaluation engine (a small piece of code in `@platform/policies`) reads them and applies them.

## Hierarchical Structure

Policies stack in a defined precedence order. When an agent considers an action, the policy engine evaluates policies in order:

1. **Action-class policies** (most specific) — "For experiment proposals of class `subject_line_pattern`..."
2. **Brand policies** (medium specificity) — "For Castor Abbott..."
3. **Platform policies** (most general) — "For all brands..."

The first matching policy determines the outcome. More specific policies override less specific ones. If no policy matches, the default is "require human approval" — the system refuses to act autonomously without explicit policy permission.

This default is critical. The architecture is opt-in to autonomy, not opt-out. New action types are not autonomously available until a policy permits them.

## Standard Policies for v1

The platform ships with a set of standard policies for the four founding brands. These are seed policies; brand admins can edit them through the admin UI.

### Platform-Level Policies

These apply across all brands unless a brand-specific override exists.

**Policy: `platform.experiment.subject_line_content`**
- Scope: platform
- Action class: `experiment.create.subject_line`
- Decision: auto-approve if proposed_by `human` OR (proposed_by `agent` AND confidence >= 0.75 AND test_audience_pct <= 10)
- Approver: none (autonomous)
- Effect scope: subject line content for one specific send
- Rationale: subject line content tests are low-risk and high-value. Auto-approve to reduce friction.

**Policy: `platform.experiment.subject_line_pattern`**
- Scope: platform
- Action class: `experiment.create.subject_line_pattern`
- Decision: auto-approve if proposed_by `human` OR (proposed_by `agent` AND confidence >= 0.85 AND brand_learning_mode IN [`semi_autonomous`, `fully_autonomous`])
- Approver: brand_admin if confidence below threshold
- Effect scope: subject line patterns; framework promotion possible
- Rationale: framework experiments are higher-risk; require higher confidence for autonomous action.

**Policy: `platform.framework.promote_experimental`**
- Scope: platform
- Action class: `framework.promote.experimental_to_active`
- Decision: auto-approve if use_count >= 5 AND performance_score >= brand_median AND confidence >= 0.85
- Approver: brand_admin if criteria not met
- Effect scope: single framework_concept status change
- Rationale: promoting experimental frameworks is reversible and well-bounded. Auto-approve when criteria are met.

**Policy: `platform.framework.deprecate_active`**
- Scope: platform
- Action class: `framework.deprecate.active_to_deprecated`
- Decision: human approval required (regardless of confidence)
- Approver: brand_admin
- Effect scope: framework status change; affects all future generations using it
- Rationale: deprecating an active framework is consequential; humans should review every time.

**Policy: `platform.voice_module.create`**
- Scope: platform
- Action class: `voice_module.create`
- Decision: prohibited (cannot happen via agent action; only via PR)
- Approver: none — must go through git PR workflow
- Effect scope: new voice module file in repo
- Rationale: voice is sacred. Voice module creation never happens through autonomous agents.

**Policy: `platform.voice_module.modify`**
- Scope: platform
- Action class: `voice_module.modify`
- Decision: prohibited via agent (must go through PR)
- Approver: none — git workflow only
- Effect scope: existing voice module
- Rationale: same as above.

**Policy: `platform.voice_config.modify`**
- Scope: platform
- Action class: `voice_config.modify`
- Decision: human approval required
- Approver: brand_admin
- Effect scope: which modules are active for a brand
- Rationale: voice configs determine what "the brand sounds like" for the foreseeable future. Always reviewed.

**Policy: `platform.persona.create`**
- Scope: platform
- Action class: `persona.create`
- Decision: human approval required
- Approver: brand_admin
- Effect scope: new persona module + brand voice config inclusion
- Rationale: introducing a new persona is a deliberate editorial decision.

**Policy: `platform.persona.deprecate`**
- Scope: platform
- Action class: `persona.deprecate`
- Decision: human approval required
- Approver: brand_admin
- Effect scope: persona removed from active panel
- Rationale: same as above.

**Policy: `platform.persona.weight_adjust`**
- Scope: platform
- Action class: `persona.weight_adjust`
- Decision: auto-approve if calibration_correlation_change <= 0.15 (small adjustments) AND brand_learning_mode IN [`semi_autonomous`, `fully_autonomous`]
- Approver: brand_admin if change is larger or in wrong mode
- Effect scope: persona weight in score aggregation
- Rationale: small calibration adjustments are routine and low-risk. Larger ones warrant review.

**Policy: `platform.exploration_budget.adjust`**
- Scope: platform
- Action class: `policy.adjust.exploration_budget`
- Decision: human approval required
- Approver: brand_admin
- Effect scope: exploration percentages for variety enforcement
- Rationale: variety budgets are policy decisions; not for the agent to set.

**Policy: `platform.lookback_window.adjust`**
- Scope: platform
- Action class: `policy.adjust.lookback_window`
- Decision: human approval required
- Approver: brand_admin
- Effect scope: how long content concepts lock out
- Rationale: lookback windows are editorial decisions about audience saturation.

**Policy: `platform.send.cancel`**
- Scope: platform
- Action class: `send.cancel`
- Decision: auto-approve if triggered by `quality_gate_critical_failure` OR `deliverability_threshold_breach`; human approval otherwise
- Approver: brand_admin
- Effect scope: a single scheduled send
- Rationale: critical failures should auto-pause; routine cancellation should be deliberate.

**Policy: `platform.subscriber.bulk_action`**
- Scope: platform
- Action class: `subscriber.bulk_modify`
- Decision: human approval required for any bulk operation affecting > 100 subscribers
- Approver: brand_admin
- Effect scope: subscriber list
- Rationale: bulk subscriber operations are infrequent and high-impact.

### Brand-Level Policy Overrides

Brand admins can override platform policies for their specific brand. Examples:

**Policy: `castor_abbott.experiment.subject_line_pattern`**
- Inherits from: `platform.experiment.subject_line_pattern`
- Override: confidence threshold reduced to 0.80 (Castor Abbott has more sample size for faster confidence)

**Policy: `fidelon.framework.promote_experimental`**
- Inherits from: `platform.framework.promote_experimental`
- Override: human approval required regardless of criteria (Fidelon's regulatory posture demands extra caution)

**Policy: `treasure_financial.experiment.send_time`**
- Scope: treasure_financial
- Action class: `experiment.create.send_time`
- Decision: human approval required
- Approver: brand_admin
- Rationale: B2C audience send-time experiments need explicit approval per stakeholder preferences.

The override pattern: a brand-specific policy with the same action class as a platform policy takes precedence. Brand admins create overrides through the admin UI; the resulting `optimization_policies` row has the brand's `brand_id` set.

## Policy Decision Rules

Policies use a structured decision rule format. The rule is a JSON object that the policy engine evaluates.

### Rule Schema

```typescript
type PolicyRule = {
  decision: "auto_approve" | "require_approval" | "prohibit";
  conditions?: PolicyCondition[];          // All must be true for the decision
  approver_role?: "platform_admin" | "brand_admin" | "reviewer";
  fallback_decision?: "require_approval" | "prohibit";  // Used if conditions not met
};

type PolicyCondition =
  | { type: "confidence_gte"; value: number }
  | { type: "confidence_lte"; value: number }
  | { type: "proposed_by"; value: "human" | "agent" }
  | { type: "brand_learning_mode_in"; value: LearningMode[] }
  | { type: "use_count_gte"; value: number }
  | { type: "performance_score_gte"; value: "brand_median" | number }
  | { type: "test_audience_pct_lte"; value: number }
  | { type: "calibration_correlation_change_lte"; value: number }
  | { type: "trigger_in"; value: string[] };
```

This is a small, expressive condition language. Adding new condition types is a code change; combining existing ones into new policies is configuration.

### Example Rule Evaluations

**Auto-approve a subject line content experiment proposed by an agent with high confidence:**

```typescript
{
  decision: "auto_approve",
  conditions: [
    { type: "proposed_by", value: "agent" },
    { type: "confidence_gte", value: 0.75 },
    { type: "test_audience_pct_lte", value: 10 },
  ],
  fallback_decision: "require_approval",
  approver_role: "brand_admin",
}
```

If all three conditions are true → auto-approve. Otherwise → require approval from brand_admin.

**Require human approval for any framework deprecation:**

```typescript
{
  decision: "require_approval",
  approver_role: "brand_admin",
}
```

No conditions; always requires approval.

**Prohibit voice module modification by agents:**

```typescript
{
  decision: "prohibit",
}
```

No conditions; always prohibited.

## The Policy Evaluation Engine

A small package: `@platform/policies`. Its job is to answer one question per call: "Given this proposed action, what's the decision?"

```typescript
import { evaluatePolicy } from "@platform/policies";

const result = await evaluatePolicy({
  brandId: "castor_abbott",
  actionClass: "framework.promote.experimental_to_active",
  context: {
    confidence: 0.92,
    use_count: 7,
    performance_score: 71.2,
    brand_median_score: 64.8,
    proposed_by: "agent",
    brand_learning_mode: "semi_autonomous",
  },
});

// Result:
// {
//   decision: "auto_approve",
//   matched_policy: "platform.framework.promote_experimental",
//   approver_role: null,
//   reasons: ["use_count >= 5", "performance_score >= brand_median", "confidence >= 0.85"],
// }
```

The engine:

1. Loads relevant policies (action-class specific → brand-specific → platform).
2. Evaluates conditions against the context.
3. Returns the first matching decision.
4. Logs the evaluation for audit (every policy evaluation goes to `audit_log` with full context).

The engine is pure code. No LLM call. Policy decisions must be deterministic and replayable.

## Approval Queue Mechanics

When a policy returns `require_approval`, the action goes into the approval queue (visible in the admin UI inbox per `08_review_interface`).

### Approval Item Structure

```typescript
type ApprovalItem = {
  id: string;
  brand_id: string;
  action_class: string;
  proposed_by: "human" | "agent";
  proposed_at: timestamp;
  required_approver_role: "platform_admin" | "brand_admin" | "reviewer";
  proposed_action: object;       // The action to be taken if approved
  context: object;               // The context used for policy evaluation
  matched_policy_id: string;
  policy_evaluation_reasons: string[];
  status: "pending" | "approved" | "rejected" | "expired";
  resolved_at: timestamp | null;
  resolved_by: user_id | null;
  resolution_notes: string | null;
  expires_at: timestamp | null;
};
```

Approval items have an expiration. If unaddressed past `expires_at`, the item moves to `expired` status. The default expiration depends on the action class:

- Experiment proposals: 24 hours (then auto-rejected; agent can re-propose)
- Framework promotions: 7 days (then auto-rejected; can be re-evaluated later)
- Voice config changes: no expiration (these wait until reviewed)

### Approval Actions

When an approver reviews an item, they have three actions:

**Approve.** The proposed action executes. Audit log records the approval and the resulting action.

**Reject.** The action does not execute. The cooling-off period (per `05_brain_and_learning`) prevents re-proposal during the window.

**Modify and approve.** For learning-style approvals where the proposed action needs adjustment. The approver edits the proposed action; the modified version executes; the audit log records both the original proposal and the modification.

### Bulk Approval

For batches of similar items (e.g., 8 framework promotions arriving simultaneously after a measurement cycle), the UI supports multi-select:

- Approve all selected (with confirmation)
- Reject all selected (with confirmation)
- Filter by type and apply

Bulk actions write individual audit log entries — not a single bulk entry. Forensically, every individual decision is preserved.

## Escalation Paths

When agents encounter situations not covered by existing policies, they escalate rather than guess.

### Escalation Triggers

- An action class has no matching policy at any scope (default: require approval)
- The context produces an ambiguous policy result (no condition fully evaluates)
- An action is prohibited but the agent considers it necessary (rare; the agent flags rather than overrides)
- An external system error makes policy evaluation impossible

### Escalation Response

The agent does not act. Instead:

1. Writes an `audit_log` entry with `actor_type = "agent"`, `action = "escalation"`.
2. Creates an approval queue item with `proposed_action: null` and notes describing the escalation.
3. Notifies the brand_admin (or platform_admin if brand-level escalation can't resolve).
4. The pipeline that requested the action either pauses (if the escalation is blocking) or proceeds without that action (if the escalation is non-blocking).

The principle: when in doubt, agents do not act. They surface the doubt for human resolution.

## Policy Versioning

Policies are versioned. Every change to a policy creates a new version with the previous version preserved.

```sql
-- optimization_policies columns
{
  id: uuid,
  brand_id: text,           -- Null = platform
  scope: text,              -- "platform", "brand", "experiment_class"
  policy_name: text,
  policy_definition: jsonb, -- Full PolicyRule
  status: text,             -- "active", "superseded", "revoked"
  version: int,             -- Increments on changes
  created_by: uuid,
  approved_by: uuid,
  approved_at: timestamp,
  created_at: timestamp,
}
```

When a policy changes:

1. The current version's `status` becomes `superseded`.
2. A new row is created with `version = previous + 1` and `status = active`.
3. The change is logged in `audit_log` with `action = "policy_change"`.
4. The change takes effect for future evaluations only. In-flight approval items continue under the policy version they were evaluated against.

This versioning is critical for replay and audit. "Why did the system auto-approve framework X promotion last month?" is answerable: the policy version active at that time is preserved; you can read its definition.

## Policy Simulation

Before applying a policy change, brand admins can simulate the impact:

"If I had set the experiment confidence threshold to 0.90 instead of 0.85, how many of the last 30 days' decisions would have changed?"

The simulation runs the proposed policy against historical decisions in `audit_log`, produces a count of decisions that would have differed, and shows the differences inline. This reduces the risk of unintended consequences from policy tuning.

Implementation: a `simulatePolicy` function in `@platform/policies` that takes a proposed policy and a historical window, replays decisions, and returns the diff.

## Audit Trail

Every policy-related action writes to `audit_log`:

| Event | Logged |
|-------|--------|
| Policy evaluation | Yes — every call to `evaluatePolicy` |
| Policy change (create, modify, revoke) | Yes |
| Approval item created | Yes |
| Approval item resolved | Yes — with approver, decision, notes |
| Approval item expired | Yes |
| Escalation | Yes |
| Policy simulation | Yes (informational; no system effect) |

The audit log is append-only. Forensic reconstruction of any decision is possible: load the policy version active at the time, load the context that was evaluated, re-evaluate, compare to the recorded outcome.

## Per-Brand Phase 1 Defaults

Each brand ships with a starting policy configuration. These are seed values; brand admins refine over time.

### Castor Abbott

Phase 1 default: relatively open policies given the brand's maturity and Mark's familiarity.

- Subject line content experiments: auto-approve (agent or human, confidence >= 0.75)
- Subject line pattern experiments: auto-approve in semi_autonomous mode at confidence >= 0.85
- Framework experimental → active promotion: auto-approve at criteria
- Framework deprecation: human approval required
- Voice config changes: human approval required
- Persona weight adjustments: auto-approve for small changes in semi_autonomous mode

### Cortex

Phase 1 default: similar to Castor Abbott (audiences overlap; Mark operates both).

- Same as Castor Abbott initially
- Adjustable as Cortex's audience profile diverges from Castor Abbott's

### Fidelon

Phase 1 default: tighter policies for the regulated brand.

- All experiments: human approval required regardless of class
- Framework experimental → active promotion: human approval required
- Framework deprecation: human approval required
- Voice config changes: human approval required
- Persona weight adjustments: human approval required

Fidelon may stay in this conservative posture indefinitely. The architecture supports it.

### Treasure Financial

Phase 1 default: medium-conservative for the consumer brand.

- Subject line content experiments: auto-approve at high confidence (>= 0.85)
- Subject line pattern experiments: human approval required
- Framework experimental → active promotion: human approval for first 60 days; transition to auto at criteria thereafter
- Other actions: human approval required

The initial conservatism is to give Mark and the team time to observe how the platform behaves on B2C audiences before granting more autonomy.

## Open Decisions for the Dev Team

- **Specific policy condition language extension:** start with the listed condition types; add more as needed. Don't pre-build conditions that no policy uses.
- **Whether to support time-bounded policies** (e.g., "in semi_autonomous mode for 30 days, then re-evaluate"): not in v1. Manual review at intervals is fine.
- **Whether to support compound conditions** (`AND`/`OR` nesting beyond flat list): not in v1. The flat-list-with-implicit-AND is sufficient for documented policies.
- **Whether to expose policies as code in a Git repo** (similar to voice modules): tempting but adds complexity. v1 keeps policies as database rows with the admin UI as the editor.
- **How to handle conflicting policies at the same scope:** treat as an error in policy creation. Validation prevents two active policies for the same action class at the same scope from existing simultaneously.
- **Specific policy simulation backend:** straightforward TypeScript replay against `audit_log`. Implementation deferred to dev team.

## Acceptance Criteria

The optimization policies system is complete when:

- [ ] `optimization_policies` table exists with all columns and constraints.
- [ ] `@platform/policies` package implements `evaluatePolicy` with the documented decision rule schema.
- [ ] All 13 standard platform-level policies from this spec are seeded into the database for production environment.
- [ ] Per-brand Phase 1 default policies are seeded for Castor Abbott, Cortex, Fidelon, Treasure Financial.
- [ ] Policy precedence works: action-class > brand > platform.
- [ ] The default-to-require-approval behavior works when no policy matches an action class.
- [ ] Policy versioning works: changes create new versions; old versions are preserved.
- [ ] In-flight approvals continue under the policy version they were evaluated against, not the current version.
- [ ] Approval queue items are created for every `require_approval` decision and surface in the admin UI inbox.
- [ ] Approval expiration works: items past `expires_at` move to `expired` status and notify the proposer.
- [ ] Bulk approval writes individual audit log entries per item.
- [ ] Escalation paths work: actions without policy coverage produce escalation entries instead of acting.
- [ ] `simulatePolicy` is implemented and returns the diff of decisions that would have changed.
- [ ] Every policy evaluation, policy change, approval, rejection, expiration, and escalation writes to `audit_log`.
- [ ] An integration test verifies precedence: a brand-specific policy correctly overrides a platform policy for that brand.
- [ ] An integration test verifies the prohibition path: actions in the prohibited class never execute regardless of context.
- [ ] An integration test verifies the auto-approve path: actions meeting all conditions execute without queuing for approval.
- [ ] An integration test verifies that a policy change does not affect in-flight approvals.

---

**Next:** Read `10_observability.spec.md` for structured logging, dashboards, alerting, and the operational visibility that makes the autonomous system debuggable.
