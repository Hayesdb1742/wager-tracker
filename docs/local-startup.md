# Local Startup Guide

How to get the betting tracker running on this Mac from a shell. Everything here
uses `npx` / the globally installed `supabase` CLI — no global installs needed
beyond Node.

> **This app talks to the live Supabase project.** There is no local Postgres
> stack (`supabase/config.toml` doesn't exist). `.env.local` points at
> `ehjowxwewpyqcevfaqse` — the same database the league uses. Writes from
> `npm run dev`, seed scripts, and admin routes hit real data.

---

## 0. Prerequisites (one-time)

| Thing | Expected | Check |
|---|---|---|
| Node | v23.10.0 | `node -v` |
| npm | 11.12.1 | `npm -v` |
| Deps installed | `node_modules/` present | `npm ci` |
| Supabase CLI | 2.107.0 (Homebrew) | `supabase --version` |
| `.env.local` | present in repo root | `ls .env.local` |

`.env.local` is gitignored and **not recoverable from the repo**. It must contain:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_PASSWORD=
CFBD_API_KEY=
CRON_SECRET=
```

Values live in the Supabase dashboard (Settings → API / Database) and
collegefootballdata.com. Keep a copy in your password manager.

---

## 1. Start the app

```sh
cd ~/dev/betting-site
npx next dev
```

- Next.js 16.2.6, Turbopack is the default bundler — no `--turbopack` flag needed.
- `.env.local` is loaded automatically (startup banner prints `Environments: .env.local`).
- Serves on <http://localhost:3000>; ready in well under a second on a warm cache.
- Dev output goes to `.next/dev`, so `next dev` and `next build` can run side by side.

Equivalent: `npm run dev`. Use `npx next dev` when you want flags:

```sh
npx next dev -p 3005          # different port
npx next dev --webpack        # fall back to Webpack if Turbopack misbehaves
npx next dev --experimental-https   # self-signed HTTPS
```

**Port 3000 already taken?** Next silently falls forward to 3001, which usually
means a stale server from an earlier session. Find and kill it:

```sh
lsof -ti tcp:3000            # PID
lsof -ti tcp:3000 | xargs kill
```

---

## 2. Log in (dev magic link)

Supabase's free tier caps transactional email at 3/hour, so **do not** use the
real magic-link flow for local work. Use the dev bypass instead:

```sh
open "http://localhost:3000/api/dev/magic-link?email=you@example.com"
```

It mints a magic-link token with the service-role key, redirects straight to
`/auth/callback`, and lands you signed in. The route 403s when
`NODE_ENV=production`, so it's dev-only by construction.

> Still listed for deletion once Resend SMTP is wired up
> (`src/app/api/dev/magic-link/route.ts`).

Admin pages (`/weeks`, `/results`, `/members`, `/pick-grid`) require
`app_metadata.role === "ADMIN"` on the auth user — sign in as an admin account,
not a member one.

Quick sanity check without a browser:

```sh
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/   # 307 → /login
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login              # 200
```

---

## 3. Checks before committing

```sh
npx next typegen && npx tsc --noEmit   # typegen first — it writes route types + next-env.d.ts
npx eslint                             # same as `npm run lint`
npx next build                         # full production build
```

`next build` no longer runs lint in Next 16 — run `eslint` yourself.

---

## 4. Database work (Supabase CLI)

The CLI is linked to the remote project. Link state lives in `supabase/.temp/`,
which is gitignored — after a fresh clone, re-link:

```sh
supabase link --project-ref ehjowxwewpyqcevfaqse
```

Then:

```sh
supabase migration list                      # local vs remote migration state
supabase migration new <name>                # new timestamped file in supabase/migrations/
supabase db push                             # apply pending migrations to the live DB
supabase gen types typescript --linked > src/types/database.ts
```

Seeds are applied by hand in the Supabase SQL editor, not by the CLI:
- `supabase/seeds/dev_seed.sql` — fake profiles/picks for UI work (idempotent)
- `supabase/seed_2024_historical.sql` — the 648 real 2024 picks

---

## 5. One-off scripts

```sh
npx tsx scripts/gather-2026-schedules.ts
```

`tsx` isn't a dependency — `npx` fetches it on demand. The script reads
`.env.local` itself, so it doesn't need the dev server running. It creates a
season plus pool weeks 0–18 and pulls CFB/NFL schedules; **it writes to the live
database**, so read the header comment before running it again.

---

## 6. Hitting admin API routes from the shell

Most `/api/admin/*` routes need a browser session. `sync-results` also accepts
the cron secret, which makes it curl-able:

```sh
source .env.local   # or export CRON_SECRET=... by hand
curl -X POST http://localhost:3000/api/admin/sync-results \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"weekId": 21}'
```

(Week 21 = pool week 1 of the 2026 season.)

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| "Port 3000 is in use … using 3001" | Stale dev server — `lsof -ti tcp:3000 \| xargs kill` |
| `supabaseUrl is required` / undefined env | Running from the wrong directory, or `.env.local` is missing — the `!` assertions in `src/lib/supabase/*.ts` fail loudly |
| Redirect loop on `/login` | Middleware auth bypass broke; `/api/` must stay in the unauthenticated allowlist in `src/middleware.ts` |
| Magic link email never arrives | Free-tier SMTP is 3/hr — use the dev endpoint in §2 |
| Signed in but admin pages 403 | Role is read from `auth.users.raw_app_meta_data.role`, not `profiles.role`. Both must be set |
| Weird build/HMR state | `rm -rf .next` and restart |
| Turbopack-specific breakage | `npx next dev --webpack` to confirm, then file it |
