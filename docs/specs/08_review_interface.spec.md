---
spec: 08_review_interface
title: Review & Approval Interface
version: 1.0
status: draft
audience: dev_team, agentic_orchestrator, frontend_engineers
dependencies:
  - 00_overview
  - 01_foundation
  - 02_data_model
  - 04_content_pipeline
  - 05_brain_and_learning
  - 06_distribution_platform
  - 07_experiment_framework
consumed_by:
  - 09_optimization_policies
  - 10_observability
  - 11_deployment
purpose: Define the Next.js admin UI on Vercel — the human-facing surface of the platform. Review queue, edit-before-send capability, performance dashboard, experiment management, learning approval queue, model configuration, voice module browser. The single application humans use to operate the platform.
---

# Review & Approval Interface

## What This Spec Covers

The Next.js admin UI deployed on Vercel. The single human-facing application for the entire platform. Every operator interaction with the system happens here — reviewing drafts, approving sends, editing content, managing subscribers, configuring brands, monitoring performance, approving learnings, configuring models, browsing voice modules.

This is not just a "review queue." It's the operations control panel for the platform. When Mark or a brand admin wants to do anything, they come here.

This spec does not cover authentication implementation details (Supabase Auth handles it), specific React component libraries (deferred to dev team), or specific styling decisions. It covers the information architecture, the workflows, the data contracts with the rest of the platform, and the interaction patterns that matter.

## Why This Matters

A platform where humans approve sends needs an excellent review experience. If reviewing a draft is friction, humans either rubber-stamp (defeating the purpose of review) or delay (causing missed sends). The review interface is the workflow that determines whether the platform succeeds operationally, regardless of how good the editorial pipeline is.

The interface also serves as the surface where the closed feedback loop becomes legible to humans. Performance data, learnings, persona calibration, framework promotions — these need to be visible and actionable, not buried in database queries. A learning system that humans can't observe is a learning system humans can't trust.

Three principles shape every UI decision:

**Show, don't make them hunt.** The information operators need is on the page they're already on. Reviewing a draft? Performance data from similar past sends is right there. Approving a learning? The evidence is one click deep, not three. No forced navigation through nested menus to find the context.

**Edit-in-place, save without ceremony.** Reviewing a draft and want to fix a sentence? Click the sentence, edit, tab out, saved. No "edit mode" toggle, no save button, no confirmation dialog. The system tracks every revision automatically; the human just types.

**The agent is the user, the human is the supervisor.** The UI is built for humans, but it surfaces what agents are doing in real time. Pipeline running? Visible. Experiment in progress? Visible. Learning queued for approval? Visible. The human's role is supervision, not operation.

## Tech Stack

**Framework:** Next.js 14+ on Vercel. App Router, not Pages Router.

**Styling:** Tailwind CSS. Component library at the dev team's discretion (shadcn/ui is a strong default; alternatives acceptable).

**State management:** TanStack Query for server state, plus light local state via React hooks. No Redux, no MobX, no Zustand unless a specific feature demands it. Server state is the source of truth; local UI state is minimal.

**Auth:** Supabase Auth. Magic link by default. SSO acceptable for future Cortex commercial customers.

**Data layer:** Direct Supabase client calls from server components and route handlers. RLS policies (per `02_data_model`) enforce access control. The UI cannot bypass them.

**Realtime:** Supabase Realtime subscriptions for live updates on the review queue, in-flight pipeline runs, and incoming events. The dashboard updates without page refresh.

**Forms:** React Hook Form + Zod resolver. Schemas from `@platform/schemas` are reused (no duplication of validation logic between frontend and backend).

**Hosting:** Vercel. Each brand's admin UI is the same deployment with brand context determined by URL path or session selection.

## Information Architecture

The UI has six top-level sections. Each section is a route in the App Router.

