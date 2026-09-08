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

## [2.1.3] - 2026-09-08

### Added
- A "Deploy to Render" button in the README, next to a short note that
  forks should use Render's own Dashboard (New → Blueprint) instead —
  the button always deploys from this exact repo, not a fork, since
  that's just how GitHub-embedded buttons work.

## [2.1.2] - 2026-09-08

### Fixed
- **`npm run demo:reset` / `POST /api/demo/reset` has been broken since
  the Prisma 7 migration (v1.0.19)** — `prisma migrate reset` dropped the
  `--skip-seed` and `--skip-generate` flags entirely (not renamed,
  removed), so every reset failed at the first step with `unknown or
  unexpected option: --skip-seed`. Went unnoticed until now because nothing
  in CI exercises this path (it's demo-only) and it happened to be masked
  by a separate, unrelated credentials issue on the one demo environment
  that was calling it. Fixed by dropping both flags — Prisma 7's
  `migrate reset` no longer auto-runs the seed command either, so there's
  no double-seed risk from the explicit seed step that already follows it
  in `reset-demo-data.js`.

## [2.1.1] - 2026-09-08

### Fixed
- **`render.yaml`'s backend build silently skipped the `prisma` CLI.**
  Same root cause as the frontend's earlier `vite: not found` fix (see
  v2.1.0) — `NODE_ENV=production` is visible during the build, and npm
  skips devDependencies whenever that's set. Unlike the frontend build,
  this didn't fail outright: `npx prisma migrate deploy` (and any other
  `npx prisma ...` call, including a demo reset's `migrate reset`) just
  silently fell back to downloading `prisma` fresh from the registry on
  every run instead of using the pinned version already in
  `package-lock.json` — slower, and not actually reproducible. Backend's
  install now also uses `--include=dev`.

## [2.1.0] - 2026-09-08

