# Operating the live demo

This folder holds the operational details for the one live public demo
(`missions-partner-tracker.onrender.com`) -- not the generic one-click
"Deploy to Render" blueprint any church uses to self-host their own
instance (that's `/render.yaml` at the repo root). It exists purely so
this information survives in version control instead of living only in
the Render dashboard or a maintainer's own machine.

- **`.env`** (gitignored, real secrets) -- the env vars `backend/scripts/
  reset-demo-db-remote.js` needs to recover the live demo database
  directly from a local machine, plus the same integration keys
  (GroupMe, Postmark, Pexels, etc.) `reset-demo-data.js` restores into
  `ChurchSettings` on every reset. Never commit this file -- `.gitignore`
  already excludes every `.env`/`.env.*` anywhere in the repo.
- **`render.yaml`** -- the demo's own Render Blueprint: the production
  web service, the background worker (#271 Phase B -- schedulers and the
  WhatsApp connection, split out of the web service), plus the nightly
  reset cron job, including the four demo-only env vars
  (`DEMO_RESET_TOKEN`, `DEMO_ADMIN_EMAIL/PASSWORD`, `PEXELS_API_KEY`) that
  must never appear on a real church's instance -- all four stay on the
  web service only, the worker needs none of them. Record-keeping only
  right now -- Render isn't actively syncing from this file; it's what to
  restore from if the demo's services were ever deleted and had to be
  rebuilt.

## Guest logins visitors can try

Besides the admin login (`DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD`), every
reset seeds two **published guest logins** so a visitor can see what a care
team member and a trip leader get. They are created by `seedCareTeamsDemo()`
in `backend/prisma/seed.js`:

| Login | Password | What they see |
|---|---|---|
| `care.member@example.org` | `DEMO_GUEST_PASSWORD` (default `TryTheGuestDemo2026!`) | Four partners they're on the care team for: the same partner page an editor has minus monthly funding, their own prayer requests and one-time needs (no decisions), Newsletters & Docs, and a read-only view of those partners' trips. What they enter is saved but held in Pending Dispatches until the admin approves it. |
| `trip.leader@example.org` | same | One upcoming trip they manage, plus its partner read-only. No needs, no money. |

These are the **only** accounts with two-factor off (`mfaSetupRequired:
false`): a shared, published account can't enrol an authenticator without
locking every other visitor out. Every other guest the seed creates (for
example the lapsed `sam.okafor@example.org`, who exists to populate the
"Inactive accounts only" filter) keeps the normal rule -- two-factor required
-- and has a password nobody is told. Set `DEMO_GUEST_PASSWORD` in the demo's
environment to change the published one; never reuse it anywhere real.

## Recovering after a migration squash

This project's pre-1.0 convention squashes every schema change into one
baseline migration before it ships (see `CONTRIBUTING.md`). Squashing
replaces the migration folder(s) on disk with new ones the live demo's
own `_prisma_migrations` table has no record of, so the next deploy's
`preDeployCommand` (`prisma migrate deploy`) fails -- expected, not a
sign anything is broken. Render doesn't cut over on a failed pre-deploy,
so the demo stays up on the old version the whole time this is being
fixed.

Fix: `cd backend && npm run demo:reset:remote` for the live public demo,
or `npm run dev:reset:remote` for the dev-test service (both read
`demo/.env`, requires `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` set
to an explicit human confirmation -- see each script's own comment),
then retrigger the deploy. These are independent per RUNBOOK.md's own
note on this failure -- fixing one doesn't fix the other.
