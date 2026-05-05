---
spec: 12_migration_plan
title: Migration Plan — MindStudio to New Platform
version: 1.0
status: draft
audience: dev_team, agentic_orchestrator, mark
dependencies:
  - 00_overview
  - 01_foundation
  - 02_data_model
  - 03_voice_system
  - 04_content_pipeline
  - 05_brain_and_learning
  - 06_distribution_platform
  - 08_review_interface
  - 11_deployment
consumed_by: []
purpose: Define the phased, day-by-day plan to migrate Castor Abbott from the existing MindStudio system to the new platform without missing a send. Then sequence Fidelon, Treasure Financial, and Cortex onto the platform with each migration getting easier as the architecture matures.
---

# Migration Plan — MindStudio to New Platform

## What This Spec Covers

The cutover plan. How we go from "MindStudio runs Daily Grind every weekday morning at 5 AM" to "the new platform runs Daily Grind every weekday morning at 5 AM" without breaking anything in between. The same plan applied sequentially to Saturday Morning Latte, then Fidelon, then Treasure Financial, then Cortex.

This is the spec that turns 11 specs of architecture into actual operational continuity. The new platform is not done when the code is written. It's done when Castor Abbott's subscribers receive their newsletter every weekday from the new platform with no quality regression and no delivery interruption.

## Why This Matters

The hardest part of replacing a working system is the cutover. The old system ships 5 newsletters per week to real subscribers; the new system has to take over without missing a beat. Worse, the new system needs to demonstrably *equal or improve* output quality before subscribers notice the change.

A bad migration plan looks like: spend three months building, do a big-bang switchover, hope nothing breaks. This produces missed sends, quality regressions visible to subscribers, and operator panic when something goes wrong at 5 AM with no rollback path.

A good migration plan looks like: parallel-run the new system alongside the old, validate output quality side-by-side, gradually shift traffic, keep the old system warm for rollback, only decommission when the new system has proven itself. This is the spec for that.

Three principles shape the plan:

**Parallel-run before cutover.** The new system runs alongside MindStudio for a defined period, producing the same outputs from the same inputs. No subscribers are affected during this window; we're proving equivalence.

**Cutover one brand at a time.** Castor Abbott migrates first because it's the reference implementation. Then Fidelon (most architecturally distinct, stress-tests multi-tenancy). Then Treasure Financial. Then Cortex. Each migration informs the next and lets the architecture mature.

**Rollback is always possible.** Every cutover step has a documented rollback path. If something breaks, we go back to the previous state within minutes. The old MindStudio system stays running until we're confident in the new one — typically two weeks of clean operation.

## Migration Phases

The full migration arc spans Phases 1 through 5 of the build. Each phase has a primary goal and an explicit migration outcome.

| Phase | Duration | Goal | Migration Outcome |
|-------|----------|------|-------------------|
| Phase 1 | ~6 weeks | Foundation + Castor Abbott on new platform | Daily Grind and Saturday Latte ship from new platform |
| Phase 2 | ~3 weeks | Performance event pipeline + experiments | Castor Abbott has full closed-loop infrastructure |
| Phase 3 | ~4 weeks | Learning loop + variety enforcement + persona calibration | Castor Abbott in `semi_autonomous` mode if ready |
| Phase 4 | ~2 weeks | Fidelon migration | Fidelon ships from new platform |
| Phase 5 | ~3 weeks | Treasure Financial + Cortex + cross-brand layer | All four brands operational |

This spec details the Phase 1 migration in depth, then sketches Phases 4 and 5 (the brand additions). The Phase 2 and 3 work happens *to* Castor Abbott while it's already running on the new platform; those are feature additions, not migrations.

## Phase 1: Castor Abbott Migration

The reference migration. Detailed week by week.

### Week 1: Foundation Standup

Build the foundation per `01_foundation` and `02_data_model`. Goal: a working monorepo with the LLM client, observability, database schema, and CI/CD.

**Concrete deliverables:**

