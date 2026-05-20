# Development Workflow

## Branching & PRs

- Default branch: `main`
- Feature branches: `feat/PR-###-short-name`
- 1 PR = 1 roadmap item. Avoid mixed concerns.
- Prefer squash-merge into `main`.

## Quality gates (CI)

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run format`

## Secrets

- Use `.env` (not committed) for secrets.
- Logs must not include secrets; logger redaction is enabled by default.

## LinkedIn Session Bootstrap

- First-time login is manual: run worker with `HEADFUL=1` so a real browser window opens.
- Sessions persist in `PLAYWRIGHT_USER_DATA_DIR_BASE/<LINKEDIN_ACCOUNT_ID>` (defaults to `.local/linkedin-profiles/default`).

## LinkedIn Discovery (Dev)

- Enqueue a discovery job by running API with `RUN_DISCOVER_DEMO=1`.
- Configure `LINKEDIN_KEYWORDS`, `LINKEDIN_LOCATION`, `LINKEDIN_MAX_CARDS`.

## LinkedIn Job Details (Dev)

- Backfill incomplete rows by running API with `RUN_SYNC_DEMO=1`.
- Configure `LINKEDIN_SYNC_MAX_JOBS`.

## Job Scoring (Dev)

- Score recent postings by running API with `RUN_SCORE_DEMO=1`.
- Configure `SCORE_MAX_JOBS` and `SCORE_THRESHOLD`.

## Auto-Apply Cycle (Dev)

- Run one orchestration cycle by running API with `RUN_AUTO_APPLY_DEMO=1` (or call `POST /auto-apply/run`).
- Configure `AUTO_APPLY_TOP_N`, `AUTO_APPLY_MIN_SCORE`, and `DAILY_APPLY_LIMIT`.

## Easy Apply Dry-Run (Dev)

- Ensure session is logged in first (HEADFUL default is on).
- Run API with `RUN_EASY_APPLY_DEMO=1` to enqueue an `EASY_APPLY_ATTEMPT`.
- Optionally set `JOB_POSTING_ID` (otherwise worker picks the newest `easyApply=true` posting).

## Review UI (Dev)

- Start API on `http://localhost:3001`: `npm run dev -w @applyflow/api`
- Start Web on `http://localhost:3000`: `npm run dev -w @applyflow/web`

## Runbook

- Full local workflow: `docs/runbook-local.md`

## AI Draft Answers (Dev)

- Create `.local/candidate-profile.json` based on `.local/candidate-profile.example.json`.
- Set `OPENAI_API_KEY` and `CANDIDATE_PROFILE_PATH` in `.env`.
- Enqueue AI drafting by running API with `RUN_AI_DRAFT_DEMO=1` and `APPLICATION_ID=<id>`.

## Submit Policy

- Automation stops and marks `needs_review` when required inputs are missing or answers are not confidently auto-fillable.
- No in-modal waiting/resume in MVP; re-run after human fixes or improved profile/answers.
- Optional auto-submit: set `AUTO_SUBMIT_ON_READY=1` to auto-enqueue submit when an application becomes ready (e.g., after saving the last required approved answer or applying a template).

## Worker Safety Rails

- `MAX_CONCURRENT_PER_ACCOUNT` (default `1`): caps concurrently-running jobs per LinkedIn account across workers.
- `ACCOUNT_COOLDOWN_MS` (default `20000`): best-effort cooldown between LinkedIn automation jobs per account (per worker).
- `ACCOUNT_JITTER_PCT` (default `0.2`): randomizes cooldown delays by +/- this fraction to avoid bursty patterns.
