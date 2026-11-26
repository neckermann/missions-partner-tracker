# Contributing

Thanks for taking a look at this project. It's built for churches to fork
and run their own instance of — not a shared hosted service — so
contributions are welcome for anything that makes the app more generally
useful, but changes specific to one church's own setup belong in that
church's fork, not here.

Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

Found a security vulnerability? See [SECURITY.md](SECURITY.md) instead of
opening a public issue.

## Before you start

For anything beyond a small fix, open an issue first describing what you
want to change and why. It saves you writing a PR that doesn't fit the
project's direction.

## The one rule that matters most: keep forks upgradable

Every church that runs this app has their own fork (see
[UPGRADING.md](UPGRADING.md) for why), and they pull in new releases by
merging this repo into theirs. That only stays a clean, conflict-free merge
if application code never hardcodes anything specific to one church —
name, logo, colors, terminology, wording. Those all belong in the
`ChurchSettings` database record (configured through the admin UI), not in
a `.jsx` file or a CSS constant.

So: if you're adding something a church would plausibly want to
customize, add a field to Church Settings for it rather than hardcoding a
value, even if you're only trying to fix it for your own church today.
That's what keeps everyone's fork able to pull in your fix later.

The same goes for starter content: don't ship example questions, menus, documents or wording as
defaults in code. Put them in an importable **template pack** under
[`examples/template-packs`](examples/template-packs/README.md) (a new install starts empty and imports
what it wants), so a fork never has to edit or merge around one church's words.

This extends to per-instance secrets, not just branding. Anything a church
configures for itself belongs in the database (encrypted at rest where it's
a secret — see `backend/src/utils/crypto.js`), not in an env var. Setting
something up through the admin UI shouldn't require touching a hosting
platform's env config or redeploying; an env var would force that. Prefer
the same for any future integration that needs its own per-instance
credential.

## Single-origin architecture — don't add cross-origin support

