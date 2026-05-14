# ApplyFlow (LinkedIn-only)

This repo bootstraps a production-grade LinkedIn-only job search + Easy Apply automation system with:

- `apps/web`: human-in-the-loop review/approval UI
- `apps/api`: API for jobs, applications, approvals, and artifacts
- `apps/worker`: queue consumer running Playwright automation + AI drafting
- `packages/*`: shared libs (types, config, observability, automation)

## Local dev (bootstrap)

1. Start Postgres: `docker compose up -d`
2. Create `.env` from `.env.example`
3. Install dependencies: `npm i`
4. Run API: `npm run dev -w @applyflow/api`
5. Run Web: `npm run dev -w @applyflow/web`
6. Run Worker: `npm run dev -w @applyflow/worker`

## Workflow

- Branches: `feat/PR-###-short-name`
- One PR per feature; keep PRs small and reviewable.