- Monorepo structure (per `01_foundation`)
- Supabase production project created with full schema applied
- Railway production project created with skeleton workers
- Vercel project created with skeleton Next.js app
- All required secrets stored in Railway, Vercel, GitHub
- CI/CD pipeline working: PR → CI → merge → deploy
- LLM client wrapper functional with model role resolution
- Observability package emitting structured logs

**Migration-specific work:**

- The MindStudio GitHub PAT is rotated. New PAT stored in Railway secrets. Old PAT remains on MindStudio (it still needs to push to the website during migration period) — until cutover.
- Read access set up to MindStudio's Google Sheet for the eventual concept import.

**Validation:** A test pipeline run executes end-to-end through the LLM client, writes a `block_executions` row, and produces a parseable JSON output. Doesn't need to be the real pipeline yet — proves the substrate works.

### Week 2: Voice Module Decomposition

Port the existing system prompts into the voice module structure per `03_voice_system`.

**Concrete deliverables:**

- `packages/voice-modules/` populated with all Castor Abbott modules per `03_voice_system`
- Each module has valid frontmatter, version 1, status active
- The `voice_module_registry` table is synced via CI job
- Castor Abbott's `brand_voice_configs` row is populated and active
- Composer (`composeVoice`) is implemented and tested

**Migration-specific work:**

- Side-by-side review: assemble the composed system prompt for the Tactic writer block; compare to the existing MindStudio writer system prompt; verify semantic equivalence.
- Same review for the weekend Cover Story writer.
- Document any deliberate divergences (places where the new architecture sharpens something MindStudio left ambiguous).

**Validation:** A small dry-run pipeline using the composed voice modules produces output of comparable quality to MindStudio output for the same input. Output goes to a temporary review interface (or even just inspected in the database) — not sent to anyone.

### Week 3: Content Pipeline Implementation

Build the pipeline blocks per `04_content_pipeline`. Both weekday and weekend.

**Concrete deliverables:**

- All 13 blocks from `04_content_pipeline` are implemented
- Weekday and weekend pipelines run end-to-end against fixture data
- Hard rules pre-pass works correctly
- Editor block, persona panel block, score aggregator, html_generator all working
- Advisory locks prevent concurrent runs of the same brand

**Migration-specific work:**

- Import existing brain state from the Google Sheet (per `02_data_model` import script)
- 270 days of content concepts loaded into `content_concepts` for Castor Abbott with appropriate `lookback_until` and `hard_blocked` flags
- Existing hard-blocked items list (Lodge cast iron, Le Creuset, Four Thousand Weeks, etc.) preserved
- Validate that the imported brain prevents duplicates: a test that proposes a recently-used concept gets rejected

**Validation:** Run the weekday pipeline against today's date with the imported brain. Output is reviewed manually by Mark and a senior reviewer. Compare to what MindStudio would have produced. Document differences. Iterate until quality matches or exceeds MindStudio output for the same date.

### Week 4: Distribution Platform + Resend

Build the distribution layer per `06_distribution_platform`. This is the week the new platform becomes capable of sending real emails.

**Concrete deliverables:**

- DistributionProvider abstraction with ResendProvider implementation
- Castor Abbott's sending domain (`mail.castorabbott.com`) verified in Resend with DKIM/SPF/DMARC
- Subscriber data layer working: import existing subscribers from ActiveCampaign
- Signup endpoints, confirmation flow, unsubscribe flow all working
- Webhook handler ingesting events
- Suppression list management working
- Compliance configuration in place (CAN-SPAM, GDPR)

**Migration-specific work:**

- **Subscriber import.** Export Castor Abbott's full subscriber list from ActiveCampaign (CSV or API). Import into `subscribers` with `brand_id = castor_abbott`, status preserved, custom fields preserved. Validate row counts match.
- **Suppression list import.** Export ActiveCampaign's suppression list. Import as global suppressions with appropriate reason codes.
- **DNS prep.** Coordinate with Mark on DNS changes. The new sending domain (`mail.castorabbott.com`) needs DKIM/SPF/DMARC records added. The website itself stays on its current setup; only the mail subdomain is new infrastructure.

