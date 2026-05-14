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