### Added
- **`render.yaml`** — a Render Blueprint for deploying this app to
  [Render](https://render.com) with a single click: one web service plus
  one Postgres database (which also holds every uploaded photo,
  newsletter, and document — see v2.0.0), nothing else to provision. No
  AWS account, IAM policy, or S3 bucket needed at all. Verified against a
  real deploy: build, `prisma migrate deploy` as a pre-deploy step, and
  the running app all confirmed working, on both free tier (for a quick
  check) and the cheapest paid tier (Starter web + `0.1c-256mb` Postgres,
  ~$13/mo combined — needed for anything long-lived, since free services
  sleep after 15min idle and free Postgres instances expire after 90
  days). Purely additive — nothing about the existing AWS deployment
  path changes.

## [2.0.0] - 2026-09-08

### Changed
- **File storage moved from S3 to the database.** Photos, newsletters,
  and documents were the last thing a new self-hosted instance needed an
  AWS account for — S3 bucket, bucket policy, IAM permissions, an
  `S3_BUCKET_NAME`/`AWS_REGION` pair (or `S3_ENDPOINT`/
  `S3_FORCE_PATH_STYLE`/`S3_PUBLIC_URL_BASE` for an S3-compatible
  alternative). All of that is gone: `Photo`, `Newsletter`, and
  `Document` now store the file itself in a `bytes` column, and
  `ChurchSettings.logo` (a `{ url }` JSON blob) is now
  `logoBytes`/`logoContentType`. See the new comment on the `Newsletter`
  model in `backend/prisma/schema.prisma` for the reasoning — in short,
  Postgres's TOAST mechanism already keeps large column values out of
  line and compressed, so this doesn't slow down ordinary queries (every
  list/detail query explicitly omits `bytes`), and one church's worth of
  files over any realistic number of years is nowhere near the scale
  where that stops being true. `@aws-sdk/client-s3` and
  `@aws-sdk/s3-request-presigner` are no longer dependencies at all.
  Public images are now served at `GET /api/photos/:id/raw` and
  `GET /api/public/settings/logo/raw` (same-origin, unauthenticated —
  matching the old public-read S3 prefixes); private files stream
  straight from `GET /api/newsletters/:id/download` and
  `GET /api/documents/:id/download` (still session-auth'd), replacing the
  short-lived pre-signed URL indirection with a direct response.
- **Upload limit for newsletters/documents dropped from 20MB to 10MB**
  (`routes/newsletters.js`, `routes/documents.js`, and the nginx
  `client_max_body_size` that has to match it) — the point past which the
  usual Postgres guidance shifts from "just use the database" to "use
  object storage instead." Missionary/org photos and the church logo were
  already at 5MB, unchanged.
- Deploy-time database migrations now delete pre-existing
  `Document`/`Newsletter`/`Photo` rows as part of adding the required
  `bytes` column (see the migration's own comment) — their old
  `fileKey`/`url` pointers into S3 become permanently unusable the moment
  this ships regardless, since the app no longer knows how to reach S3 at
  all. Not a concern for this project's own demo/production (empty at the
  time of this release), but **if your fork has real uploaded files, back
  up anything you need before pulling this in** — there's no automated
  backfill from the old S3 objects into the new columns.

### Fixed
- **A public organization's detail page could never show a photo** —
  `GET /api/public/organizations/:id` was missing the `photos` include
  entirely (present on the list route, absent here), an unrelated
  pre-existing bug found while touching this exact line for the storage
  migration above.

### Removed
- The `AWS_REGION`, `S3_BUCKET_NAME`, `S3_ENDPOINT`,
  `S3_FORCE_PATH_STYLE`, and `S3_PUBLIC_URL_BASE` environment variables —
  no longer read anywhere in the app.

## [1.0.26] - 2026-09-08

### Fixed
- **v1.0.25's own new "Apply database migrations" step broke the deploy
  job.** `npm ci`'s postinstall runs `prisma generate`, which loads
  `prisma.config.js`, which throws if `DATABASE_URL` isn't set at all —
  same failure mode already fixed for the `backend-tests` job back in
  v1.0.20. The new migration step fetched `DATABASE_URL` from EB *after*
  "Install backend deps" ran, so the fetch never had a chance to help.
  Fixed by fetching it first and exporting via `$GITHUB_ENV` so every
  later step in the job has it. Caught on demo before it ever reached
  production.

## [1.0.25] - 2026-09-08

### Fixed
- **The deploy pipeline never ran database migrations against the real
  target environment.** `prisma migrate deploy` only ran inside the `e2e`
  job's throwaway CI database — demo's and production's actual Postgres
  databases were never migrated by the pipeline itself. This went
  unnoticed until v1.0.22's `PrayerRequest` table: demo happened to have
  it already (applied by hand while building the feature locally), but
  production didn't, and production's `/api/public/missionaries` started
  erroring once the new code tried to `include` a table that didn't
  exist — caught correctly by the smoke-test job, which rolled production
  back to the previous version as designed. Fixed by adding an "Apply
  database migrations" step to the `deploy` job, running before the new
  version goes live. It reads `DATABASE_URL` directly from the target EB
  environment's own configuration (via the AWS credentials the job
  already has) rather than duplicating it as a separate GitHub secret, so
  EB stays the single source of truth for that value. Only
  additive/backwards-compatible migrations should ever land here, since
  the previous app version keeps serving traffic against the new schema
  for the short window until the new version is live.
- **The admin "out of date" banner was wrong about being out of date.**
  `versionCheck.js` compares `backend/package.json`'s version against the
  latest GitHub release tag, and its own long-standing comment says that
  value must be bumped on *every* release — even a frontend-only one —
  specifically so this stays accurate. v1.0.23 and v1.0.24 were both
  frontend-only (an e2e test fix) and only bumped
  `frontend/package.json`, leaving `backend/package.json` at 1.0.22 while
  the latest release tag moved to v1.0.24 — so every instance correctly
  running the latest code still saw a false "update available" banner.
  This release's version bump resyncs it; going forward, every release
  bumps `backend/package.json` regardless of which side actually changed.

## [1.0.24] - 2026-09-08

