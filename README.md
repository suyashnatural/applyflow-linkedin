# ApplyFlow (LinkedIn-only)

This repo bootstraps a production-grade LinkedIn-only job search + Easy Apply automation system with:

- `apps/web`: human-in-the-loop review/approval UI
- `apps/api`: API for jobs, applications, approvals, and artifacts
- `apps/worker`: queue consumer running Playwright automation + AI drafting
- `packages/*`: shared libs (types, config, observability, automation)

## Local dev (bootstrap)

1. Start Postgres: `docker compose up -d` (or install Postgres locally)
2. Create `.env` from `.env.example` and set `DATABASE_URL`
3. Install dependencies: `npm i`
4. Generate Prisma client: `npm run db:generate`
5. Apply migrations: `npm run db:migrate:dev`
6. Start everything: `npm run dev:all`

## Workflow

- Branches: `feat/PR-###-short-name`
- One PR per feature; keep PRs small and reviewable.
