# Vercel deployment — `apps/review-ui`

The Next.js admin UI deploys to Vercel. The pipeline worker and webhook handler do **not** deploy to Vercel (they run elsewhere — likely Railway, deferred).

## One-time project setup

1. **Connect the repo.** In Vercel: New Project → Import `DLS911/Email-Sender-Platform`.
2. **Set Root Directory.** Project Settings → General → Root Directory = `apps/review-ui`.
3. **Framework preset.** Auto-detected as Next.js. Confirm.
4. **Install + build commands.** The `vercel.json` in `apps/review-ui` already specifies:
   - Install: `cd ../.. && pnpm install --frozen-lockfile`
   - Build: `cd ../.. && pnpm --filter review-ui build`
   - Output: `.next`

   Vercel's auto-detected Node version should be 22.x. If it picks something older, set `NODE_VERSION=22` in Project Settings → General → Node.js Version.

5. **Environment variables.** Add in Project Settings → Environment Variables (Production + Preview):

   | Name | Value | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from Supabase project | exposed to browser |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase project | exposed to browser |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Supabase project | server-side only — NEVER expose to client |
   | `NODE_VERSION` | `22` | optional override if auto-detect picks wrong version |

6. **Deploy.** First deploy will run `pnpm install` from the monorepo root and build only the `review-ui` workspace. Subsequent deploys hot-cache pnpm.

## Branch deploys

- `main` → production
- Pull requests → preview deploys (auto)

Vercel automatically rebuilds on every push.

## Custom domain

When ready, add the production domain in Project Settings → Domains. The `vercel.json` does not pin a domain so any host works.

## Smoke test after deploy

After the first deploy hits production:

```bash
# Replace with the actual deploy URL
curl -s -o /dev/null -w "%{http_code}\n" https://email-sender-platform.vercel.app/
```

Expected: `200`. The home page is a status placeholder until the real review UI lands per spec 08.

## Why Vercel over self-hosted Next.js

- Native Next.js support including ISR, edge functions, image optimization.
- Preview deploys for every PR — frictionless review of UI changes.
- Zero infrastructure to maintain.
- Team-grade plan handles everything we need at our scale.

## What lives elsewhere

- **`apps/pipeline`** — content generation worker. Long-running. Will deploy to Railway (or similar) once Phase 1 Week 4 lands. Held until then.
- **`apps/webhook-handler`** — Resend webhook receiver. Will deploy as either a Supabase Edge Function or Railway service. Held with the pipeline.