### Fixed
- **The prayer-requests e2e spec's target-selection was still
  incomplete after v1.0.23** — it now correctly excluded archived
  records, but not restricted ones. `toPublicMissionary()` strips prayer
  requests (along with sendingChurch, the real overview, and everything
  else) entirely for a restricted record, same as it always has — the
  test just hadn't accounted for that third condition. Found the same
  way as v1.0.23's fix: by watching that fix's own CI run fail against a
  fresh seed (this time landing on a public, non-archived, but
  restricted missionary). Now checks `!m.isRestricted` too.

## [1.0.23] - 2026-09-08

### Fixed
- **The new prayer-requests e2e spec was flaky against a fresh CI
  seed** — it picked a target missionary via
  `missionaries.find(m => m.isPublic)`, but `toPublicMissionary()`
  excludes archived records regardless of `isPublic` (see maskData.js).
  Against freshly-seeded data (unlike my own accumulated local demo
  data, which happened not to hit this combination), the found record
  could be both public and archived, so the "shows on the public
  profile" assertion failed. Now also checks `!m.archived`.

## [1.0.22] - 2026-09-07

### Added
- **Prayer request tracking** (closes GitHub issue #43): a new
  admin-managed record per missionary/organization — category
  (short-term, admin-only, vs. long-term, which can optionally be shown
  publicly), the request itself, date received, and (when it happens) an
  answer date and note on how it was answered. Manage from a partner's
  detail page or the new central **Prayer Requests** admin page; a
  long-term request marked public shows on that partner's public profile
  and, if enabled, the printed booklet.
  Deliberately designed as a long-term testimony record, not a
  pass/fail checklist: `status` has three neutral values — "ongoing"
  (the default; still open, no implication anything failed to happen),
  "untracked" (an explicit opt-out for requests nobody intends to follow
  up on, like a routine short-term ask), and "answered" (the one worth
  surfacing). Nowhere in the app — the admin section, the consolidated
  admin page, the public profile, or the booklet — does an open request
  get a "pending"/"unanswered" label, badge, or warning color; only
  "answered" ever gets called out, as a quiet note.
  New `backend/src/routes/prayerRequests.js` (same dual-FK,
  admin-JSON-CRUD shape as `routes/supportNeeds.js`); `maskData.js`
  curates public long-term+public requests down to just the
  request/status/answer fields (no id, category, or admin notes);
  `prisma/seed.js` generates a realistic mix (varied category/status,
  weighted toward still-open since that's what real prayer request data
  actually looks like at any given moment — this isn't a showcase of
  resolved ones).

## [1.0.21] - 2026-09-07

### Changed
- **otplib 12 -> 13.5.0**: real migration, not a drop-in bump — v13 is a
  complete rewrite that removed the `authenticator` object entirely.
  `backend/src/routes/auth.js` now calls the new functional API directly:
  `authenticator.generateSecret()` -> `generateSecret()`,
  `authenticator.keyuri(email, issuer, secret)` ->
  `generateURI({ issuer, label: email, secret })` (note the reordered,
  now-named arguments), and `authenticator.check(token, secret)` ->
  `await verify({ secret, token })`, which is now async and returns
  `{ valid, delta }` instead of a plain boolean. Verified with a real
  round-trip (generate a secret, generate a valid code for it, confirm
  `verify` accepts it and rejects a wrong one) and a full live MFA
  setup/verify-setup API test against the demo admin account.
- **multer 1.4.5 -> 2.3.0, express-rate-limit 7.5.1 -> 8.7.0, bcryptjs
  2.4.3 -> 3.0.3**: despite being major version bumps, all three turned
  out to be genuinely drop-in for how this app uses them (checked each
  library's actual breaking-change list against this codebase's specific
  usage before assuming so): multer's `fileFilter(req, file, cb)`
  callback shape and `MulterError` are unchanged; this app's
  `rateLimit({ windowMs, max })` calls don't touch any of the
  options/headers express-rate-limit v8 removed; bcryptjs 3's
  CommonJS `require()` still resolves via its package.json `exports`
  map (its main breaking change was ESM-first tooling, not the
  `hash`/`compare` API surface this app calls).

These four were the remainder of the ~19 first-run Dependabot PRs.
Closes out that backlog entirely — every dependency it flagged is now
either merged as-is or migrated for real, and the config itself
(`.github/dependabot.yml.disabled`) is tightened against a repeat pile-up
whenever it's turned back on.

## [1.0.20] - 2026-09-07

### Fixed
- **CI's `backend-tests` job failed after v1.0.19** — `npm ci`'s
  postinstall (`prisma generate`) crashed with `PrismaConfigEnvError:
  Cannot resolve environment variable: DATABASE_URL`. That job
  deliberately has no real database (pure unit tests, see
  CONTRIBUTING.md), but Prisma 7's `env()` helper in
  `backend/prisma.config.js` now throws if the variable is unset at all,
  not just if a real connection is attempted — `generate` itself never
  opens one. Added a placeholder `DATABASE_URL` to that job; found by
  actually watching the push run (Actions had just been re-enabled on
  this repo, so this is the first push to exercise `backend-tests` for
  real since the Prisma 7 migration).

## [1.0.19] - 2026-09-07

### Changed
- **Prisma 5 -> 7.10.0**. Prisma 7 removed `datasource { url = env(...) }`
  from `schema.prisma` entirely and requires a driver adapter for every
  database. The connection URL now lives in a new `backend/prisma.config.js`
  (also the new single source of truth for `prisma migrate`/`studio`/etc.
  commands), and the three places that construct a `PrismaClient`
  (`src/prismaClient.js`, `prisma/seed.js`, `prisma/createAdmin.js`) now
  pass it a `@prisma/adapter-pg` instance instead of connecting bare.
  Prisma 7 also stopped auto-loading `.env` (previously implicit
  whenever `PrismaClient` was constructed) — `createAdmin.js`, the only
  one of the three that didn't already load it explicitly, now does.
  Stayed on the `prisma-client-js` generator (deprecated in v7 but still
  functional) rather than also adopting the new Rust-free `prisma-client`
  generator, which would have meant relocating the generated client and
  touching every import site — a reasonable follow-up later, not
  necessary for this migration.
- **React 18 -> 19.2.8, react-dom 18 -> 19.2.8, react-leaflet 4 -> 5.0.0**
  (react-leaflet 5 requires React 19, so these three moved together).
  No code changes were needed — this codebase already used
  `createRoot`/functional components/hooks throughout, with no
  `PropTypes`/`defaultProps`/legacy patterns anywhere to migrate.

### Fixed
- **A real WCAG AA violation in Leaflet's own default attribution-control
  link** ("Leaflet" -> leafletjs.com, in the map's bottom-right corner):
  2.55:1 color contrast against its surrounding text (need 3:1) with no
  non-color distinguisher like an underline either. Pre-existing (not
  introduced by the React/react-leaflet bump above), just newly caught by
  a timing difference that made the e2e accessibility suite's map check
  flaky before landing on a real, always-there issue. Fixed with a
  `.leaflet-control-attribution a` override (darker link blue + underline).
- **`npm audit` surfaced 4 high-severity advisories** (`deepmerge-ts`,
  `mysql2`) pulled in transitively by the `prisma` CLI package itself —
  confirmed these are dev-tooling-only (the CLI is a devDependency,
  excluded from production installs under `NODE_ENV=production`; the
  vulnerable packages are used by Prisma's own config-merging and
  MySQL-provider support, irrelevant to this Postgres-only app's actual
  runtime). 7.10.0 is the latest stable release; no newer version fixes
  this yet — that's on Prisma's own dependency tree, not something this
  app's config can route around.

These three were the last of the ~19 first-run Dependabot PRs still open
(closes GitHub issues represented by PRs #30, #37, #29, #27, #28) —
done as real migration work here rather than merged as-is, since none of
the three were drop-in version bumps.

### Fixed
- **CI `e2e` job never installed frontend dependencies** — found the same
  way as v1.0.17's fix, by actually watching the new pipeline run for
  real against the demo repo rather than assuming the YAML was correct.
  `frontend-build` runs `npm ci` in its own isolated job; that install
  doesn't carry over to `e2e` (a separate runner — only the built
  `backend/public` artifact is shared between them), so
  `@playwright/test` was never actually installed there and the whole
  job failed at "Run e2e suite" with `Cannot find package
  '@playwright/test'`. Added the missing `cd frontend && npm ci` step.

## [1.0.17] - 2026-09-07

### Fixed
- **`npm run seed` crashed with "Region is missing" when no AWS S3
  configuration is present** — `maybeAddNewsletter`/`maybeAddDocument`
  (`backend/prisma/seed.js`) always uploaded their generated sample
  files through S3, with no fallback, unlike the Pexels photo path a few
  lines above them, which already degrades gracefully when unconfigured.
  This has been true since the Newsletter/Document features shipped; the
  new CI `e2e` job (v1.0.16) was just the first thing to actually run
  `npm run seed` in an environment with no AWS credentials at all, which
  is what surfaced it. Now skipped (with a one-time log line) when
  `S3_BUCKET_NAME` isn't set — every missionary/organization still gets
  everything else seed data normally provides, just without sample
  newsletters/documents.

## [1.0.16] - 2026-09-07

### Added
- **Full CI/CD pipeline**: closes GitHub issues #8, #12. The deploy
  workflow (`.github/workflows/backend-deploy-aws.yml`) now runs tests
  before, during, and after every deploy instead of just deploying
  unconditionally on every push to `main`:
  - `backend-tests` / `frontend-build` / a new **`e2e`** job (a committed
    Playwright suite, `frontend/e2e/` — login, admin missionary/
    organization CRUD including the country/FIPS auto-fill, the public
    directory and map, and an accessibility pass) all run on every PR and
    push, against a throwaway Postgres the `e2e` job provisions itself.
    `deploy` only starts once all three pass.
  - A new **`smoke-test`** job runs after `deploy`: waits for Elastic
    Beanstalk's health to settle to Green, then makes real requests
    against the freshly-deployed environment to confirm it's actually
    serving correctly, not just that the process is up.
  - A new **`rollback`** job runs automatically if `smoke-test` fails
    after a successful deploy: rolls the environment back to whatever was
    running immediately before, then still fails the workflow (visibly,
    not silently) so a bad release is never left live *or* invisible.
  - No new required secrets or repository variables — `smoke-test` and
    `rollback` reuse the AWS credentials and `EB_ENV_NAME` deploying
    already needed.
- **Accessibility fixes**, found via the new e2e suite's axe-core pass
  (closes GitHub issue #14): the public directory's three filter
  `<select>`s and search input had no accessible name; the map's
  scrollable partner-list panel wasn't keyboard-focusable; the admin
  sidebar's active-link highlight and the secondary-button gray
  (`.btn.secondary`) both fell short of WCAG AA's 4.5:1 text-contrast
  minimum. The active-link fix also generalizes better than the old value
  did: it now darkens (black-tinted overlay) rather than lightens
  (white-tinted) the church's configured `--brand-color`, since darkening
  reliably preserves contrast against the white nav text regardless of
  which color a church picks, where lightening could go either way.
- **Dependabot** (closes GitHub issue #9): weekly automated dependency
  updates for `backend/`, `frontend/`, and the GitHub Actions workflows
  themselves, with minor/patch updates grouped to cut down on PR noise.
- **Database backup reminder** (closes GitHub issue #11): a dismissible
  admin-dashboard notice (re-appears roughly every 90 days after being
  dismissed, not just once) pointing at
  [ADMIN_GUIDE.md § Database backups](ADMIN_GUIDE.md#database-backups) —
  tailored per-provider (Neon, Supabase, RDS recognized by
  `DATABASE_URL`'s hostname; a generic reminder otherwise). Backed by a
  new admin-only `GET /api/backup-check`
  (`backend/src/utils/backupCheck.js`), which never exposes the actual
  connection string.

### Changed
- **CONTRIBUTING.md**'s testing section now documents the e2e suite
  (how to run it locally against any running instance via
  `E2E_BASE_URL`/`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`) and corrects two
  claims that were true when written but no longer are: there is now a
  test database (in CI) and a frontend test suite.

## [1.0.15] - 2026-09-07

### Added
- **"Update available" banner** in the admin dashboard: logged-in admins
  now see a dismissible notice when their instance is running behind the
  latest tagged release on the public repo, linking straight to what
  changed — closes the gap where staying current required knowing to
  check GitHub yourself. Backed by a new admin-only `GET
  /api/version-check` (`backend/src/utils/versionCheck.js`), which
  compares `backend/package.json`'s version against the GitHub Releases
  API (cached 24h, fails silently if GitHub is unreachable — this is a
  courtesy, never something that should make the dashboard look broken).
  Dismissal is remembered per-version (`localStorage`), so dismissing
  today's notice doesn't silently suppress next month's.
  `backend/package.json`'s version is now the single source of truth for
  "what's running" — every release bumps it from here on, even a
  frontend-only change, since only `backend/` ships in the deployed
  artifact (the build workflow copies the built frontend into
  `backend/public` before zipping just `backend/`).
- **GitHub Releases**, backfilled for every existing tag (`v1.0.0`
  through `v1.0.14`) from their CHANGELOG entries — this repo had tags
  but no actual Releases, which meant the GitHub Releases API (what the
  new banner checks, and what GitHub's own "Watch → Releases only"
  notifications key off of) had nothing to return. Releases are now part
  of the regular release process alongside the version-bump commit and
  tag.

### Changed
- **UPGRADING.md** now leads with GitHub's **Sync fork** button as the
  recommended update path (no git, no terminal — a fast-forward merge
  done entirely in the browser) for any fork that hasn't directly edited
  application code, with the existing manual `git fetch`/`merge` steps
  kept as the path for private forks (that weren't created via GitHub's
  Fork button) or forks with local code changes. This is *why* the
  project stays fork-based rather than moving to GitHub's "Use this
  template" — a template-generated copy has no tracked relationship back
  to this repo, so it wouldn't get a Sync fork button at all.
- **README.md**'s Quick start now opens by telling you to fork the repo
  (and clone your fork, not this one) before the local setup steps, which
  previously assumed you already had.

## [1.0.14] - 2026-09-07

### Added
- **Country suggestions and FIPS auto-fill**: the address "Country" field
  (missionary and organization forms) is now a suggest-as-you-type input
  backed by the same ~250-name list already used for the continent
  filter/map centroids (`frontend/src/utils/countryContinents.js`) —
  still free text, so an unusual spelling or a name not in the list is
  never blocked. The "Country Code (FIPS/ISO)" field auto-fills from the
  physical address's country the moment it resolves to a recognized name,
  but only while that field is still blank — a manual entry, however it
  got there, is never overwritten. This closes the main source of wrong
  country codes: FIPS 10-4 (what this field, and the Joshua Project
  lookup it drives, actually uses) genuinely disagrees with the more
  familiar ISO 3166-1 code for many countries — the Philippines is `RP`
  not `PH`, Bolivia is `BL` not `BO`, Japan is `JA` not `JP` — so typing
  the "obvious" code was a common, silent mistake. New
  `frontend/src/utils/countryFipsCodes.js` holds the name -> FIPS lookup
  table (sourced from the FIPS 10-4 standard), covering every
  `COUNTRY_CONTINENTS` entry except three with no single clean FIPS
  mapping (Åland Islands, Caribbean Netherlands, Palestine) — those still
  work as free text, they just don't trigger auto-fill.

## [1.0.13] - 2026-09-07

### Changed
- **Consolidated duplicated missionary/organization tables into shared
  ones**: `Address`/`OrganizationAddress`, `MissionTrip`+`TripParticipant`/
  `OrganizationTrip`+`OrganizationTripParticipant`, and `SendingChurch`/
  `SendingOrg` were three separate pairs of near-identical tables, one per
  parent type — the exact duplication this codebase's own conventions
  (see [CONTRIBUTING.md § Code style](CONTRIBUTING.md)) warn against, and
  a maintenance risk long-term (a bug fix or new field applied to one side
  and forgotten on the other). All three now follow the same nullable
  dual-FK pattern already used by `SupportEntry`/`Newsletter`/`Document`/
  `ChurchVisit`: `Address` and the renamed `MissionTrip` → `Trip` gained a
  nullable `organizationId` alongside `missionaryId`, and
  `OrganizationAddress`/`OrganizationTrip`/`OrganizationTripParticipant`
  were dropped. `SendingChurch`/`SendingOrg` (a same-parent duplication,
  not a missionary/org split) were merged into one `SendingParty` table
  with a `type: "church" | "org"` column; its `mailingAddress` field was
  also converted from an unvalidated `Json?` blob into real structured
  columns (`addressLine1`, `city`, `country`, etc.) matching `Address`'s
  shape, and the API's incoming `mailingAddress` object is now
  Zod-validated instead of accepted as `z.any()`.
  The admin/public API request and response shapes are unchanged —
  responses still nest `sendingChurch`/`sendingOrg` objects, so no
  frontend code needed to change — the reshaping happens entirely in new
  `backend/src/utils/sendingParty.js` helpers shared by
  `routes/missionaries.js` and `routes/publicMissionaries.js`.
  **If you have custom fork code that queries the Prisma client directly**
  using `prisma.missionTrip`, `prisma.organizationAddress`,
  `prisma.organizationTrip`, `prisma.organizationTripParticipant`,
  `prisma.sendingChurch`, or `prisma.sendingOrg`, it will need updating to
  `prisma.trip`/`prisma.address`/`prisma.sendingParty` (with a `type`
  filter) — this is the one place this release isn't a drop-in merge.
  Run `npx prisma migrate deploy` when upgrading (see
  [UPGRADING.md](UPGRADING.md)); the migration preserves every existing
  row via renames and `INSERT ... SELECT`, not a drop-and-recreate.

## [1.0.12] - 2026-09-06

### Fixed
- **The public map didn't render at all on mobile** — closes GitHub
  issue #7. On screens ≤800px, `.map-layout` switched to a single-column
  stacked layout but dropped its explicit `height` entirely
  (`height: auto`), and the map container's `height: 100%` — which
  needs a parent with a *definite* height to mean anything — silently
  collapsed to zero. The map was present in the DOM, just invisible, no
  matter how far you scrolled. Mobile now gets an explicit `50vh` map
  (`calc(100vh - 64px)`, i.e. full height, in tour mode, which never
  shows the list alongside it) with the missionary list scrollable
  below, and the map is reordered to appear before the list — a map
  page should lead with the map. Verified with a real headless-browser
  check: the map container now measures a real, non-zero height and
  its tiles actually load, in both normal and tour mode.

## [1.0.11] - 2026-09-07

### Added
- **Generic photos for restricted-access partners**: restricted
  missionaries and organizations previously had no public photo at all
  (`photo` was simply absent from the API response) — they now get a
  plain SVG silhouette icon instead, matching their real household
  (single, couple, or family for a missionary; a generic building icon
  for an organization). Never a real photo of any kind, generic stock or
  otherwise — the whole point of `isRestricted` masking is anonymity, so
  this is a shape-only icon, same reasoning as the initials-only name and
  country-level pin it already gets. Shape-drawing code is shared with
  `prisma/seed.js`'s existing fallback avatars (extracted to
  `backend/src/utils/silhouette.js`) — seed data keeps its randomized
  colors for demo variety; real restricted partners get a fixed neutral
  color for consistency. The public partner-detail page also no longer
  wraps a restricted partner's photo in a "view full size" link, since
  that never made sense for a generic icon.

## [1.0.10] - 2026-09-04

### Added
- **Three more booklet templates**, inspired by real family-souvenir,
  photography, and "about me"-style booklet designs: **Keepsake** (a
  polaroid-framed, slightly tilted photo, a dashed-border handwritten-
  note callout, warm cream background), **Portfolio** (a large,
  near-full-width photo, a high-contrast dark cover/back-cover, minimal
  caption-style text), and **Friendly** (a bold color-block header band,
  a large circular photo overlapping it, rounded pill-style section
  labels). Same pattern as the original three — pure CSS additions
  (`.tpl-keepsake`/`.tpl-portfolio`/`.tpl-friendly` in
  `frontend/src/styles/booklet.css`), no changes to the shared content-
  generation code. Six templates total now.

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
