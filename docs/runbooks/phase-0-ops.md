# Phase 0 — Operational prerequisites

Things that have to happen before code work begins. Not specifications — operational tasks for Mark and the dev team.

## Owner: Mark + dev lead

### 1. Repository

- [x] Create GitHub repo: `DLS911/Email-Sender-Platform`
- [x] Branch protection on `main`: require PR + passing CI (set after Stage 1 lands)

### 2. Supabase

- [ ] Create production project (Team plan recommended for backups + PITR)
- [ ] Note the project URL → `SUPABASE_URL`
- [ ] Note the anon key → `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Note the service role key → `SUPABASE_SERVICE_ROLE_KEY` (treat as a credential)
- [ ] Apply migrations from `infra/supabase/migrations/` via Supabase CLI

### 3. Vercel

- [ ] Connect repo
- [ ] Set Root Directory = `apps/review-ui`
- [ ] Add env vars per `infra/vercel/README.md`
- [ ] First deploy

### 4. Resend

- [ ] Add domain `mail.castorabbott.com`
- [ ] Configure DKIM, SPF, DMARC records via DNS
- [ ] Verify domain
- [ ] Generate API key → `RESEND_API_KEY`
- [ ] Configure webhook endpoint (will point to webhook-handler once deployed)
- [ ] Note the webhook signing secret → `RESEND_WEBHOOK_SIGNING_SECRET`

### 5. LLM provider keys

- [ ] Anthropic API key → `ANTHROPIC_API_KEY`
- [ ] OpenAI API key → `OPENAI_API_KEY` (used for embeddings + fallback)
- [ ] Google API key → `GOOGLE_API_KEY` (optional in v1)

### 6. ActiveCampaign export

- [ ] Export Castor Abbott subscriber list to CSV (full list, with custom fields)
- [ ] Export suppression list to CSV
- [ ] Stash both in a private location for the import script to read

### 7. GitHub secrets

- [ ] Rotate the existing MindStudio GitHub PAT — generate a new one immediately, the old one is plaintext in MindStudio
- [ ] Store new PAT in Vercel env (`GITHUB_PAT`) for web archive commits later
- [ ] (Old PAT stays on MindStudio until cutover.)

### 8. Slack notifications

- [ ] Create incoming webhook in the channel where reviews should land
- [ ] Store URL → `SLACK_WEBHOOK_URL`

### 9. Deferred (do not start until later)

- Railway projects for `apps/pipeline` and `apps/webhook-handler` — Phase 1 Week 4
- DNS for the actual production website (`castorabbott.com` stays on its current setup; we only verify the `mail.` subdomain)

## Done state

When this checklist is fully checked, Stage 1 (Foundation) can begin. The agent picks up from `docs/specs/01_foundation.spec.md` and the LLM client wrapper.
