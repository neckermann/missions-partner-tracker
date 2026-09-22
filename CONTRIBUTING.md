# Contributing

Thanks for taking a look at this project. It's built for churches to fork
and run their own instance of — not a shared hosted service — so
contributions are welcome for anything that makes the app more generally
useful, but changes specific to one church's own setup belong in that
church's fork, not here.

Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

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
required. Coverage is intentionally focused on logic that's risky to get
wrong silently: the public/restricted data-masking rules
(`backend/test/maskData.test.js`) and the auth middleware
(`backend/test/requireAuth.test.js`). Routes that hit Prisma directly
(login, user management, missionary/organization CRUD, etc.) aren't
covered by these unit tests — that's what the e2e suite below is for.

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
cd frontend && npx playwright test                    # e2e, in another
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

## Code style

- No enforced linter/formatter currently — match the style of the
  surrounding file.
- Comments should explain *why*, not *what* — the existing codebase leans
  on this heavily (e.g. why a field is masked a certain way, why a route
  requires one role vs. another). If you can't explain why a change works
  the way it does in a sentence, that's worth a comment; if the code is
  self-explanatory, skip it.
- Prefer extending existing patterns over introducing new ones. For
  example, a new record type that can support a missionary or an
  organization should probably follow the existing nullable dual-FK +
  CHECK-constraint pattern used by `SupportEntry`/`Newsletter`/`Document`/
  etc. (`backend/prisma/schema.prisma`), not a new join table shape.

## Extending the data model

The Prisma schema (`backend/prisma/schema.prisma`) covers missionaries,
organizations, adults/children, sending church/org, addresses, support
tracking, trips, furlough/church visits, prayer requests, newsletters,
documents, and church-wide settings. To add a new field or section, extend the schema,
the Zod validation in the relevant route, and the admin form together —
grep for an existing similar field (e.g. `tripSeasonNotes`) to see the
full path a field takes from database to admin UI to public display.

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

## Dependencies

Updates are applied by hand, by whoever is doing the work, rather than by a
bot. There is no `dependabot.yml`, and that is deliberate — see below.

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

## Pull requests

- Keep PRs focused — one feature or fix per PR.
- If your change affects `backend/.env.example`, update it in the same PR,
  including a comment explaining any new variable.
- If it affects deployment (`.github/workflows/`, `backend/.platform/`),
  call that out explicitly in the PR description, since it's the part of
  the repo hardest to test outside a real deploy.
