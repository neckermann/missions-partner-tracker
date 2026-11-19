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