```
/                                    Dashboard (cross-brand for platform admins; current brand for others)
/inbox                               Review queue + learning queue + experiment proposals
/episodes                            Browse all episodes (sent, scheduled, draft, failed)
  /episodes/[id]                     Single episode view with edit, history, performance
/subscribers                         Subscriber management
  /subscribers/segments              Segment management
/performance                         Performance analytics
  /performance/sends                 Per-send metrics
  /performance/frameworks            Framework performance over time
  /performance/personas              Persona calibration metrics
/experiments                         Experiment management
  /experiments/[id]                  Single experiment view
/admin                               Brand and platform configuration
  /admin/brand                       Per-brand settings (voice config, learning mode, sending domain)
  /admin/models                      Model role configuration
  /admin/voice-modules               Voice module browser (read-only; edits via PR)
  /admin/policies                    Optimization policies
  /admin/users                       User and role management
```

Brand context is set via URL prefix (`/[brand]/inbox`, `/[brand]/episodes`, etc.) or via a brand-switcher in the top nav. Platform admins see all brands; brand-scoped users see only their assigned brands.

## Section: Inbox

The single most important page in the UI. The unified queue of things requiring human attention.

### What's in the Inbox

Three categories of items:

**Drafts pending review.** Episodes that completed the pipeline and are awaiting approval before send. Sorted by scheduled send time (most urgent first). Default landing tab.

**Learnings pending approval.** Structured learnings produced by the learning analyzer that require human approval per the brand's learning mode. Sorted by confidence and urgency.

**Experiment proposals.** Experiments proposed by humans or agents that require approval before running. Sorted by proposed start time.

Each category has a count badge in the tab strip. The default view shows drafts (most operationally critical).

### Inbox List View

For each item: title, status, key metadata, primary action button.

For drafts:
- Episode headline (or destination/topic for early drafts)
- Brand
- Scheduled send time (with countdown if within 24 hours)
- Quality score with pass/fail indicator
- Author info (which model, which voice config version, total cost)
- Quality flag count if any
- Primary action: "Review →"

For learnings:
- Learning statement (one sentence)
- Brand
- Confidence
- Learning type (framework promotion, persona calibration, framework deprecation, etc.)
- Risk classification (low / medium / high)
- Primary action: "Review →"

For experiment proposals:
- Hypothesis statement
- Brand
- Proposed start time
- Class (framework / content)
- Sample size and measurement window
- Primary action: "Review →"

Each item is a row, clickable, expands to detail page on click.

### Real-time Updates

The inbox is a Supabase Realtime subscription. New drafts, new learnings, new proposals appear without refresh. A small "1 new" indicator shows above the list when something arrives during the user's session.

## Episode Review (The Core Workflow)

The most carefully designed page in the UI. This is where humans decide whether sends ship.

### Layout

A two-column layout on desktop, stacked on mobile:

**Left column — Episode preview.** What the subscriber will see. Full rendered HTML of the email, exactly as it'll arrive in the inbox. Subject line at top. From/reply-to displayed. Visual fidelity is critical; this is the actual email content, not a "preview" approximation.

**Right column — Metadata, actions, edit history.** Quality score, persona panel results, performance projections (based on similar past sends), edit history, action buttons.

### Edit-in-Place

Every text element in the left column is clickable. Click → it becomes an editable textarea inline. Tab out → saved as a revision. The change is logged in `episode_revisions` per the data model in `02_data_model`.

No "edit mode" toggle. No save button. No confirmation. Just type. The right column shows a small "edited 4 minutes ago" indicator with the editor's name. Edit history is one click deep.

The technical implementation: the rendered HTML is interactive. Section content (which is structured JSONB in the database) is rendered as React components that are editable. On edit, the updated content writes back to the JSONB, regenerates the rendered HTML, and inserts a `episode_revisions` row with the full snapshot.

### Edit History

A sidebar on the right column shows the revision timeline:

- v1 — agent_initial — generated 2 hours ago
- v2 — agent_polish — 1h 58m ago (after editor block)
- v3 — agent_revision — 1h 30m ago (after quality gate revision cycle)
- v4 — human_edit by Mark — 12 minutes ago — "Tightened the opening"
- v5 — human_edit by Mark — 8 minutes ago — "Fixed the example"