The backend serves the built frontend directly
(`backend/src/server.js`'s static-file serving) — there is exactly one
deployable origin, and every URL in the app is a plain relative path
(`/api/...`, `/admin`, etc.), never a hand-built absolute one. Session
auth is an `httpOnly` cookie, which only works cleanly because of this —
splitting the frontend and backend across different domains would force
a less secure fallback (a token exposed to client-side JS instead of a
cookie client-side JS can't read at all).

If you're tempted to add a way to split frontend/backend hosting (a
`VITE_API_URL`-style override, a CORS allow-list, etc.), raise it as an
issue first rather than sending a PR — it touches the auth model, not
just config, and a same-origin-relative URL written anywhere in the app
would silently break the moment that assumption stopped holding.

## Local setup

See [ADMIN_GUIDE.md § Local development setup](ADMIN_GUIDE.md#local-development-setup)
for getting the backend and frontend running locally.

## Running tests

```bash
cd backend
npm test
```

Tests use Node's built-in test runner (`node:test`) — no extra dependencies
required. There are two backend suites:

- **Unit tests** (`backend/test/*.test.js`, about 50 files, `npm test`): masking,
  auth middleware, the schedulers' pure logic and so on. Most need no database;
  about a dozen import the database client and want `DATABASE_URL` set.
- **Route tests** (`backend/test/routes/*.test.js`, about 85 files,
  `npm run test:routes`): each boots the real app on a free port and talks to it over
  HTTP against a real Postgres. They create and delete real rows, so use a throwaway
  database (see below). They need, besides `DATABASE_URL`: `NODE_ENV=test` (otherwise
  the sign-in rate limits are the production ones and dozens of tests fail with 429),
  `APP_BASE_URL` (for example `http://localhost:3001`; without it about 15 tests that
  build links fail), `SESSION_SECRET`, and `FIELD_ENCRYPTION_KEY` (`npm run
  generate-secrets` prints both).

### End-to-end tests (`frontend/e2e/`)

A [Playwright](https://playwright.dev) suite covering the flows unit
tests can't reach: admin login, creating/editing a missionary and an
organization (including the country/FIPS auto-fill), the public
directory and map, and an accessibility (axe-core) pass on the
public-facing pages and the admin dashboard. This is what
`.github/workflows/ci.yml`'s `e2e` job runs on every PR and push to
`main`, against a fresh Postgres service container it provisions
itself — not your local or demo database.

**The quickest way to run everything locally** is a throwaway database in
Docker — the same `postgres:16` image CI uses, on port 5433 so it can't
collide with a Postgres you already have:

```bash
npm run test:db up          # starts it, migrates, seeds, creates an admin
```

It prints the `DATABASE_URL` to put in `backend/.env`. Then:

```bash
cd backend  && npm run test:routes                    # route tests
cd backend  && NODE_ENV=test node src/server.js       # serve, in one terminal
cd frontend && npm run test:e2e                       # e2e, in another
npm run test:db down                                  # delete it and its data
```

Use this rather than pointing the suite at a database you care about. The
tests create and delete real users and partners — including enrolling and
disabling two-factor — so running them against a live instance is a bad
afternoon. `NODE_ENV=test` also relaxes the login rate limiter, which a
full run would otherwise trip.

If you'd rather not use Docker, any Postgres 13+ works; nothing here is
Docker-specific. You can also point the suite at an already-running
instance via env vars:

```bash
cd frontend
npx playwright install --with-deps chromium  # one-time
E2E_BASE_URL=http://localhost:4000 \
E2E_ADMIN_EMAIL=you@yourchurch.org \
E2E_ADMIN_PASSWORD=YourPassword \
npm run test:e2e
```

`E2E_BASE_URL` must point at the backend directly (it serves the built
frontend too — see [README.md § Tech stack](README.md#tech-stack)), not
the Vite dev server, since these tests exercise the whole app the way a
real deployment does. If you're adding a new page or admin flow, adding
e2e coverage for it is welcome, but not required for every PR — use your
judgment on what's worth the added CI time.

**A spec that changes feature flags or trip settings** (`ChurchSettings.enabledFeatures`
is one shared column, and `PUT /api/settings` replaces it whole) must go in
`FEATURE_SPECS` in `frontend/playwright.config.js` and use `setFeatures` /
`restoreFeatures` from `e2e/helpers.js`, which merge and put back what they changed.
Those specs run in their own project with one worker, after the rest; two at once
lose each other's updates. That is why `npm run test:e2e` runs two commands, and why
a bare `npx playwright test` is not the same thing.

## Local development data

Beyond the automated suites above, a feature is worth hand-reviewing in a
browser before calling it done — against a throwaway local database
seeded with realistic fixture data (`cd backend && npm run seed`), not a
bare minimal record or two. Realistic data is what actually surfaces
layout and edge-case problems a single hand-typed fixture won't.

**Standing hazard**: the same local database doubles as the automated
test suite's own database when you point `DATABASE_URL` at it (see
[Running tests](#running-tests) above). Fixtures left over from manual
clicking-through — a prayer request, a public subscriber, a
`DispatchRecord` row — can silently break a test that assumes an
empty or isolated table. Clean up anything you added for manual review
once you're done with it, or reset the database (`npm run test:db down`
then `up` again, or `npx prisma migrate reset --force`) before running
the suite.

## Code style

- `.github/workflows/ci.yml`'s `lint` job enforces `eslint --quiet`
  (errors only — warnings are a deliberate to-do list, see that job's
  own comment) and `prettier --check .`. Run `npx eslint .` and
  `npx prettier --write .` before pushing rather than finding out from
  CI. Where neither tool has an opinion, match the style of the
  surrounding file.
- **Comments explain why, never history.** Keep a comment only when a
  reader can't get the point from the code and its names: a non-obvious
  reason, a constraint, a workaround for a real quirk, security or
  privacy reasoning a later change could undo (why a value is masked, why
  a check must stay), a rule that comes from outside the code (a format,
  a database behaviour, a limit), or a warning about something that looks
  wrong but is intentional. Don't write what the code already says, what
  it used to be, why it changed from one approach to another, or which
  issue prompted it: that story belongs in the commit message, the pull
  request and the issue, where it can't go stale. Don't leave
  commented-out code. Where a rule is already written in SPEC.md or a
  guide, point at it in one line instead of repeating it. In
  `schema.prisma`, comment a column when its meaning, units, allowed
  values or privacy rule isn't clear from its name, not to repeat the
  name.
- Prefer extending existing patterns over introducing new ones. For
  example, a new record type that can support a missionary or an
  organization should probably follow the existing nullable dual-FK +
  CHECK-constraint pattern used by `SupportEntry`/`Newsletter`/`Document`/
  etc. (`backend/prisma/schema.prisma`), not a new join table shape.
- **No `window.confirm()`, `confirm()`, or `prompt()` for anything a user
  sees.** Use `frontend/src/hooks/useConfirmDialog.jsx` instead — a
  styled, accessible dialog built on the app's own `Modal.jsx`, not the
  native browser alert. Same call shape as `window.confirm`
  (`if (!(await confirmDialog({...}))) return;`), so converting an
  existing one is usually a small, local change. Reach for
  `ConfirmMessageBody` (`frontend/src/components/ConfirmMessageBody.jsx`)
  for a plain one-sentence confirmation (a delete, a discard), and the
  hook's own `typedConfirmation` option for the rare action that should
  require typing a word back, like permanently deleting a partner — don't
  reach for `prompt()` for that either. If the new confirmation is itself
  already rendered inside another `Modal` (editing something in a dialog
  that then needs its own confirm step), don't nest a second `Modal` —
  two `Modal` instances each register their own document-level Escape
  listener, and neither's `stopPropagation()` stops the other's handler
  from also firing, so Escape closes both at once. Confirm inline as a
  second step of the same dialog instead; see
  `components/admin/DispatchReviewModal.jsx` for the pattern.
  Destructure the hook's function as something other than bare `confirm`
  (e.g. `confirmDialog`) — the native global of the same name is exactly
  what it replaces, and shadowing it in a file that still has another use
  of the real one is an easy, silent bug.

### Phone-width checklist

People use this app on a phone, especially church members with a guest
login and care team members. Before you open a pull request that adds or
changes a page, a table, a form or a dialog, look at it at 390px wide and
check that:

- nothing scrolls sideways, and nothing is pushed past the screen edge (a
  long unbroken URL or a wide table is the usual cause: wrap it, or put the
  table in `.table-scroll`);
- buttons and links are comfortable to tap, and action buttons in a table
  don't wrap onto two lines;
- dropdowns, popups and the notification bell open on screen;
- the page still reads in dark mode as well as light (use theme tokens such
  as `var(--text)`, `var(--muted)` and `var(--surface)`, never a hardcoded
  grey or white).

`frontend/e2e/mobile-layout.spec.js` walks the main admin pages at 390px
and fails on sideways scrolling or anything off the edge; add a new page to
it when you add one.

## Email paths need an email-off option

Email (Sending) is optional, and a church should be able to run the app without it. Any code that sends an email
must say what the person gets when email is off, never silently do nothing. The options:

- **handOver**: show the link or text to copy and pass on (`ManualSendNotice`, `CopyButton`).
- **inApp**: it still appears somewhere the person already looks (the bell, My partners, Updates to share).
- **download**: a file or printable view covers it.
- **disabled**: the control is disabled or the route refused, and the reason says what to turn on.
- **setup**: it only exists while email is being set up, so "off" can't happen.

Register the file in `backend/src/utils/emailSenders.js` with its option and a one-line note. `test/emailSenders.test.js`
fails when a file that requires `utils/email` isn't listed there. If a feature's emails matter to people, add a
`withoutEmail` line to its entry in `backend/src/utils/features.js`; Enabled Features shows it ("Without email: ...").

## Extending the data model

The Prisma schema (`backend/prisma/schema.prisma`) covers missionaries,
organizations, adults/children, sending church/org, addresses, support
tracking, trips, furlough/church visits, prayer requests, newsletters,
documents, and church-wide settings. To add a new field or section, extend the schema,
the Zod validation in the relevant route, and the admin form together —
grep for an existing similar field (e.g. `tripSeasonNotes`) to see the
full path a field takes from database to admin UI to public display.

Two rules for new models and lists (see
[ARCHITECTURE.md § Cross-cutting pieces](ARCHITECTURE.md#cross-cutting-pieces-you-will-meet)):

- **A new editable model needs the three `lastEditedById`,
  `lastEditedByName` and `lastEditedAt` columns.** The Prisma extension
  stamps them for you on every write in a signed-in request; without the
  columns the record never shows "Last edited by".
- **Use real columns, not `Json`, for anything with a fixed shape (#394).**
  A list of plain strings is a `String[]` column; an ordered list of
  structured items an admin edits (questions, checklist entries) is a child
  table with a `position` column, and the API can still send and receive it
  as an ordered array (see `backend/src/utils/tripTemplates.js`). `Json` is
  acceptable only when the shape genuinely varies per record, it is read and
  written whole, and nothing filters, sorts or reports on what is inside it:
  `AuditLog.details`, `SavedReport.params`, `NotifiableEvent.payload`, and
  `ChurchSettings.enabledFeatures` (so a fork adds a feature flag without a
  migration). Say why in a comment on the column. Don't store JSON or
  comma-separated values in a `String` column either.
- **A new list about partners, or about things that belong to a partner,
  takes the `sendingChurch` filter** (`withSendingChurch` in
  `backend/src/utils/sendingChurch.js`, and the shared `FilterBar` field),
  so "filter by church" works the same on every page.

## Database migrations

Update `schema.prisma` first, then run
`npx prisma migrate dev --name your_migration_name` from `backend/` to
generate the actual SQL — don't hand-write a migration folder yourself,
that's how the timestamp prefix and Prisma's own migration bookkeeping
stay correct. If your change needs more than the schema diff (backfilling
a new column, a one-time data transformation), hand-add that SQL to the
generated file afterward. Mention in your PR that it needs
`npx prisma migrate deploy` (or the equivalent for whoever's running it)
— there's no CI step that applies migrations automatically.

## Branches and releasing

`main` is production. Render tracks this repo's default branch and deploys
on push, so **a merge into `main` is a release**, not a checkpoint.

Every church that used the "Deploy to Render" button follows `main` directly, so
a merge into `main` also redeploys **every one of those installs**. Before 1.0,
a release that edits the baseline migration makes each of them refuse to start
until its database is reset (see
[UPGRADING.md](UPGRADING.md) and [RUNBOOK.md](RUNBOOK.md)): do that only
deliberately, and say so at the top of that release's `CHANGELOG.md` entry.

Work therefore lands on `dev` and ships through a pull request:

```
git switch dev
git pull
# ... work, commit ...
git push origin dev
# bump backend/package.json + frontend/package.json to the release version
gh pr create --base main --head dev    # CI runs here
# four checks go green, then merge -> Render deploys
# merging creates the tag and GitHub Release by itself (.github/workflows/release.yml)
```

The version bump happens **in the `dev` → `main` PR itself**, not as a
separate follow-up — see
[WORKFLOW.md § 3](WORKFLOW.md#3-pr-dev--main). `versionCheck.js` reads
`backend/package.json` as the source of truth for "what's currently
deployed" and compares it against the latest tagged Release, so a
release that skips the bump makes that comparison wrong immediately.
`.github/workflows/release-version-check.yml` catches a tag/version
mismatch after the fact (it can't block the tag itself, only fail
loudly once pushed) — this exists because both existing releases,
`v1.0.0` and `v1.1.0`, shipped without the bump and nothing caught it
(see [issue #277](https://github.com/neckermann/missions-partner-tracker/issues/277)).

CI runs on the **pull request**, and only there. Nothing runs on a plain
push, so open the PR early — a draft still runs the checks — rather than
pushing and waiting for a run that isn't coming. That single trigger is
deliberate: see the comment at the top of
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) for why pushes to
`dev` and `main` used to run too, and what each of those was duplicating.

### Versioning (the pre-1.0 beta track)

Until 1.0 the project is on a **beta track**, so the number moves in small
steps and means something:

- **`0.MINOR.PATCH`, with betas written `0.MINOR.0-beta.N`.** The version
  restarted at `0.1.0-beta.1` in November 2026; the numbers in the
  CHANGELOG's *Earlier releases* section (0.2.0 to 0.7.0) are history, not
  part of this sequence.
- **A new beta** (`0.1.0-beta.2`, `beta.3`, …) is a deliberate cut of `dev`
  into `main` while the batch of work isn't ready for forks. Cut one when you
  want production (the demo) updated, not on every merge.
- **A minor release** (`0.1.0`) is a batch that is ready for forks: drop the
  `-beta.N`. The next batch starts at `0.2.0-beta.1`.
- **A patch** (`0.1.1`) is a fix after a stable release.
- **`1.0.0` is a decision, not a counter.** It is the point where the
  pre-1.0 migration squash ends and an upgrade never needs a database reset
  (see [SPEC.md § 8.3](SPEC.md#83-migration-strategy-pre-10)). Until then a
  release that changes the baseline says so under *Upgrading* in the
  CHANGELOG.
- **Order** follows SemVer: `0.1.0-beta.2 < 0.1.0-beta.10 < 0.1.0 < 0.1.1 <
  0.2.0-beta.1`. `versionCheck.js` implements it, so an instance running a
  beta is told to update once its final release is out, and not before.

Tagging is automatic. When `main` changes,
[`.github/workflows/release.yml`](.github/workflows/release.yml) reads the
version from `backend/package.json` and, if there is no release for it yet,
creates the tag and the GitHub Release (generated notes). A beta is marked
**pre-release**, so GitHub's "latest release", which the in-app update banner
compares against, stays on the last stable one. If the version didn't change
it only warns, since that push wasn't a new release.

### Feature branches for larger work

A small, single-commit fix can work directly on `dev` as shown above.
For anything bigger — several commits, something you'd rather CI
checked before it lands on `dev` at all — branch off `dev` instead:

```
git switch dev && git pull
git switch -c feature/your-feature-name
# ... work, commit ...
git push origin feature/your-feature-name
gh pr create --base dev --head feature/your-feature-name   # CI runs here too
# merge into dev once green, then continue dev -> main as above
```

`ci.yml` already triggers on a pull request targeting *either* `main`
or `dev` (`on: pull_request: branches: [main, dev]`), so this gets the
same four-check gate with no change to CI needed. The concrete reason
to bother: `dev-test` (Render's pre-prod service — see
[RUNBOOK.md](RUNBOOK.md)) auto-deploys on every push to
`dev`. Pushing a multi-commit feature straight to `dev` leaves dev-test
broken or half-finished between commits until the feature's done; a
feature branch keeps `dev` — and dev-test — always reflecting a
complete, CI-passed state.

`main` is protected on this repo: no direct pushes, and `lint`,
`backend-tests`, `frontend-build` and `e2e` must all pass before a PR can
merge. No approving review is required — this is a one-maintainer project
and GitHub won't let you approve your own PR, so demanding one would block
every release.

If you ever genuinely need to push straight to `main` — a hotfix while CI
is broken, say — turn the rule off in Settings → Branches, push, and turn
it back on. That is a deliberate, visible act rather than a silent bypass,
which is the point.

### Downstream instances

A church's own fork takes releases by merging this repo (see
[UPGRADING.md](UPGRADING.md)), and that merge should land on **its** `dev`
first, not straight onto the branch its site deploys from:

```
git switch dev
git fetch upstream
git merge upstream/main
git push origin dev
gh pr create --base main --head dev    # CI runs against your instance
```

Branch protection needs a paid GitHub plan on a private repository, so a
private instance can't *enforce* this. The flow still works and CI still
runs on the pull request; nothing but discipline stops a direct push. The
gate is worth keeping anyway — it is the last point where a bad upstream
release can be caught before a congregation sees it.

## Map tiles and OpenStreetMap's usage policy

The public map draws its basemap from OpenStreetMap's tile servers, which
are donated infrastructure governed by a
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
Breaking it gets an instance blocked by IP, which looks like a map with no
land on it and gives no error anywhere you'd think to look. These are the
parts the code has to keep holding up:

- **One host, never `{s}` subdomains.** `https://tile.openstreetmap.org/...`.
  The rotating `a`/`b`/`c` subdomains are deprecated, and they exist to open
  more parallel connections than one host allows — the policy names that
  directly. This app used them for months.
- **Don't strip the Referer.** A browser won't let a page set its own
  User-Agent, so the Referer is the only thing telling OSM whose map this
  is. `helmet`'s default `Referrer-Policy: no-referrer` makes every tile
  request anonymous and is prohibited outright. `server.js` sets
  `strict-origin-when-cross-origin`, which sends the site's origin and
  never a path, so no partner ID leaks.
- **Attribution stays visible.** "© OpenStreetMap contributors", on the map,
  not behind a toggle. Leaflet's attribution control does this; don't hide it.
- **Only fetch what someone is looking at.** No pre-seeding, no offline
  archives, no walking zoom levels. The auto-tour is the one feature that
  fetches tiles unattended, which is why `tourSeconds` has a floor.
- **Let the browser cache.** Don't add no-cache headers to tile requests.

`backend/test/tileCsp.test.js` pins the first two, plus the agreement
between the tile hosts and the CSP `img-src` allowlist.

**If OSM blocks your instance anyway**, the map falls through to the next
entry in `TILE_SOURCES` per visitor rather than showing nothing — OSM
blocks by network, so this is per-person, not per-deployment. A church
expecting real traffic should point `TILE_SOURCES` at a provider it pays
for, rather than leaning on donated capacity.

## Dependencies

Updates are applied by hand, by whoever is doing the work, rather than by a
bot. `.github/dependabot.yml` exists only to surface vulnerability
*alerts* (see the second standing note below) — it has no
`open-pull-requests-limit` of 0, but the project's convention is to
ignore any PR it opens and take updates by hand instead, for the
reason below.

**Downstream forks take updates by merging this repo, not by bumping their
own packages.** A church's fork pulls in a release by merging upstream (see
[UPGRADING.md](UPGRADING.md)). If that fork also runs its own dependency
bot, the two sources fight over the same `package-lock.json` and every
upstream merge becomes a conflict to resolve by hand — for a dependency the
fork never chose and doesn't care about. Keeping the lockfile a
single-writer file, written here, is what keeps those merges clean. This is
the same principle as the fork rule above, applied to dependencies.

That was also the practical problem with running a bot here: automated PRs
each rewrite the lockfile, so merging one invalidates the next one's diff,
and a batch of them turns into a merge-conflict cascade. Grouping them into
one PR per ecosystem trades that for a different failure — one genuinely
breaking major blocks everything grouped with it.

To take updates, from `backend/` and `frontend/`:

```
npm outdated          # what has moved
npm update            # in-range updates
npm install pkg@x.y.z # a major, one at a time, with the changelog open
```

Then run the full suite (see [Running tests](#running-tests)) before
committing. Majors get their own commit so a revert is a one-liner.

### Two standing notes — please read before "fixing" either

**`npm audit` reports 4 high-severity advisories in `mysql2`.** It reaches
the tree through `@prisma/client` → `prisma` → `mysql2`. Both advisories
require an open connection to a MySQL server; this app's datasource is
`postgresql`, it connects through `@prisma/adapter-pg`, and `mysql2` is
never loaded at runtime (verified: zero mysql modules in `require.cache`
after booting the app). It ships but never executes.

`npm audit fix --force` "resolves" it by **downgrading** prisma from 7.x to
6.19.3 — a breaking change, backwards, to patch something unreachable.
Don't run it. The real fix arrives with Prisma 8, a release candidate as of
this writing; take it once it's stable.

**There is deliberately no `npm audit` step in CI.** With the above standing
permanently, it would be permanently red, and a check that's always red is
one people stop reading. Watch GitHub's own Dependabot *alerts* instead —
those report vulnerabilities without opening pull requests, which is the
half of Dependabot that's useful to a project shaped like this one.

## Documentation screenshots

`docs/index.html` (the public marketing/docs site), `USER_GUIDE.md`, and
`ADMIN_GUIDE.md` all embed real screenshots from `docs/assets/screenshots/`.
They need to look like one continuous product, not a patchwork of
differently-seeded test runs — so there's a fixed identity to capture
against, established by the existing screenshots (see
`admin-partner-detail.png`) and never deviated from:

- **Church name: `Hillside Community Church`.** Set it on `ChurchSettings`
  (`churchName`) before capturing anything with the admin sidebar/header
  visible. This is a documentation-only fixture identity — distinct from
  the separate live public demo site's own branding (`churchName:
  "Missions Partner Tracker Demo"`), which exists for visitors trying the
  app, not for screenshots.
- **Real seeded partners, never bare throwaway fixtures.** Run
  `cd backend && npm run seed` first (pulls real stock photos from Pexels
  for every missionary/org) and capture against partners that already
  exist in that seed, rather than creating a new minimally-filled
  `POST /api/partners` fixture with no photo for a one-off screenshot — a
  gray silhouette placeholder and an obviously-synthetic name
  ("Screenshot Fixture Partner") don't belong in shipped documentation.
  Where a screenshot needs a specific supporting fact the random seed
  might not produce (a particular country for a Joshua Project panel, a
  trip with specific dates), query for a seeded partner that already
  fits, or add data (a trip, a prayer request) to an existing seeded
  partner rather than inventing a new one.
- **Never capture against the live production demo site.** It's for
  visitors, not a documentation scratch pad — don't leave test trips,
  partners, or settings changes on it.
- **Mock external APIs the same way the test suite does**, not a real key
  — see `test/routes/joshuaProject.test.js`'s `mockJoshuaProject` pattern
  for the technique (monkey-patch `global.fetch` before requiring
  `src/server.js`, matching only requests to the external host).
- **Restore afterward.** Any `ChurchSettings` field you changed
  (`churchName`, `enabledFeatures`, a dummy API key), any trip/prayer
  request/etc. you added to a seeded partner, and any throwaway admin
  account created for the capture — all of it gets cleaned up in the same
  script, the same way the existing test suites restore their own
  fixtures. The capture script itself is throwaway (`*.tmp.mjs` in
  `frontend/e2e/`, matching the ad hoc verification scripts used
  elsewhere in this repo) — run it, verify the output, delete it; it's
  not meant to be committed.
- **Update every surface that's stale, not just one.** A UI change
  touching a screenshot shared across `docs/index.html`, `USER_GUIDE.md`,
  and/or `ADMIN_GUIDE.md` means recapturing it once and confirming every
  reference to that file still matches, as part of the same PR that
  changed the UI — not a follow-up to get to later.
- **A nav or sidebar layout change means retaking essentially every
  sidebar-visible screenshot, not just the pages that obviously relate to
  what changed.** The sidebar (or top nav) appears in nearly every admin
  screenshot, so a single added/removed/renamed nav entry makes all of
  them stale at once, even ones for pages you didn't touch.
- **Capture at a fixed viewport, not `fullPage`,** and keep each page's
  own documented dimensions consistent across recaptures — a screenshot
  that's a different height/width than its last version is a visible
  regression in the docs even when the content itself is correct.
- **Dismiss or disable the backup-reminder banner before capturing
  anything with the admin header visible** — it's real, dynamic app
  chrome (see `BackupReminder.jsx`), not fixture data, and it isn't part
  of the product surface these docs are meant to show.
- **Before publishing a batch, check every capture for leaked
  identity**: the signed-in-as indicator, any user list, and any real API
  response visible on screen must never show the live demo's own
  `demo@missionspartnertracker.com` admin account or any email domain
  other than this fixture's own (see the church-name rule above) — those
  belong to the separate public demo deployment, not to documentation.

## Hardcoded links into the docs site

Several places in the app link directly to a specific section of
`ADMIN_GUIDE.md`/`USER_GUIDE.md`, rendered at
`missionspartnertracker.com/admin-guide.html`/`user-guide.html`
(`docs/assets/guide.js` reimplements GitHub's own heading-slug
algorithm specifically so these `#anchor` fragments resolve the same
way there as they do on GitHub's own rendered view of the `.md` file —
see that script's own comment). **Renaming, removing, or demoting a
linked heading changes its anchor and silently breaks every link
below** — run `npm run check:docs` after touching one of these
sections: it checks every link of this kind in the app's source, plus
every internal link and `#anchor` in the markdown, and CI runs it too.

Current links, by anchor:

| Anchor | Linked from |
|---|---|
| `admin-guide.html#database-backups` | `frontend/src/components/admin/BackupReminder.jsx`, `frontend/src/pages/AdminSystemInfo.jsx` |
| `admin-guide.html#email-postmark` | `frontend/src/pages/AdminSettingsEmail.jsx` |
| `user-guide.html` (no anchor) | `backend/src/utils/welcomeEmails.js` (`USER_GUIDE_URL`) |
| `user-guide.html#understanding-your-role` | `backend/src/utils/welcomeEmails.js` (`GUEST_GUIDE_URL`) |
| `user-guide.html#your-account-settings` | `backend/src/utils/welcomeEmails.js` (`MFA_HELP_URL`) |

Keep this table current when you add, move, or remove one of these
links — it's the one place meant to answer "what actually points at
this heading" without a repo-wide grep.

## Standing conventions across sessions

This project's actual day-to-day conventions — which corrections have
already been made once and shouldn't need making again, which decisions
were deliberate rather than oversights — are worth keeping somewhere
durable rather than only in one person's head or one session's context.
Whatever tool you use for that (a notes file, a project wiki, an
assistant's own persistent memory), the idea is the same: consult it
before repeating a judgment call this project has already made, and add
to it when you make a new one worth not re-litigating. This document is
the project-level home for conventions specific enough to write down
once and reference — like the screenshot-capture rules above — rather
than a session-scoped note that only one person or one tool ever sees
again.

For conventions specific to an AI agent working in this repo rather
than a human contributor (git/commit hygiene an agent needs that a
person doesn't, CI-polling cadence, approval gates for autonomous
action), see [AGENTS.md](AGENTS.md) instead — that's the concrete
answer to "whatever tool you use for that" for agent-specific
knowledge.

## Pull requests

- Base them on `main` and raise them from `dev` (see
  [Branches and releasing](#branches-and-releasing)) — merging is what
  deploys.
- Keep PRs focused — one feature or fix per PR.
- If your change affects `backend/.env.example`, update it in the same PR,
  including a comment explaining any new variable.
- If it affects deployment (`.github/workflows/`, `backend/.platform/`),
  call that out explicitly in the PR description, since it's the part of
  the repo hardest to test outside a real deploy.
- If your change is visible in the UI or changes behavior, check whether
  `USER_GUIDE.md`, `ADMIN_GUIDE.md`, or `docs/` need updating in the same
  PR — not as a follow-up. Stale docs (an old model described as current,
  a removed button still documented, a screenshot that no longer matches)
  are easy to miss until a reader hits them; catching staleness at review
  time is cheaper than finding it later.
