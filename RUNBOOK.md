# Runbook

**Last verified**: 2026-11-11 · **Owner**: @neckermann

Environment URLs, env vars, deploy/rollback, and common failures. For
the pipeline these environments sit in, see
[WORKFLOW.md](WORKFLOW.md). For deployment topology/rationale,
see [SPEC.md § 8](SPEC.md).

## Environments

| Environment | URL | Branch | Purpose |
|---|---|---|---|
| Local | `http://localhost:5173` (frontend dev server, proxies `/api` to `:4000`) | — | Fast local loop, see [ADMIN_GUIDE.md § Local development setup](ADMIN_GUIDE.md#local-development-setup) |
| Pre-prod test (`dev-missions-partner-tracker`) | TODO — confirm exact URL in the Render dashboard | `dev` | Live pre-release check, auto-deploys every push |
| Production / live public demo (`missions-partner-tracker`) | `https://missions-partner-tracker.onrender.com` | `main` | What a real visitor sees, auto-deploys on merge |

Both Render services are described in [SPEC.md § 8.2](SPEC.md); the
demo's own operational details (real secrets, its Blueprint) live in
[demo/README.md](demo/README.md) and `demo/.env` (gitignored, never
commit).

## Environment variables (names only — see `backend/.env.example` for what each one does)

Grouped by where they're read, verified directly against
`backend/src/` — nothing below is inferred.

**Core (required to boot):**
`DATABASE_URL`, `SESSION_SECRET`

**Core (optional, app degrades gracefully without):**
`PORT`, `NODE_ENV`, `APP_BASE_URL`, `FIELD_ENCRYPTION_KEY`,
`NOMINATIM_CONTACT`, `MFA_ISSUER`

**Render-provided automatically:**
`RENDER_EXTERNAL_URL` (falls back to/aliases `APP_BASE_URL`)

**Demo mode (only meaningful on the production demo deployment):**
`DEMO_RESET_TOKEN`, `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`,
`SEED_MISSIONARY_COUNT`, `SEED_ORGANIZATION_COUNT`

**Integrations (set per-instance, restored into `ChurchSettings` on a demo reset):**
`JOSHUA_PROJECT_API_KEY`, `ANTHROPIC_API_KEY`, `GROUPME_ACCESS_TOKEN`,
`GROUPME_GROUP_NAME`, `GROUPME_PRAYER_NAME`,
`GROUPME_ONETIME_NEEDS_NAME`, `GROUPME_NEWSLETTER_NAME`,
`POSTMARK_API_KEY`, `FROM_EMAIL_ADDRESS`, `WEBHOOK_USERNAME`,
`WEBHOOK_PASSWORD`, `PEXELS_API_KEY`

**Test/CI-only** (set in `.github/workflows/ci.yml`, never in a real
deployment): `TZ` (deliberately non-UTC — see the job's own comment),
`SEED_DEMO_EXTRAS`, `E2E_BASE_URL`, `E2E_ADMIN_EMAIL`,
`E2E_ADMIN_PASSWORD`.

Three names that appear in `demo/.env` but are **not** read anywhere
in `backend/src/` (confirmed via grep, including a check for dynamic
`process.env[...]` access): `WEBHOOK_URL`, `WHATSAPP_PHONE_NUMBER`,
`RENDER_API_KEY`. The last is a maintainer/tooling credential for
calling Render's own API directly, not something the app itself reads;
the other two appear to be leftovers. TODO: confirm with whoever
maintains `demo/.env` whether `WEBHOOK_URL`/`WHATSAPP_PHONE_NUMBER` are
safe to remove.

WhatsApp pairing itself needs no env var — it's QR-paired through the
admin UI and stored in the database, same as every other per-instance
integration (see [CONTRIBUTING.md § The one rule that matters most](CONTRIBUTING.md#the-one-rule-that-matters-most-keep-forks-upgradable)).

## Deploy / rollback

See [WORKFLOW.md](WORKFLOW.md) for the normal path (push to
`dev`, PR to `main`, merge deploys). Rollback: redeploy an older build
from the Render dashboard, or revert the merge commit on `main`. No
automated rollback exists.

**A push touching `schema.prisma` needs the build cache cleared on
that redeploy, not reused** — Render's dashboard calls this "Clear
build cache & deploy" (Manual Deploy menu on the service); the Render
API's equivalent deploy call takes `clearCache: "clear"`. A cached
build can silently skip `prisma generate`, so the running process's
generated client doesn't know about the new columns even though the
database does. Do this for both `dev-test` and the production demo
whenever `schema.prisma` changed, not just whichever one you happened
to be testing against.

## Common failures

**Deploy stuck at `pre_deploy_failed` after a schema change.** Expected
during this project's pre-1.0 migration-squash convention — the
squashed migration's `CREATE TABLE`s collide with a database that has
the old migration history. Render doesn't cut over on a failed
pre-deploy, so the live site stays up on the old version the whole
time. Fix: [demo/README.md § Recovering after a migration squash](demo/README.md#recovering-after-a-migration-squash).
Applies to **either** Render service independently — fixing it on the
demo doesn't fix dev-test, and vice versa; both need their own reset
if both received the squashed migration.

**A branch you expected to still exist is gone after a PR merge.** If
the repo ever has `delete_branch_on_merge` enabled, merging a PR
deletes its head branch — actively harmful for a long-lived branch
like `dev` (not a throwaway feature branch), and causes Render's
`branch` setting for any service tracking it to silently fall back to
the repo's default branch. Check
`gh api repos/<owner>/<repo> --jq .delete_branch_on_merge` is `false`;
if a branch was deleted this way, recreate it from local history and
re-check the affected Render service(s)' `branch` field.

**Local `prettier --check .` reports far more files than CI does.**
Windows' `core.autocrlf=true` git default introduces CRLF line endings
in the local working tree that Prettier flags as formatting errors —
not a real problem, just a line-ending mismatch. `.gitattributes`
(`* text=auto eol=lf`) normalizes this; if it recurs, check that file
is still in place before assuming ~400 files actually need reformatting.

**An agent's Render API call or database reset is refused.** Not a
bug — see [AGENTS.md § Approval gates for autonomous action](AGENTS.md#approval-gates-for-autonomous-action)
for the two tooling-level safety gates (Prisma's AI-consent
requirement, the acting agent's own safety classifier) that apply
regardless of project policy.

## TODO

- [ ] Confirm dev-test's exact Render URL and fill in the table above.
- [ ] Confirm whether `WEBHOOK_URL`/`WHATSAPP_PHONE_NUMBER` in
  `demo/.env` are dead and safe to remove.
