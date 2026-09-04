# Missions Partner Tracker

A web app for tracking and publicly showcasing your church's missionary and
organization partners.

- **Public site**: a searchable partner directory plus an interactive world
  map (Leaflet) with an auto "tour" fly-through. Partners marked
  `isRestricted` are automatically shown with initials only, no contact
  info, no precise location, and a generic security-conscious description —
  safe to publish even for partners serving in access-sensitive countries.
- **Admin dashboard**: CRUD screens for missionaries and organizations
  (combined into one filterable, searchable list), support tracking, trip
  history & capacity search, furlough/church-visit scheduling, private
  newsletter and document uploads (surveys, signed policies, other
  correspondence), a printable partner booklet export, and user
  management with role-based permissions.
- **White-labeling**: a single Church Settings screen controls the church's
  name, logo, brand color, and the term it uses for its partners (e.g. "Go
  Team Partners" instead of "Missionaries") — everything else in the app
  reads from that instead of hardcoded copy.
- **Auth**: local username/password, plus optional SSO via any
  standards-compliant OIDC provider (Entra ID, Google Workspace, Okta,
  etc.) — configure providers entirely from the admin UI, no redeploy
  needed, and local login always keeps working alongside them. Sessions
  are secured with an `httpOnly` cookie, never exposed to client-side
  JavaScript. Optional TOTP-based MFA for local accounts.
- **Database**: PostgreSQL via Prisma ORM. Works with any Postgres — this
  project's reference deployment uses [Neon](https://neon.tech).

## Guides

This README is a quick technical overview. For everything else, three
task-oriented guides:

| Guide | For | Covers |
|---|---|---|
| **[ADMIN_GUIDE.md](ADMIN_GUIDE.md)** | Whoever sets up and runs the instance | Full local setup, environment variables, SSO configuration, deployment (AWS and elsewhere), file storage, rate limiting, and ongoing operations (rotating secrets, upgrading a fork, troubleshooting) |
| **[INFRASTRUCTURE.md](INFRASTRUCTURE.md)** | Whoever is standing up the AWS infrastructure from scratch | Step-by-step: database, S3, Elastic Beanstalk, IAM, GitHub Actions, CloudFront, and a custom domain with a free managed TLS certificate |
| **[USER_GUIDE.md](USER_GUIDE.md)** | Whoever uses the admin dashboard day-to-day | Roles & permissions, MFA, adding/editing partners field-by-field, support tracking, trip history vs. trip opportunities, newsletters, documents, the booklet export, restricted-partner privacy rules, and what the public site shows visitors |

## Project layout

```
(repo root)/
  backend/     Express API + Prisma + auth
  frontend/    React (Vite) public site + admin dashboard
```

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 18 + Vite, React Router v6 | No CSS framework — plain CSS in `frontend/src/index.css` |
| Backend | Node/Express, Prisma ORM | Serves the built frontend directly — one deployable origin, see [ADMIN_GUIDE.md § Deploying to production](ADMIN_GUIDE.md#deploying-to-production) |
| Database | PostgreSQL (any host) | Prisma migrations in `backend/prisma/migrations` |
| File storage | AWS S3 | Public partner photos/logos + private newsletters/documents, one bucket, split by key prefix |
| Maps/geocoding | Leaflet + OpenStreetMap Nominatim | Free, no API key; geocodes to city-level only, never a street address |
| Auth | httpOnly session cookie + bcrypt (local), `openid-client` (SSO, any OIDC provider), `otplib`/`qrcode` (MFA) | |

## Quick start

Full walkthrough (prerequisites, env var reference, troubleshooting):
[ADMIN_GUIDE.md § Local development setup](ADMIN_GUIDE.md#local-development-setup).
The short version:

```bash
# Backend
cd backend
cp .env.example .env       # fill in DATABASE_URL, SESSION_SECRET, etc.
npm install
npm run prisma:migrate
npm run seed                 # optional: ~35 fake partners for demoing
node prisma/createAdmin.js you@yourchurch.org "SomeStrongPassword!"
npm run dev                  # http://localhost:4000

# Frontend, in a second terminal
cd frontend
npm install
npm run dev                  # http://localhost:5173 — proxies /api automatically
```

Requires Node.js 20.19+ or 22.12+ (Vite 8). Visit
`http://localhost:5173/login` to sign in with the account you just
created.

## Development notes

This app was built with [Claude Code](https://claude.com/claude-code),
Anthropic's AI coding assistant — every feature, from the data model to the
UI, was directed through natural-language prompts and reviewed/iterated on
as it went, rather than hand-written line by line. If you're extending this
project (with or without AI assistance), the codebase comments generally
explain *why* something works the way it does, not just what it does — that
context was deliberately kept for exactly this kind of future work.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for
local setup, running tests, extending the data model, and what a good pull
request looks like, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for how we
expect people to treat each other here. If you're not sure where to start,
open an issue — bug reports and feature requests both have a template to
guide you.

## License

[MIT](LICENSE) — use, modify, and deploy this for your own church freely.