Click any version → see the diff against the previous version, side-by-side. Click "Restore this version" → that version becomes the current.

The diff visualization shows additions in green, deletions in red, with section context preserved. Standard git-diff aesthetic, applied to prose.

### Quality Score Panel

The right column shows the score aggregator output:

- Overall pass/fail with the determining metrics
- Love rate, share rate, churn risk vs. benchmarks
- Per-persona breakdown (collapsed by default; click to expand)
- Common flags categorized as PATTERN / CONSIDER / IGNORE
- Trifecta breakdown for weekday content (which option was selected and why)

The persona panel detail expands to show each of the 10 personas: their love score, their key flags, their raw response if needed. This is the "show, don't make them hunt" principle — the operator can drill into any persona's view without leaving the page.

### Performance Projection

For brands in `observe_only` mode and above, a "Performance Projection" panel shows expected metrics based on similar past sends:

- "Sends with similar framework + persona target had average open rate 38%, click rate 8.2%, reply rate 1.1%"
- The 5 most similar past sends (linkable for comparison)
- Confidence interval

This is computed from the brain's `getFrameworkPerformance` queries (per `05_brain_and_learning`). It gives the human reviewer context for whether this draft's quality scores match historical performance for this kind of content.

### Action Buttons

Four primary actions, prominently placed:

**Approve & schedule.** Approves the draft. Episode status changes to `scheduled`. If a scheduled time was set during pipeline execution, that's used; otherwise, a date picker appears. Send executes when the time arrives.

**Approve & send now.** Approves and schedules immediately for the next send window (within 5 minutes typically).

**Save changes & re-review.** For when edits are substantial enough that the operator wants the quality gate to re-run before approval. Triggers a re-evaluation pass without restarting the full pipeline.

**Reject & regenerate.** Cancels this episode. Optionally provides feedback ("the framing is off — try a different angle"). The pipeline re-runs with the feedback in context. Most useful when the topic is right but the execution missed.

**Reject & skip.** Cancels this episode entirely without regenerating. The brand sends nothing today (or this week for weekend). Recorded in audit log as a deliberate skip.

A secondary "More actions" menu has:
- Send to a specific segment (override the default segment)
- A/B test this against an alternative (creates an experiment)
- Save as draft for later editing
- Duplicate to another brand (for cross-brand content sharing where appropriate)
- View pipeline run details (full block-by-block execution log)

### Notification Triggers

The platform notifies the brand admin when a draft enters the inbox:

- Email notification (configurable per user)
- Slack DM (if Slack integration configured)
- In-app notification badge

Notification timing is configurable per brand: immediately, 4 hours before scheduled send, 24 hours before, only on quality failures. Default: 24 hours before scheduled send for normal sends, immediately for quality failures.

### SLA and Auto-Escalation

If a draft sits in `pending_review` longer than the configured SLA (default 12 hours before scheduled send), the platform escalates:

- Second notification with higher priority
- Optional auto-approval if quality score is above a high threshold (configurable per brand; default off — humans should approve every send unless explicitly opted in)
- Auto-skip with admin notification if SLA elapses without approval (no review = no send is the safer default than auto-approval)

Configurable per brand and per send-type. Different brands have different operational rhythms.

## Learning Approval Queue

For brands in `human_approved` and `semi_autonomous` modes (high-risk learnings), the inbox shows learnings awaiting approval.

### Per-Learning Review Page

Each learning gets its own detail page:

- Statement: human-readable observation
- Evidence: what data supports this
- Confidence: 0-100% with the underlying calculation expandable
- Risk classification: low / medium / high
- Proposed action: what will happen if approved
- Affected entities: which frameworks, personas, voice modules, etc.

A view-the-data panel shows the underlying observations: which past sends produced the signal, performance data summary, similar past learnings if applicable.

### Approval Actions

Three actions:

**Approve.** The learning's proposed action is applied. Audit log records the approval.