**Validation:** Send a test email from the new platform to a small list (Mark, the developer, a handful of friendly subscribers who know they're test recipients). Verify deliverability, rendering, click tracking, webhook events flowing.

### Week 5: Review UI + Approval Workflow

Build the review interface per `08_review_interface`. The human-facing surface that gates real sends.

**Concrete deliverables:**

- Next.js admin UI deployed to Vercel
- Inbox showing draft pending review
- Episode review page with edit-in-place
- Quality score panel displaying all metrics
- Performance projection panel (if Phase 2 brain queries are sufficiently in place)
- Approve & schedule, send now, save & re-review, reject & regenerate actions
- Notification system delivering via email and Slack

**Migration-specific work:**

- Mark gets credentials and walks through the UI personally
- Walkthrough of every workflow he'll use: review → approve → schedule
- Edge case rehearsal: what if he wants to edit a section? What if quality fails? What if he wants to skip today's send entirely?
- Notification preferences configured per Mark's preferences

**Validation:** Mark reviews a generated draft end-to-end through the UI. Approves it. Sends to a friendly test list. Confirms the send works as expected. Documents any UI friction.

### Week 6: Parallel-Run + Cutover

The migration week. The old system and new system both run; we validate; we cut over.

**Day 1 (Monday) — Parallel-run begins.**

Both MindStudio and the new platform run the same morning. MindStudio sends to the real subscriber list (production). The new platform runs the same pipeline but does not send — it produces the draft and writes it to the new database.

By 7 AM both runs are complete. Mark reviews the new platform's output side-by-side with what MindStudio shipped. Documents:

- Quality comparison (subjective)
- Voice fidelity (does the new output sound like the old?)
- Section completeness
- Any factual errors in either output

**Day 2-5 (Tuesday-Friday) — Continued parallel-run.**

Same pattern every weekday. By Friday, we have 5 days of side-by-side comparison data. The expected outcome: new platform output is at least as good as MindStudio output, and probably better in specific dimensions (no em dashes, no Gemini reasoning leaks, more diverse openings due to the explicit framework selection logic).

If the new platform consistently produces worse output, fixing it is the priority — cutover gets delayed until quality matches.

**Day 6 (Saturday) — Weekend parallel-run.**

Same comparison for Saturday Morning Latte. The Latte is more demanding voice, so this is a tougher test.

**Day 8 (Monday) — Limited cutover.**

If the side-by-side validation showed acceptable quality, cutover begins.

The cutover is *gradual*, not big-bang:

1. Pause MindStudio's scheduled send for Monday morning. (MindStudio pipeline still runs; it just doesn't push to ActiveCampaign.)
2. New platform runs the pipeline normally. Draft lands in the review UI.
3. Mark reviews and approves.
4. New platform sends via Resend to a *subset* of subscribers (e.g., 10% — Mark and friendly subscribers who've been notified about the migration).
5. Webhook events flow in. Verified.
6. The other 90% of subscribers receive the *MindStudio* draft sent through ActiveCampaign as a fallback.

This is the "shadow send" pattern. The new platform is in control of the send flow but we have a fallback path that ships through the old infrastructure if the new flow has issues.

**Day 9 (Tuesday) — Expand the cutover.**

If Day 8 went well, expand to 50% of subscribers receiving the new platform's send. The other 50% on MindStudio fallback.

**Day 10-11 (Wednesday-Thursday) — Full cutover.**

If Day 9 went well, the new platform sends to 100% of subscribers. MindStudio is paused for daily sends but kept warm (could be re-activated within minutes if needed).

**Day 12 (Friday) — Stability.**

A full week of new-platform sends. Mark reviews each draft. Subscribers notice nothing — that's the goal.

**Day 13 (Saturday) — Weekend cutover.**

Same pattern for the Saturday Latte. By the end of week 6, both Castor Abbott pipelines are running fully on the new platform.

### Weeks 7-8: Stability and MindStudio Decommission

Two full weeks of stable operation on the new platform. No quality regressions. No missed sends. Mark builds confidence.

**Concrete deliverables:**

- Two weeks of clean operation, with daily reviews and approvals working smoothly
- Any edge cases that emerged during the cutover documented and resolved
- The MindStudio system formally deactivated:
  - Pipelines paused (still in MindStudio but not running on schedule)
  - Plaintext GitHub PAT revoked (the new platform's PAT has been in use for weeks)
  - ActiveCampaign sending paused (subscribers are now in Resend's care)
  - Google Sheet brain marked deprecated (the new platform's database is canonical)
- The website's archive HTML (the static newsletter pages on castorabbott.com) is now generated and pushed by the new platform

**Migration-specific work:**

- Backup MindStudio configuration for archival (in case we need to reference how something worked)
- Document the migration retrospective — what worked, what didn't, what would inform future brand migrations

**The "kept warm" decision.** We don't immediately delete MindStudio. We keep it deactivated but recoverable for at least 30 days post-cutover. If a critical bug emerges in the new platform we don't catch in the first two weeks, we want the option to fall back. After 30 days of stable operation, formally decommission.

## Phase 2 (Migration Continuation): Closed Loop on Castor Abbott

Phase 2 happens *to* Castor Abbott while it's running on the new platform. Not a migration in the same sense, but worth documenting how the brand's behavior evolves.

**Week 1-2 of Phase 2:**

- Performance event pipeline goes live. Webhook events flowing in produce attribution and performance observations.
- Castor Abbott's learning mode moves from `disabled` to `observe_only`. The platform begins computing performance scores but doesn't yet influence generation.
- Performance dashboard becomes populated.

**Week 3 of Phase 2:**

- First subject line A/B tests run. Mark reviews results in the experiment dashboard.
- Statistical winners declared. Mark observes the framework in action.
- Castor Abbott still in `observe_only`; no autonomous learning yet.

**End of Phase 2:** Castor Abbott has full event pipeline + experiment infrastructure. Performance data is visible. Learning analyzer is producing insights but not auto-applying them.

## Phase 3 (Migration Continuation): Learning Mode Transition

Phase 3 is when Castor Abbott becomes a learning system, not just a generation system.

**Week 1 of Phase 3:**

- Castor Abbott learning mode transitions from `observe_only` to `human_approved`.
- Pending learnings start arriving in the inbox. Mark reviews the first batch.
- Framework promotions, persona calibrations, exploration budget enforcements all queued for explicit approval.

**Week 2-3 of Phase 3:**

- Mark works through the approval queue. Approves what makes sense. Rejects what doesn't.
- The system's behavior begins shifting based on approved learnings.
- Performance trends are tracked carefully — is the system improving or regressing?

**Week 4 of Phase 3:**

- Based on observed quality and Mark's confidence, decision: stay in `human_approved` or move to `semi_autonomous`?
- If moving to `semi_autonomous`: low-risk learnings auto-apply going forward; high-risk continues to require approval.

**End of Phase 3:** Castor Abbott is in either `human_approved` or `semi_autonomous` mode. The closed feedback loop is operational. Variety enforcement is happening based on learning data. Persona calibration is ongoing.

## Phase 4: Fidelon Migration

Fidelon is the most architecturally challenging brand and migrates second deliberately.

**Why Fidelon second:** It's the most editorially distinct from Castor Abbott. It has the B2B/B2C dual-track structure. If the multi-tenancy and voice module separation work for Fidelon, they'll work for everything else. If they don't, we discover it before two more brands depend on the same architecture.

### Pre-Migration Work

**Brand voice authoring (~1 week):**

- Mark and his team author Fidelon's voice modules per the patterns established for Castor Abbott
- The Fidelon-narrative-voice skill (already documented) provides the voice DNA
- Brand-specific frameworks, contrarian positions, language guides
- Brand-specific persona panel (different audiences = different personas)
- Decision: does Fidelon ship one newsletter for both B2B and B2C audiences, or split tracks?

**Brand setup:**

- Fidelon's `brands` row, `brand_voice_configs`, `brand_memberships` configured
- Sending domain (`mail.fidelon.com`) verified in Resend
- Subscriber list imported (from wherever Fidelon currently lives)
- Starting policy configuration: `human_approved` learning mode, all experiments require approval

### Migration Week

The Fidelon migration is shorter than Castor Abbott because the platform already exists.

**Day 1-3:** Parallel-run for the existing Fidelon content workflow (whatever it currently is). Side-by-side comparison.

**Day 4-5:** Limited cutover — new platform sends to a friendly test segment.

**Day 6-7:** Full cutover.

**Week 2:** Stability period. Two weeks of clean operation before considering the migration complete.

### What Migration Phase 4 Tests

- Multi-tenancy under stress: a Fidelon edit should never affect Castor Abbott; an audit log query should not leak across brands.
- Voice module separation: Fidelon's voice modules are independent files; updating one should not affect Castor Abbott's modules.
- Per-brand model role overrides: if Fidelon needs different model configurations than Castor Abbott, that's a config change, not a code change.
- Per-brand sending domain isolation: Fidelon's deliverability is independent from Castor Abbott's.

If anything in this list breaks, the migration pauses while we fix. The discovery is the point — better to find architectural flaws under one brand of stress than under three.

## Phase 5: Treasure Financial + Cortex + Cross-Brand Layer

The final two brands plus the cross-brand pattern transfer infrastructure.

### Treasure Financial Migration (~1 week)

By now the platform has handled three brand migrations. Adding Treasure Financial is mostly a configuration exercise.

- Brand voice modules authored (B2C audience, retail investors)
- B2C-specific persona panel
- Sending domain verified
- Subscriber list imported
- Starting policy: `observe_only` learning mode (B2C teams want to observe before allowing autonomy)
- Parallel-run, cutover, stability — same pattern

### Cortex Migration (~1 week)

The fourth brand. Audience overlaps with Castor Abbott; voice is technical-but-accessible.

- Brand voice modules authored
- Persona panel (overlap with Castor Abbott but distinct)
- Sending domain verified
- Subscriber list imported
- Cortex's newsletter content meta-demonstrates the platform's capabilities
- Parallel-run, cutover, stability

### Cross-Brand Pattern Layer (~1 week)

After all four brands are running, the cross-brand pattern transfer infrastructure activates.

- Cross-brand pattern aggregation runs against the four brands' performance data
- Patterns that meet promotion criteria (min 2 source brands, statistical significance) become available
- Each brand's pipeline begins consulting cross-brand patterns as additional context

**Validation:** Cross-brand learning works without leaking brand-specific data. Verified via tests and operational review.

## Rollback Plans

Every cutover step has a documented rollback path. If anything goes wrong, we revert to a known good state within minutes.

### Rollback During Castor Abbott Cutover

**If new platform produces a bad draft:** Mark rejects in the review UI. The pipeline either re-runs (with feedback) or skips today's send (with notification). MindStudio is dormant during the cutover week so the fallback option is "no send today" rather than "MindStudio sends." If today's send is critical, manually trigger MindStudio pipeline as the fallback.

**If new platform fails to send:** Same as above — manual MindStudio trigger as fallback. The architecture supports this because MindStudio remains warm (deactivated but not deleted) for 30 days post-cutover.

**If subscribers report deliverability issues:** Pause sends. Investigate via observability. Rollback to MindStudio temporarily while fixing.

**If quality regression is widespread:** Pause cutover. Continue parallel-run for another week. Diagnose the regression. Resume cutover when quality matches MindStudio.

### Rollback During Brand Migrations (Phase 4-5)

Similar patterns:
- If Fidelon, Treasure, or Cortex have issues, the rollback is "the brand was not yet on the new platform"; revert to whatever they were doing before.
- The other brands continue on the new platform unaffected.

### Rollback After Stability Period

Once a brand has been stable for 30 days on the new platform, rollback becomes harder (MindStudio is fully decommissioned). At that point, any issues are fixed forward, not rolled back. This is the right tradeoff — the system is mature enough to fix issues in place rather than reverting.

## Validation Criteria for "Migration Complete"

A brand's migration is complete when:

- [ ] Two consecutive weeks of stable operation on the new platform
- [ ] Zero missed sends due to platform issues
- [ ] Quality scores match or exceed pre-migration baseline (subjective review by Mark)
- [ ] No subscriber complaints about deliverability or rendering
- [ ] No subscriber reports of voice/quality regression
- [ ] All brand admins have used the review UI without significant friction
- [ ] Disaster recovery drill executed successfully on the brand's data
- [ ] MindStudio (or the brand's prior system) is decommissioned, with credentials revoked and data preserved as backup

These criteria gate the formal "migration complete" sign-off. Until all criteria are met, the migration is in progress and rollback options remain available.

## Communication Plan

Migration affects subscribers, even if invisibly. Communication is part of the plan.

### Internal (Mark + Team)

Daily during cutover weeks:
- Morning email or Slack message with previous day's performance summary
- Any quality concerns flagged
- Plan for the day

Weekly during stability period:
- Performance summary
- Any notable events
- Next-week plan

### External (Subscribers)

Most subscribers should never know a migration happened. The voice should sound the same; the rendering should look the same; the deliverability should be the same.

That said, two subscriber-facing communications are appropriate:

**One-time email at end of week 8:**
"Behind-the-scenes update — we've upgraded the infrastructure that produces this newsletter. You shouldn't notice any difference, but if you do see anything off, hit reply and let me know. Thanks for reading."

This is honest and gives subscribers a feedback channel.

**Sender domain notification (if changing):**
If the From address changes (e.g., from `hello@castorabbott.com` to `hello@mail.castorabbott.com`), a brief note about the change in the previous send. Not strictly necessary but reduces "is this newsletter legit?" replies.

### For Other Brand Migrations

Same patterns adapted to each brand's voice and audience.

## Migration Retrospective

After each brand migration, document the retrospective:

- What went well
- What went poorly
- What the next migration should do differently
- Operational discoveries that should be reflected in the spec set or runbooks

The retrospectives are the mechanism by which each migration informs the next. Phase 4 (Fidelon) should be smoother than Phase 1 (Castor Abbott) because of what we learned. Phase 5 (Treasure + Cortex) should be smoother than Phase 4. By the time we're considering external customers, the migration playbook is well-rehearsed.

## Acceptance Criteria

The Castor Abbott migration (Phase 1) is complete when:

- [ ] All Phase 1 deliverables across `01_foundation` through `06_distribution_platform` are complete.
- [ ] Six weeks of build work + two weeks of stability period concluded.
- [ ] Daily Grind ships every weekday morning from the new platform.
- [ ] Saturday Morning Latte ships every Saturday morning from the new platform.
- [ ] Subscriber list, suppression list, and brain (Google Sheet contents) all imported successfully.
- [ ] MindStudio formally decommissioned with credentials revoked.
- [ ] Mark has used the review UI for at least 30 sends without significant friction.
- [ ] No quality regression reported by subscribers.
- [ ] Zero missed sends during cutover or stability period.
- [ ] Disaster recovery drill executed successfully on Castor Abbott data.
- [ ] Migration retrospective documented in `docs/decisions/` or equivalent.

The full platform migration is complete when:

- [ ] All four brands (Castor Abbott, Fidelon, Treasure Financial, Cortex) operational on the new platform.
- [ ] Each brand has met its individual migration acceptance criteria.
- [ ] Cross-brand pattern layer is operational with at least one pattern transferred between brands.
- [ ] Phase 6 (commercial extraction) is architecturally feasible — no Phase 1-5 work prevents commercial customers being added later.

---

**End of spec set.** All twelve specs (00 through 12) plus AGENTS.md form the complete architecture for the new platform. Next step: hand to the dev team and begin Phase 1.
