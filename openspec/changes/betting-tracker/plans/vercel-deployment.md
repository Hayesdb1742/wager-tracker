# Plan: Vercel deployment

Goal: get the app live on Vercel with a stable production URL, working magic-link
auth, and all secrets in place — so the pg_cron results-sync migration (final
blocked step of `sports-api-results.md`) can be written against the real URL.

## Step 0 — Pre-flight (local)

1. **Commit the code.** Almost everything (`src/`, `package.json`, `supabase/`,
   configs) is still untracked — only specs/README are in git. Before anything:
   - Confirm `.gitignore` covers `.env.local`, `.next/`, `node_modules/`,
     `.playwright-mcp/`, stray screenshots (`*.png` at repo root), and `.venv/`.
   - Commit on `develop`, PR into `main` (repo: `Hayesdb1742/betting-site`,
     existing flow — PR #1 was develop → main).
   - **Never commit `.env.local`** — it holds the service-role key, CFBD key,
     DB password, and CRON_SECRET.
2. **Verify a production build locally:** `npm run build` (then optionally
   `npm run start` and click through login + /results). Fix any build-only
   errors before involving Vercel.
3. **Decide the dev endpoint's fate.** `src/app/api/dev/magic-link/route.ts` is
   already gated by `NODE_ENV === "production"`, so it's safe to deploy, but the
   standing TODO is to delete it once Resend SMTP works (see Step 3).

## Step 1 — Create the Vercel project

1. `npx vercel login` (or import via vercel.com dashboard → Add New → Project →
   import `Hayesdb1742/betting-site` from GitHub — dashboard import is
   preferred since it wires up git-push deploys automatically).
2. Project name: `betting-site` (production URL becomes
   `https://betting-site.vercel.app` if available — note whatever it actually is).
3. Framework preset: Next.js (auto-detected). Root directory: repo root.
   No build overrides needed.
4. Production branch: `main`. Pushes to `develop` get preview URLs.

## Step 2 — Environment variables (Vercel → Settings → Environment Variables)

Set for **Production** (and Preview if you want preview builds to work):

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same as `.env.local` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same as `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only; never expose with `NEXT_PUBLIC_` |
| `CFBD_API_KEY` | server-only |
| `CRON_SECRET` | must equal the Vault `cron_secret` value (already stored 2026-07-06) |

`SUPABASE_DB_PASSWORD` is CLI-only — do not add it to Vercel.

Then trigger a deploy (git push to `main` or `vercel --prod`) and record the
final production URL.

## Step 3 — Supabase auth configuration (dashboard)

1. **URL config** (Auth → URL Configuration):
   - Site URL → production URL.
   - Redirect allowlist: add `https://<prod-url>/auth/callback` and, if using
     previews, `https://*.vercel.app/auth/callback` (or the project-scoped
     wildcard) plus keep `http://localhost:3000/auth/callback` for dev.
2. **Custom SMTP via Resend** (open task 1.6): create Resend account, verify a
   sending domain (or use their shared domain to start), create API key, enter
   SMTP creds in Auth → SMTP Settings. Without this, magic links are capped at
   ~3/hr on Supabase's built-in mailer — unusable for a 10-person league.
3. Confirm task-1.6 settings while in there: email/password sign-in disabled,
   magic link enabled, JWT expiry 3600s, refresh-token rolling window 30 days.
4. After SMTP works: **delete `src/app/api/dev/magic-link/route.ts`** and its
   allowance in any docs/memory (standing TODO).

## Step 4 — Post-deploy smoke test

1. Magic-link login round-trip on the production URL (real email → link →
   lands on `/picks` authenticated).
2. `/results` as admin: week selector shows 2026 weeks, games render, "Sync
   Results" runs and reports a summary (expect 0 resolved pre-season, no errors).
3. `curl -X POST https://<prod-url>/api/admin/sync-results -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"weekId": 22}'`
   → 200 with a summary. This proves the exact call pg_cron will make.
4. Invite flow: send an invite to a spare email, complete `/join`.

## Step 5 — Hand back for the cron migration

Tell Claude the production URL. Then the pg_cron migration
(`sports-api-results.md` Step 6) gets written: store `app_url` in Vault next to
`cron_secret`, create `cron_sync_results()` (in-flight-game check → pg_net POST),
schedule `*/10 * * * *`.

## Out of scope for this plan

Custom domain, analytics, Sentry/observability (plan step 9), removing the
2025 test season data (worth doing before the league goes live — weeks 1–5 of
season id 1 are fake).
