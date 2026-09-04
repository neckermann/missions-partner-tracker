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

This extends to per-instance secrets, not just branding — `SsoProvider`
(`backend/prisma/schema.prisma`) stores each configured identity
provider's client secret in the database (encrypted at rest, see
`backend/src/utils/crypto.js`), not as an env var. A church adding an SSO
provider through the admin UI shouldn't need to touch their hosting
platform's env config or redeploy at all; an env var would force that.
Prefer the same for any future integration that needs its own
per-instance credential.

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
(`backend/test/requireAuth.test.js`). There's no test database setup yet,
so routes that hit Prisma directly (login, user management, etc.) aren't
covered — if you're adding tests for those, or setting up a test DB, that's
a welcome contribution.

There's no test suite for the frontend yet either.

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
tracking, trips, furlough/church visits, newsletters, documents, and
church-wide settings. To add a new field or section, extend the schema,
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
generated file afterward — see
`backend/prisma/migrations/20260901000000_add_sso_provider/migration.sql`
for an example that does both. Mention in your PR that it needs
`npx prisma migrate deploy` (or the equivalent for whoever's running it)
— there's no CI step that applies migrations automatically.

## Pull requests

- Keep PRs focused — one feature or fix per PR.
- If your change affects `backend/.env.example`, update it in the same PR,
  including a comment explaining any new variable.
- If it affects deployment (`.github/workflows/`, `backend/.platform/`),
  call that out explicitly in the PR description, since it's the part of
  the repo hardest to test outside a real deploy.
