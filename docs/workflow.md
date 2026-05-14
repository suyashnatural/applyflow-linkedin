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