**Reject.** The learning is dismissed. The cooling-off period (default 14 days, configurable per brand) prevents re-proposal of similar learnings during that window.

**Modify and approve.** For learnings where the proposed action is mostly right but needs adjustment (e.g., promote the framework but at a slightly lower confidence threshold). The operator edits the action and applies the modified version.

### Bulk Actions

For learnings in batches (e.g., 8 framework promotions arriving together after a measurement period), a multi-select pattern allows:

- Approve all selected
- Reject all selected
- Filter by type and approve/reject by category

Bulk operations are useful but always have a "review before applying" confirmation step. No accidental mass approvals.

## Experiment Management

Experiments are first-class objects in the UI.

### Experiments List

`/experiments` shows all experiments for the current brand:

- Tabs: Running, Concluded, Proposed, Cancelled
- For each: name, hypothesis, type, class, status, dates, winner if concluded
- Click row → experiment detail

### Experiment Detail

Per experiment:

- Hypothesis and expected outcome
- Variants list with definitions
- Allocation and audience details
- Live results if running (per-variant metrics with statistical analysis)
- Final results if concluded (winner, confidence, full statistical breakdown)
- Linked sends (the actual sends that executed as part of this experiment)
- Raw results data (downloadable as CSV)

Running experiments show real-time updates as events stream in. The chart auto-refreshes; the operator can watch the test resolve.

### Experiment Creation

A guided form for creating new experiments:

1. Pick experiment type (with explanations of each)
2. Define hypothesis
3. Select variants (manual or LLM-generated; if LLM, preview the generated variants before launch)
4. Set allocation, sample size, measurement window, confidence threshold
5. Review and submit

Default values are pre-filled per experiment type to avoid forcing the operator to configure everything from scratch.

### Experiment Approval

If the brand's policy requires approval (per `09_optimization_policies`), proposed experiments queue in the inbox. The detail page shows the full experiment definition; approval/rejection is a single click.

## Performance Dashboard

`/performance` is the analytics surface. Multiple sub-pages.

### Per-Send Metrics

`/performance/sends` lists all sent emails for the brand:

- Date, episode title, segment, recipients
- Open rate, click rate, click-to-open rate, reply rate, unsubscribe rate, complaint rate, bounce rate
- Section-level click attribution (which sections drove engagement)
- Compare-to-baseline indicator (this send vs brand average)
- Trends over time chart

Filterable by date range, content type, framework family, persona target.

### Framework Performance

`/performance/frameworks` shows the framework library and its observed performance:

- All active frameworks for the brand
- Use count, last used, performance score, engagement metrics
- Trend over time (is this framework rising or declining in performance?)
- Status (experimental / active / deprecated)
- Lineage (when promoted from experimental, when last used, how many times)

