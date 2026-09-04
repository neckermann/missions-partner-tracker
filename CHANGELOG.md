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

## [1.0.9] - 2026-09-04

### Fixed
- **The public map stopped rendering** — a regression from v1.0.4's CSP
  fix, which widened `img-src` for missionary/organization photos but
  didn't account for the map's other two external image sources:
  Leaflet's map tiles (OpenStreetMap's subdomained tile servers) and its
  default marker pin/shadow icons (unpkg's CDN). Both are now explicitly
  allowed alongside the S3 origin. Verified with a real headless-browser
  check against the live demo: all 20 visible map tiles loaded, no
  console errors, pins and photos render correctly.

## [1.0.8] - 2026-09-04

### Added
- **Booklet print templates**: the Print Booklet page now offers a
  **Look & Feel** picker with three visually distinct templates —
  Classic (the original design), Modern (clean nonprofit-report style,
  no decorative shapes, bold rules, a rectangular photo), and
  Traditional (a bordered page frame, small centered portrait, serif
  type throughout). All three share the same content-generation code
  (`frontend/src/pages/AdminBooklet.jsx`) and differ only in CSS,
  scoped under `.tpl-classic`/`.tpl-modern`/`.tpl-traditional`
  (`frontend/src/styles/booklet.css`) — switching templates re-renders
  the preview immediately.
- **Back cover page**: every generated booklet now ends with a closing
  page — the church's logo and name (Church Settings) plus its About
  Text or Public Tagline as a closing message, styled per template.
  Previously the booklet had no back cover at all.

## [1.0.7] - 2026-09-04

### Added
- **Optional real stock photos for seed data**, via the
  [Pexels API](https://www.pexels.com/api/) (`PEXELS_API_KEY`,
  `backend/.env.example`). Each seeded missionary gets a photo matched to
  their actual household — single adult, couple, family with kids, or a
  larger family — and each organization gets a logo-style photo, all
  downloaded and re-uploaded through the app's own S3 pipeline like a
  real admin upload, not hotlinked. A handful of Pexels search calls per
  seed run (one per category, not per-partner), well under the free
  tier's rate limit. Search terms for two-adult households use specific
  relationship terms (rather than a generic "couple"/"parents") since
  stock photo libraries tag those more consistently with a matching
  two-person portrait. Entirely optional — unset (or any failed request)
  falls back to the existing generated SVG silhouette avatars exactly as
  before, so seeding never depends on a third-party API being available.

## [1.0.6] - 2026-09-04

### Changed
- **Docs**: README, INFRASTRUCTURE.md, ADMIN_GUIDE.md, USER_GUIDE.md,
  CONTRIBUTING.md, and `backend/.env.example` updated for the Documents
  feature (a `documents/` prefix, a new file type list, an admin nav
  entry, a new USER_GUIDE.md § Documents section with the full category
  table). Also fixed two pre-existing inaccuracies found along the way:
  ADMIN_GUIDE.md § File storage (S3) was missing the actual bucket-policy
  and IAM-policy JSON that INFRASTRUCTURE.md and `.env.example` both
  pointed readers to (now added, matching the real policies in
  production); and CONTRIBUTING.md § Database migrations claimed
  migrations are "hand-written, not auto-generated," when the actual
  (and correct) practice is `npx prisma migrate dev` to generate the
  base SQL, hand-editing only when a migration needs more than a schema
  diff.

## [1.0.5] - 2026-09-04

### Added
- **Document repository**: a general-purpose place to store survey
  responses, signed policy acknowledgments, other office documents
  (Word/Excel/PDF), and long-term email records for a missionary or
  organization — separate from the Newsletter feed. Same admin-only,
  private-S3/pre-signed-URL access model as Newsletters. Each document
  gets a category (Survey Response, Signed Policy, Email Communication,
  Office Document, or a free-typed Other label), a received date, and
  notes. The consolidated **Admin → Documents** page (also linked from
  the admin home dashboard) can filter by category and by missionary/
  organization, and every partner's own detail page gets a Documents
  section alongside its Newsletters one. Accepts PDF, Word (.doc/
  .docx), Excel (.xls/.xlsx), .eml, JPEG, and PNG — every format except
  .eml is verified against its actual file content on upload, not just
  its declared type (see `backend/src/utils/fileSignature.js`).
  Demo/seed data (`backend/prisma/seed.js`) now includes sample
  documents across every category, each a genuinely valid, openable
  file — a real minimal PDF (proper structure, not just the bare magic
  bytes) or a real `.eml`, not placeholder bytes.
  New `Document` table — run `npx prisma migrate deploy` when upgrading
  (see [UPGRADING.md](UPGRADING.md)).

## [1.0.4] - 2026-09-03

### Changed
- **Security**: new users auto-provisioned on their first SSO login now
  default to the `viewer` role (read-only) instead of `editor`. This app
  has no way to vet who's on the other end of a successful identity
  provider login beyond the optional allowed-email-domain setting, so an
  unrecognized first-time SSO sign-in is no longer assumed trustworthy
  enough for write access — an admin now has to explicitly promote a new
  SSO user before they can create/edit/delete anything. See
  [ADMIN_GUIDE.md § Single sign-on (SSO)](ADMIN_GUIDE.md#single-sign-on-sso)
  for the full guidance on also gating access on the identity provider's
  own side.
- **Security**: uploaded photo/logo/newsletter files now have their actual
  content verified against a handful of known magic-byte signatures
  (JPEG/PNG/WebP/PDF), not just the client-supplied Content-Type header,
  which was trivially spoofable. See `backend/src/utils/fileSignature.js`.
- **Security**: the default Content-Security-Policy now explicitly allows
  `img-src` from this app's own S3/CloudFront asset origin. helmet()'s
  out-of-the-box default (`img-src 'self' data:`) was silently blocking
  every missionary/organization photo and church logo, since all of them
  load from that separate origin.
- **Security**: `POST /api/demo/reset`'s bearer-token check now uses
  `crypto.timingSafeEqual` instead of `!==`, removing a timing
  side-channel on the token that guards a fully destructive action.
- **Security**: the SSO login flow's PKCE `code_verifier` now travels in a
  short-lived, path-scoped, httpOnly cookie instead of inside the `state`
  parameter — `state` round-trips through the browser to the external
  identity provider and back, so anything in it (URL query string) is
  visible in the IdP's own logs, browser history, and any Referer header
  the IdP's login page sends. The verifier is supposed to prove "the same
  client that started the flow"; keeping it only in this server's own
  browser-to-server channel restores that guarantee.

## [1.0.3] - 2026-09-03

### Changed
- **Express upgraded 4 → 5.** The only breaking change that affected this
  app was the SPA catch-all route, which now uses `"*splat"` instead of
  a bare `"*"` (required by `path-to-regexp` v8, an Express 5
  dependency) — everything else in the app was already compatible.
  This also removes the need for the `qs` override added in 1.0.2:
  Express 5's own `qs` dependency range already resolves to a patched
  version, so the explicit `overrides` entry has been dropped as
  redundant.

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
