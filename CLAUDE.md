# CLAUDE.md

Entry point for Claude (or any agent) working in this repo. Keep this
file short — detail belongs in the docs it links to, not here.

**Last verified**: 2026-11-11 · **Owner**: @neckermann

## What this is

A web app churches fork and self-host to track missionary/organization
partners: public directory + map, admin CRUD, prayer requests, one-time
needs, newsletters, GroupMe/WhatsApp/email notifications. Node/Express
backend + React/Vite frontend, one origin, one Postgres DB (Prisma).
Full architecture: [SPEC.md](SPEC.md).

## Key commands

```bash
cd backend  && npm test && npm run test:routes   # backend suite
cd frontend && npm run test:e2e                  # Playwright e2e
cd frontend && npm run build                     # writes into backend/public
cd backend  && npx prisma migrate dev --name x    # schema change -> migration (never hand-write one)
```

Full local setup: [ADMIN_GUIDE.md § Local development setup](ADMIN_GUIDE.md#local-development-setup).

## Hard rules

- **Keep forks upgradable**: never hardcode a church's name/logo/colors/
  terminology in application code — it goes in `ChurchSettings`. See
  [CONTRIBUTING.md § The one rule that matters most](CONTRIBUTING.md#the-one-rule-that-matters-most-keep-forks-upgradable).
- **Single origin, relative URLs only** — see [CONTRIBUTING.md § Single-origin architecture](CONTRIBUTING.md#single-origin-architecture--dont-add-cross-origin-support).
- **Migrations via `prisma migrate dev`, never hand-written** — see
  [CONTRIBUTING.md § Database migrations](CONTRIBUTING.md#database-migrations).
  Pre-1.0: every schema change gets squashed into one baseline before
  release — see [SPEC.md § 8.3](SPEC.md#83-migration-strategy-pre-10).
- **No `window.confirm()`/`prompt()`** — use `useConfirmDialog` — see
  [CONTRIBUTING.md § Code style](CONTRIBUTING.md#code-style).
- Forcing a notification schedule to fire early sends for real, on real
  channels (WhatsApp/GroupMe/email) — see
  [docs/WORKFLOW.md](docs/WORKFLOW.md#testing-live-sends).

## Where to go next

| Need | Doc |
|---|---|
| The full idea-to-production pipeline | [docs/WORKFLOW.md](docs/WORKFLOW.md) |
| Working here as an agent/subagent: approval gates, repo map, starter brief | [docs/AGENTS.md](docs/AGENTS.md) |
| Design tokens, component patterns, copy tone | [docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md) |
| Data model, backend/frontend structure, "where does X change go" | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [SPEC.md](SPEC.md) |
| Environment URLs, env vars, deploy/rollback, common failures | [docs/RUNBOOK.md](docs/RUNBOOK.md) |
| Contribution process, migrations, dependency policy, screenshot rules | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Operating the live public demo specifically | [demo/README.md](demo/README.md) |