Click a framework → detail page with full usage history (every episode that used it, with that episode's performance).

### Persona Calibration

`/performance/personas` shows how well the persona panel predictions match real engagement:

- Per-persona prediction accuracy (Pearson correlation over rolling 90 days)
- Bias indicators (does this persona over- or under-predict)
- Recommendations for persona refinement (when correlation is low)

This is where the persona-as-living-system from `05_brain_and_learning` becomes visible. Personas with poor calibration get flagged for definition refinement.

### Cross-Brand Patterns

`/performance/cross-brand` (platform admin only) shows the cross-brand pattern library:

- Patterns identified across multiple brands
- Aggregated performance signal
- Source brand counts (anonymized)
- Recommendations for which brands could benefit

This view is gated to platform admins because it's the only view that necessarily involves cross-brand data.

## Subscriber Management

`/subscribers` is straightforward CRUD plus segment management.

### Subscriber List

- Search by email
- Filter by status, signup date, custom fields, engagement score
- Bulk actions: tag with custom field, add to segment, suppress, export

### Per-Subscriber Detail

- Full profile: status, signup date, source, custom fields, engagement score
- Send history: every send they received, their engagement on each
- Reply history: every reply they sent, the classification
- Suppression status across all brands
- GDPR actions: export their data, delete their data

### Segment Management

`/subscribers/segments`:

- List segments (static and dynamic)
- For dynamic: edit the filter definition with a visual query builder
- For static: manage membership directly
- See current member count in real time
- Test segment by previewing recipients

## Brand and Platform Configuration

`/admin/*` routes for configuration. Most operators will rarely touch these; brand admins occasionally; platform admins frequently.

### Brand Settings

`/admin/brand`:

- Brand identity (name, logo, sending domain, from address, reply-to)
- Voice configuration (which voice config version is active; older versions selectable for replay)
- Learning mode (the five modes from `05_brain_and_learning`; switching mode is logged)
- Optimization policies (deferred to `09`)
- Compliance configuration (physical address, GDPR handling, double opt-in toggle)
- Notification preferences for the brand admin

### Model Configuration

`/admin/models`:

- All defined model roles (10 from `01_foundation` + any custom)
- For each role: current primary, current fallback, temperature, reasoning enabled/disabled
- Per-brand overrides (Castor Abbott uses Opus for the Latte; Treasure Financial uses Sonnet)
- "Test this configuration" feature: runs a sample block with the configured role and shows output without affecting production state

This is the page that makes models hot-swappable. Mark or his developer can change a role's model and apply the change to production within seconds. The audit log records every change.

### Voice Module Browser

`/admin/voice-modules`:

- Read-only browser of all voice modules in the system
- Tree view by category (core, brand, persona)
- Per-module: full content, version history, status, last update
- Search and filter

Editing happens via PR against the repo, not in the UI. The page links to the corresponding GitHub file path. This keeps voice changes within the version-controlled workflow.

### Policy Configuration

`/admin/policies`:

- View and edit optimization policies for the brand
- Per-policy: scope, definition, version, status
- Audit log of policy changes
- "Simulate impact" feature: see how a policy change would have affected past decisions

Detailed policy structure is defined in `09_optimization_policies`.

### User Management

`/admin/users`:

- List of platform users
- Per user: role, brand memberships, last login
- Add/edit/remove users
- Configure auth methods (magic link, SSO if applicable)

## Dashboard

The default landing page (`/`).

### Platform Admins

Platform admins see a cross-brand overview:

- Sends today / sends this week per brand
- Quality scores trending (per brand, over time)
- Active experiments across all brands
- Pending learnings across all brands
- Subscriber growth per brand
- Cost summary (LLM costs by brand, total)
- Active alerts (deliverability issues, failed runs, quality regressions)

The platform admin's job is to monitor everything; the dashboard is built for that.

### Brand Admins

Brand admins see only their brand:

- Today's send status (pending review, scheduled, sent)
- Recent send performance (last 7 sends)
- Active experiments for this brand
- Pending learnings for this brand
- Subscriber summary
- Recent alerts

### Reviewers

Reviewers (read/edit access but not configuration) see a focused view:

- Pending review count (with link to inbox)
- Recently approved sends
- Performance summary for sends they've approved

## Mobile Considerations

The full admin UI is responsive but not mobile-first. Most operators will use desktop for serious work. Mobile views support:

- Inbox and approval workflow (most common mobile use case: approve a draft from your phone)
- Quick stats viewing
- Notification-driven actions

Configuration, voice module browsing, performance analytics — all desktop-primary.

## Realtime and Optimistic UI

Several places in the UI use Supabase Realtime subscriptions:

- Inbox list (new items appear without refresh)
- Episode review page (showing pipeline runs in progress, draft state changing)
- Performance dashboard (live metrics as events stream in)
- Experiment detail page (real-time per-variant metrics during running tests)

Optimistic UI updates: when an operator edits a section, the change appears immediately while the database write happens in the background. If the write fails, the change rolls back with a clear error. This makes the UI feel fast and intentional.

## Accessibility

Standard accessibility practice:

- WCAG 2.1 AA compliance as a target
- Keyboard navigation for all interactions
- Screen reader support for the inbox, review page, and dashboard
- Color contrast appropriate for long-reading sessions
- Focus management for modal interactions

## Performance

The UI must feel fast even with thousands of subscribers and hundreds of episodes:

- Server components for data-heavy pages (subscriber lists, episode browser)
- Client components only where interactivity demands it
- Pagination on all list views (default page size 50, configurable)
- Indexes per `02_data_model` make every query sub-100ms
- TanStack Query caching with sensible invalidation

## Open Decisions for the Dev Team

- **Specific component library:** shadcn/ui is the default recommendation. Material UI, Radix Themes, Mantine are acceptable.
- **Specific chart library:** Recharts for simple charts; visx if more sophistication is needed. Whichever, just pick one — don't mix.
- **Markdown vs. rich text editor for inline editing:** Markdown is simpler; rich text matches what subscribers will see. Recommend a lightweight rich text editor with markdown-as-source. Tiptap or Lexical are both reasonable.
- **Specific notification implementation:** Email via Resend (we already use it). Slack via webhooks. SMS deferred (not in v1 unless explicitly required).
- **Specific approach to brand context:** URL prefix `/[brand]/inbox` is the recommended pattern. Session-based brand selection is acceptable but creates ambiguity.
- **Whether to support custom dashboards:** Not in v1. The default dashboards are opinionated and sufficient.
- **Whether to expose raw block execution logs in the UI:** Yes, but behind a "developer view" toggle. Brand admins don't usually need the raw logs; platform admins occasionally do.

## Acceptance Criteria

The review interface is complete when:

- [ ] Next.js app exists in `apps/review-ui` with App Router and Supabase Auth integration.
- [ ] All 6 top-level sections are routable and at least skeleton-rendered.
- [ ] Inbox correctly aggregates drafts pending review, learnings pending approval, and experiment proposals.
- [ ] Inbox real-time updates work via Supabase Realtime.
- [ ] Episode review page renders the full email preview with visual fidelity to the actual send.
- [ ] Edit-in-place works on any text section; edits write to `episode_revisions` with full snapshots.
- [ ] Edit history sidebar shows all revisions with side-by-side diffs.
- [ ] Quality score panel displays love rate, share rate, churn risk, per-persona breakdown, flags categorized by priority.
- [ ] Performance projection panel shows expected metrics based on brain queries.
- [ ] All four primary action buttons work end-to-end (approve+schedule, approve+send now, save+re-review, reject+regenerate).
- [ ] Notification system delivers via configured channels (email, Slack) at configured triggers.
- [ ] SLA escalation works: drafts past SLA produce escalated notifications.
- [ ] Learning approval queue displays learnings with evidence panel; approval/rejection writes to `audit_log` and applies the proposed action.
- [ ] Cooling-off period prevents rejected learnings from re-proposing within configured window.
- [ ] Experiment detail page shows live results during running experiments via real-time subscriptions.
- [ ] Experiment creation form validates inputs against the experiment schemas.
- [ ] Performance dashboard sub-pages render with correct data and filtering.
- [ ] Persona calibration page shows correlation metrics and refinement recommendations.
- [ ] Subscriber management has full CRUD plus segment management.
- [ ] Brand settings page allows changing voice config version, learning mode, sending domain, compliance config.
- [ ] Model configuration page allows updating model roles with immediate effect (next pipeline run uses the new config).
- [ ] Voice module browser displays all modules with version history and links to GitHub.
- [ ] User management supports adding/editing/removing users with role assignment.
- [ ] RLS policies prevent unauthorized access (verified by automated tests with multiple user roles).
- [ ] Mobile responsive: inbox and approval workflow function on mobile devices.
- [ ] WCAG 2.1 AA accessibility audit passes.
- [ ] Page load time under 2 seconds for all data-heavy views.

---

**Next:** Read `09_optimization_policies.spec.md` for the agentic governance layer — what experiments and adjustments agents can make autonomously, what requires human approval, and the policy structure that makes the platform safe to operate.
