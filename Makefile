# Local dev tasks for the betting tracker.
# Full walkthrough: docs/local-startup.md
#
# WARNING: there is no local Postgres stack. Every target that touches the
# database talks to the LIVE Supabase project the league uses.

SHELL := /bin/bash
PORT ?= 3000
PROJECT_REF := ehjowxwewpyqcevfaqse
REQUIRED_ENV := NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY CFBD_API_KEY CRON_SECRET

.DEFAULT_GOAL := help
.PHONY: help install dev kill login env check typecheck lint build clean \
        db-link db-status db-push db-types schedules sync

help: ## Show this help
	@echo "betting-tracker — make targets (see docs/local-startup.md)"
	@echo
	@grep -hE '^[a-z][a-z-]*:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "Vars: PORT=$(PORT)  EMAIL=<addr> (login)  WEEK=<id> (sync)"

install: ## Install dependencies from the lockfile
	npm ci

env: ## Verify .env.local exists and has every required key
	@test -f .env.local || { echo "MISSING: .env.local (gitignored — restore it from your password manager)"; exit 1; }
	@missing=""; for k in $(REQUIRED_ENV); do grep -q "^$$k=." .env.local || missing="$$missing $$k"; done; \
	if [ -n "$$missing" ]; then echo "MISSING keys in .env.local:$$missing"; exit 1; fi
	@echo ".env.local OK"

dev: env ## Start the dev server (PORT=3000)
	npx next dev -p $(PORT)

kill: ## Free the dev port (stale next-server from an earlier session)
	@pids=$$(lsof -ti tcp:$(PORT)); \
	if [ -n "$$pids" ]; then kill $$pids && echo "killed $$pids on :$(PORT)"; else echo ":$(PORT) already free"; fi

login: ## Sign in locally, bypassing SMTP limits — make login EMAIL=you@example.com
	@test -n "$(EMAIL)" || { echo "usage: make login EMAIL=you@example.com"; exit 1; }
	open "http://localhost:$(PORT)/api/dev/magic-link?email=$(EMAIL)"

check: typecheck lint ## Typecheck + lint (run before committing)

typecheck: ## Generate route types, then tsc --noEmit
	npx next typegen && npx tsc --noEmit

lint: ## ESLint (no longer runs during next build)
	npx eslint

build: ## Production build
	npx next build

clean: ## Drop build caches
	rm -rf .next tsconfig.tsbuildinfo

db-link: ## Re-link the Supabase CLI after a fresh clone
	supabase link --project-ref $(PROJECT_REF)

db-status: ## Compare local migrations against the live database
	supabase migration list

db-push: ## Apply pending migrations to the LIVE database
	supabase db push

db-types: ## Regenerate src/types/database.ts from the live schema
	supabase gen types typescript --linked > src/types/database.ts

schedules: env ## Re-run the 2026 season bootstrap (WRITES TO LIVE DB — read the script header)
	npx tsx scripts/gather-2026-schedules.ts

sync: env ## Pull final scores for a week — make sync WEEK=21 (dev server must be running)
	@test -n "$(WEEK)" || { echo "usage: make sync WEEK=21   # 21 = pool week 1 of 2026"; exit 1; }
	@set -a; . ./.env.local; set +a; \
	curl -sS -X POST http://localhost:$(PORT)/api/admin/sync-results \
	  -H "Authorization: Bearer $$CRON_SECRET" \
	  -H "Content-Type: application/json" \
	  -d '{"weekId": $(WEEK)}'
	@echo
