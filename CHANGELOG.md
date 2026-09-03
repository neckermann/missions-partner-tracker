# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/): given a
version `MAJOR.MINOR.PATCH`, `MAJOR` marks breaking changes (a data
migration you must run, an env var that's now required, etc.), `MINOR`
marks new features that are safe to pull in without extra steps, and
`PATCH` marks fixes.

If you maintain a fork, check this file when you pull in a new release —
see [UPGRADING.md](UPGRADING.md) for the actual update steps.

## [Unreleased]

Nothing yet.

## [1.0.2] - 2026-09-03

### Fixed
- **Security**: `qs` (transitive, via `express`/`body-parser`) pinned to
  `^6.16.0` via a package.json `overrides` entry, fixing a moderate
  denial-of-service advisory
  ([GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g)).
  `express@4.22.2` (the latest 4.x) still resolves `body-parser@1.20.6`,
  which pulls the vulnerable `qs` version — Express 5 fixes this
  transitively but is a breaking major upgrade this project isn't taking
  on for a moderate, low-complexity advisory, so it's overridden directly
  instead.
- **Demo mode**: `POST /api/demo/reset` now also clears the S3 bucket
  (under `missionaries/`, `organizations/`, `newsletters/`, `settings/`)
  as part of every reset, not just the database — previously each
  reset's uploads (seeded photos, newsletter files) were left behind in
  S3 permanently, since wiping the database doesn't touch S3.

## [1.0.1] - 2026-09-02

### Added
- **Demo mode**: an opt-in `POST /api/demo/reset` endpoint (only mounted
  if `DEMO_RESET_TOKEN` is set — otherwise absent, as if it doesn't
  exist) that wipes the database and reseeds it with fresh fake data plus
  a published login, for running a public demo instance that resets on a
  schedule. See [ADMIN_GUIDE.md § Demo mode](ADMIN_GUIDE.md#demo-mode).

## [1.0.0] - 2026-09-02

Baseline snapshot of the project as of its first tagged release.

### Added
- **Public site**: a searchable, filterable partner directory (continent,
  country, type, public/restricted) plus an interactive world map
  (Leaflet) with an auto "tour" fly-through. Search is diacritic-insensitive
  and multi-word across name, field, focus area, overview text, and
  sending church/org name. Partners marked `isRestricted` are automatically
  shown with initials only, no contact info, a country-level map pin
  instead of a precise location, and a generic security-conscious
  description — safe to publish even for partners serving in
  access-sensitive countries.
- **Admin dashboard**: CRUD for missionaries and organizations (combined
  into one filterable, searchable list), support tracking (entries and
  needs), trip history and capacity search, furlough/church-visit
  scheduling, private newsletter uploads via short-lived pre-signed S3
  URLs, a printable partner booklet export, and user management with
  role-based permissions (`viewer`/`editor`/`admin`).
- **Photo history**: uploading a partner photo doesn't overwrite the
  previous one — it's kept as history, viewable and individually
  deletable. The "current" photo (the only one shown publicly, or in
  admin lists/booklet) is whichever has the latest Received Date, not
  just the latest upload, so backfilling an older photo won't demote a
  more recent one.
- **White-labeling**: a single Church Settings screen controls the
  church's name, logo, brand color, and the term it uses for its
  partners (e.g. "Go Team Partners" instead of "Missionaries") —
  everything else in the app reads from that instead of hardcoded copy.
- **Auth**: local username/password, plus optional single sign-on via any
  standards-compliant OIDC provider (Entra ID, Google Workspace, Okta,
  etc.) — add, enable, or disable providers entirely from the admin UI,
  no redeploy needed, and local login always keeps working alongside
  them. Sessions are an `httpOnly`, `Secure`, `SameSite=Lax` cookie set
  by the backend — never a token exposed to client-side JavaScript.
  Optional TOTP-based MFA for local accounts, self-service or
  admin-forced. Secrets stored in the database (SSO client secrets, MFA
  secrets) are encrypted at rest (AES-256-GCM).
- **One deployable origin**: the backend serves the built frontend
  directly — no separate frontend host or build pipeline, no CORS to
  configure. `.github/workflows/backend-deploy-aws.yml` is a ready-to-use
  GitHub Actions template that builds and deploys the whole app to AWS
  Elastic Beanstalk.
- **File storage**: AWS S3 by default, or any S3-compatible service
  (Cloudflare R2, Backblaze B2, self-hosted MinIO) via `S3_ENDPOINT`.
- Rate limiting on `/api/auth/*` and `/api/public/*` to blunt scripted
  abuse against the public site's unauthenticated endpoints.
- Unit tests for the public/restricted data-masking rules and the auth
  middleware (`backend/test/`).
- `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, this
  `CHANGELOG.md`, [UPGRADING.md](UPGRADING.md),
  [ADMIN_GUIDE.md](ADMIN_GUIDE.md) (setup, infrastructure, deployment,
  ongoing operations), [INFRASTRUCTURE.md](INFRASTRUCTURE.md) (detailed
  AWS infra setup walkthrough), and [USER_GUIDE.md](USER_GUIDE.md)
  (day-to-day use of the admin dashboard).
