# Local Runbook

This is the end-to-end local workflow for LinkedIn-only automation.

## Prereqs

- Node.js 20+
- Postgres (Docker or native)
- A LinkedIn account you will use for automation

## Setup

1. Create `.env` from `.env.example`
2. Ensure `DATABASE_URL` points at Postgres
3. Install deps: `npm i`
4. Generate Prisma client: `npm run db:generate`
5. Apply migrations: `npm run db:migrate:dev`

## Start services

- Start all: `npm run dev:all`
- Or individually:
  - API: `npm run dev -w @applyflow/api` (defaults `http://localhost:3001`)
  - Web: `npm run dev -w @applyflow/web` (defaults `http://localhost:3000`)
  - Worker: `npm run dev -w @applyflow/worker`

Health checks:

- API: `http://localhost:3001/healthz`
- DB: `http://localhost:3001/healthz/db`

## 0) Bootstrap LinkedIn session

1. Set `HEADFUL=1` and `LINKEDIN_ACCOUNT_ID=default` (or any id) in `.env`
2. Enqueue bootstrap by starting API with `RUN_ENQUEUE_DEMO=1`
3. Worker opens a browser for manual login on first run

Session persists under `PLAYWRIGHT_USER_DATA_DIR_BASE/<LINKEDIN_ACCOUNT_ID>`.

## 1) Discover jobs

1. Set `LINKEDIN_KEYWORDS`, `LINKEDIN_LOCATION`, `LINKEDIN_MAX_CARDS`
2. Enqueue discovery by starting API with `RUN_DISCOVER_DEMO=1`
3. Worker upserts `JobPosting` rows

## 2) Sync job details

1. Set `LINKEDIN_SYNC_MAX_JOBS`
2. Enqueue sync by starting API with `RUN_SYNC_DEMO=1`
3. Worker backfills `title/company/location/description` and `easyApply`

## 3) Easy Apply dry-run

1. Enqueue dry-run by starting API with `RUN_EASY_APPLY_DEMO=1`
2. Worker runs `EASY_APPLY_ATTEMPT` and creates an `Application`:
   - `needs_review` when it reaches the review step
   - `failed/blocked` on errors

Artifacts are written under `.local/artifacts/...` (or `ARTIFACT_DIR`).

## 4) Draft answers (AI)

1. Create `.local/candidate-profile.json` based on `.local/candidate-profile.example.json`
2. Set `OPENAI_API_KEY` and `CANDIDATE_PROFILE_PATH`
3. Enqueue drafting by starting API with `RUN_AI_DRAFT_DEMO=1` and `APPLICATION_ID=<id>`

The worker stores drafts in `ApplicationStep(name=AI_DRAFT_ANSWERS)`.

## 5) Review + approve

1. Open web UI: `http://localhost:3000`
2. Pick an application in `needs_review`
3. Approve (enqueues `EASY_APPLY_SUBMIT`) or deny

## 6) Submit (approved only)

The worker attempts `EASY_APPLY_SUBMIT`:

- Submits only if all required fields are auto-fillable and not approval-gated.
- Otherwise marks `needs_review` (no pause/resume).
