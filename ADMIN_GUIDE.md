# Admin Guide: Setup & Infrastructure

This is the "getting it running and keeping it running" guide — local
development, environment configuration, authentication setup, deployment,
and ongoing operations. If you're looking for how to actually *use* the
app day-to-day (adding partners, tracking support, exporting the booklet),
see [USER_GUIDE.md](USER_GUIDE.md) instead.

## Architecture at a glance

Two pieces: a Postgres database, and the app itself — one Node/Express
process (`backend/`) that serves both the API and the built React
frontend (`frontend/`, compiled with Vite) from a single origin. There's
no separate frontend host or build pipeline to run in production; the
backend's own deploy is the whole app.

| Piece | What it is |
|---|---|
| **Database** | PostgreSQL, any host (this project's reference deployment uses [Neon](https://neon.tech)) |
| **App** | Node/Express + Prisma ORM (`backend/`), serving the built React/Vite frontend (`frontend/`) directly — public site + admin dashboard + API, all one deployable origin |

Auth is an `httpOnly`, `Secure`, `SameSite=Lax` session cookie — since
everything is one origin, there's no cross-domain cookie problem to work
around, and a cookie is safer than a token sitting in `localStorage`
(which any JS running on the page — including via an XSS bug — can read;
an `httpOnly` cookie can't be read by JS at all).

## Local development setup

1. **Prerequisites**: Node.js 20.19+ or 22.12+ (required by Vite 8), a
   Postgres database (local, Docker, or a free cloud instance like
   [Neon](https://neon.tech) or [Supabase](https://supabase.com)), and an
   AWS S3 bucket if you want to test file uploads (optional — everything
   else works without it, see [File storage](#file-storage-s3) below).
2. **Backend**:
   ```bash
   cd backend
   cp .env.example .env       # fill in DATABASE_URL, SESSION_SECRET, etc. — see reference below
   npm install
   npm run prisma:migrate     # creates tables
   npm run seed                # optional: ~35 fake partners for demoing the UI
   node prisma/createAdmin.js you@yourchurch.org "SomeStrongPassword!"
   npm run dev                  # http://localhost:4000
   ```
3. **Frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev                  # http://localhost:5173
   ```
   No frontend `.env` needed locally — Vite proxies `/api` to
   `http://localhost:4000` automatically (see `frontend/vite.config.js`).
4. Visit `http://localhost:5173/login` and sign in with the account you
   just created. Local login always works, whether or not SSO is also
   configured.

### Building for production

```bash
cd frontend
npm run build      # writes into backend/public — see vite.config.js
```
The build writes directly into `backend/public` (not `frontend/dist`) so
the backend can serve it as a plain sibling directory — see
`backend/src/server.js`'s static-file serving. No env var to set: the
frontend always calls `/api` on its own origin, since the backend is
always what serves it.

The backend itself has no build step beyond that — `npm run start` runs
`src/server.js` directly, and it'll serve whatever's currently in
`backend/public`. Deploying the app means deploying `backend/` *after*
running the frontend build, so `backend/public` is populated — see
[Deploying to production](#deploying-to-production).

### Running tests

```bash
cd backend
npm test
```
Covers the public/restricted data-masking rules and the auth middleware —
see [CONTRIBUTING.md § Running tests](CONTRIBUTING.md#running-tests) for
what is and isn't covered yet. There's no frontend test suite currently.

## Environment variables

All of these live in `backend/.env` (see `backend/.env.example` for the
full file with inline comments):

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Any Postgres connection string |
| `PORT` | No | Defaults to 4000 |
| `NODE_ENV` | No | `development` or `production` |
| `SESSION_SECRET` | Yes | Signs the session cookie (see [Authentication setup](#authentication-setup)). Generate a long random value, e.g. `openssl rand -base64 48`. See [Rotating SESSION_SECRET](#rotating-sessionsecret) below |
| `FIELD_ENCRYPTION_KEY` | Yes | Encrypts secrets at rest (MFA secrets, SSO client secrets). Generate with `openssl rand -base64 32`. See [Rotating FIELD_ENCRYPTION_KEY](#rotating-field_encryption_key) below |
| `APP_BASE_URL` | Only if using SSO | This app's own public base URL, used to build the SSO callback URL — see [Single sign-on (SSO)](#single-sign-on-sso) |
| `AWS_REGION`, `S3_BUCKET_NAME` | Yes, for file uploads | See [File storage](#file-storage-s3) |
| `JOSHUA_PROJECT_API_KEY` | No | Enables country-level unreached-people-group stats; get a free key at [joshuaproject.net/api/request](https://joshuaproject.net/api/request) |
| `NOMINATIM_CONTACT` | Recommended | Your contact email, sent with geocoding requests per [Nominatim's usage policy](https://operations.osmfoundation.org/policies/nominatim/) |
| `MFA_ISSUER` | No | Name shown in a user's authenticator app when they enroll in MFA; defaults to "Missions Partner Tracker Admin" |

There's nothing to configure for the frontend separately — it's served by
the backend and always calls `/api` on its own origin.

## Authentication setup

Local username/password login is always available — nothing to configure
for it beyond the account you created with `createAdmin.js`. Single
sign-on is entirely optional and layered on top.

### Single sign-on (SSO)

One generic OIDC login flow (`backend/src/routes/sso.js`, via
`openid-client`) serves any standards-compliant identity provider — Entra
ID, Google Workspace, Okta, or anything else that publishes an OIDC
discovery document. Unlike the rest of this table, **there are no env vars
to set for SSO itself** — every provider (including its client secret) is
configured entirely from **Admin → Church Settings → Single Sign-On**, and
takes effect immediately with no redeploy. The only env vars SSO needs at
all are `FIELD_ENCRYPTION_KEY` (encrypts the client secret at rest) and
`APP_BASE_URL` (used to build the callback URL), both listed above.

To add a provider:
1. In your identity provider, register a new app/enterprise application
   with the redirect/reply URL `${APP_BASE_URL}/api/auth/sso/callback` —
   this exact URL is shared by every provider you configure; the app tells
   them apart via the `state` parameter, not the URL.
2. Note the app's **Client ID**, **Client Secret**, and **Issuer URL**
   (the base URL its `/.well-known/openid-configuration` discovery
   document lives under):
   - **Entra ID**: Entra ID → App registrations → your app. Issuer URL is
     `https://login.microsoftonline.com/<tenant-id>/v2.0`.
   - **Google Workspace**: Google Cloud Console → APIs & Services →
     Credentials → OAuth client ID. Issuer URL is
     `https://accounts.google.com`.
   - **Okta**: your Okta admin console → Applications → your app. Issuer
     URL is your Okta domain, e.g. `https://your-org.okta.com`.
   - Any other OIDC provider: check its docs for the issuer URL.
3. In the app, go to **Admin → Church Settings → Single Sign-On → + Add
   Provider**, fill in the button label, provider type (cosmetic — picks
   the button icon), issuer URL, client ID, and client secret, and check
   **Enabled**. Optionally restrict it to one email domain.
4. Save. The login page immediately shows a "Sign in with ..." button for
   it — no restart needed.

**Testing SSO in local dev**: the callback lands on the backend directly
(`APP_BASE_URL`, e.g. `http://localhost:4000`), not the Vite dev server at
`:5173`, since the identity provider redirects there regardless of Vite's
proxy. Either run `cd frontend && npm run build` once first so the backend
has something in `backend/public` to serve, or just navigate to
`http://localhost:5173/admin` manually after the redirect lands — the
session cookie is already set and is shared across ports on `localhost`,
so it'll already be logged in.

New users who sign in through any provider for the first time are
auto-created with role `editor`. Promote someone to `admin` directly in
the **Manage Users** screen, the `User` table, or via Prisma Studio
(`npm run prisma:studio`). Disabling or deleting a provider doesn't touch
the users who signed in through it — they just can't sign in that way
again until it's re-added; local login (if their account has a password)
or another provider still works.

A few things worth knowing operationally:
- `SESSION_SECRET` is what signs the session cookie — see
  [Rotating SESSION_SECRET](#rotating-sessionsecret) below before you
  ever need to do this in a hurry.
- `FIELD_ENCRYPTION_KEY` encrypts SSO client secrets and MFA secrets in
  the database — see
  [Rotating FIELD_ENCRYPTION_KEY](#rotating-field_encryption_key) below.
- MFA (TOTP) is opt-in and self-service per user, or an admin can force
  it on a specific account. See
  [USER_GUIDE.md § Your account settings](USER_GUIDE.md#your-account-settings)
  for the user-facing flow.

For the app's role model itself (`viewer`/`editor`/`admin`), see
[USER_GUIDE.md § Understanding your role](USER_GUIDE.md#understanding-your-role).

## File storage (S3)

Photos, logos, and newsletter PDFs are stored in one S3 bucket
(`backend/src/utils/s3.js`), split by key prefix: `missionaries/*`,
`organizations/*`, and `settings/*` are public-read (bucket policy, not
per-object ACLs); `newsletters/*` is private, served only via short-lived
pre-signed URLs.

AWS S3 is the default and needs no extra config beyond `AWS_REGION` and
`S3_BUCKET_NAME`. In production (Elastic Beanstalk) credentials come from
the EC2 instance role automatically; for local testing, run
`aws configure` with a user/role that has access to the bucket instead of
setting keys in `.env`.

To use an S3-compatible service instead — Cloudflare R2, Backblaze B2,
self-hosted MinIO — set `S3_ENDPOINT` (and usually
`S3_FORCE_PATH_STYLE=true`, and `S3_PUBLIC_URL_BASE` for the public URL a
browser uses to reach uploaded files) in `backend/.env`; see the commented
examples in `backend/.env.example`. Running with no object storage at all
isn't supported — the app expects every upload to return a URL any
browser can reach directly.

You can skip S3 setup entirely for local dev — every other feature works
without it, uploads just fail until it's configured.

## Rate limiting

A few endpoints are rate-limited per IP (`backend/src/server.js`), mainly
to blunt scripted abuse now that the public site is unauthenticated by
design:

| Endpoint(s) | Limit |
|---|---|
| `/api/auth/login` | 20 requests / 15 min |
| `/api/auth/mfa/login-verify` | 10 requests / 15 min |
| `/api/public/*` (directory, map, country stats, public settings) | 120 requests / min |

These aren't env-configurable — if your instance needs different limits
(e.g. a very high-traffic public site), edit the `rateLimit(...)` calls in
`server.js` directly. A legitimate user hitting one during normal use gets
a `429` response; that's a sign the limit needs raising for your traffic,
not a bug to work around.

## Deploying to production

The app is two pieces: a Postgres database, and the app itself — one
Node/Express process that serves both the API and the built frontend.
There's no separate frontend host to configure or keep in sync; deploying
the backend *is* deploying the whole app.

### Reference deployment (AWS)

This repo doesn't run a live deployment itself — it's the open-source
upstream that a church's own private fork deploys from (see
[Upgrading a fork](#upgrading-a-fork)). `.github/workflows/backend-deploy-aws.yml`
is included as a ready-to-use template for that fork's own AWS setup:
- **Database**: any Postgres — [Neon](https://neon.tech) (serverless
  Postgres) is a lightweight choice that pairs well with this setup
- **App**: AWS Elastic Beanstalk (Node platform), fronted by CloudFront
  for TLS and caching — serves both the API and the frontend build
- **File storage**: AWS S3

The workflow runs on every push to `main` that touches `backend/**` or
`frontend/**`: it builds the frontend (writing into `backend/public`),
zips the backend (including that build), uploads it to S3, and rolls it
out to Elastic Beanstalk. It ships **disabled** in this repo (Actions tab
→ the workflow → Enable workflow) since there's no AWS environment behind
this specific repo to deploy to. **To use it in your fork**, set your own
EB resource names as repository variables (`EB_APP_NAME`, `EB_ENV_NAME`,
`AWS_REGION`, `EB_DEPLOY_S3_BUCKET` under **Settings → Secrets and
variables → Actions → Variables**) plus `AWS_ACCESS_KEY_ID`/
`AWS_SECRET_ACCESS_KEY` as repo *secrets* — without real values set
there, the workflow's placeholder fallback values
(`your-eb-application-name`, etc.) won't resolve to anything that exists,
and the deploy step will fail.

For the full step-by-step walkthrough of standing up this AWS setup from
nothing — the Elastic Beanstalk application and environment, the S3
bucket, the IAM deploy user, the GitHub Actions variables/secrets, the
CloudFront distribution, and a custom domain with a free managed TLS
certificate — see [INFRASTRUCTURE.md](INFRASTRUCTURE.md).

### Deploying anywhere else

Nothing about this app requires AWS specifically except the S3
file-storage code noted above. Some options that work well for a small
church team:

| Piece | Options |
|---|---|
| Database | [Neon](https://neon.tech), [Supabase](https://supabase.com), [Railway](https://railway.app), AWS RDS, or any managed/self-hosted Postgres |
| App | [Railway](https://railway.app), [Render](https://render.com), [Fly.io](https://fly.io), a plain VPS running `npm run start` behind nginx + `pm2` — anything that can run a long-lived Node process. There's no Dockerfile in this repo, so platforms that build straight from a Node buildpack (Railway/Render) need the least setup. Whatever you use needs to run the frontend build (`cd frontend && npm run build`) *before* starting the backend, so `backend/public` is populated. |
| File storage | AWS S3 by default, or any S3-compatible service (Cloudflare R2, Backblaze B2, self-hosted MinIO) via `S3_ENDPOINT` — see [File storage](#file-storage-s3) above |

Wherever you land, the deployment steps are the same shape regardless of
provider:

1. Provision Postgres, run `npx prisma migrate deploy` against it (from
   `backend/`, with `DATABASE_URL` set).
2. Build the frontend (`cd frontend && npm run build`) — this writes into
   `backend/public`, so do this *before* the next step.
3. Deploy the backend (including the now-populated `backend/public`) with
   every variable from the
   [Environment variables table](#environment-variables) set as that
   platform's environment/config vars — never commit `.env`.
4. Run `node prisma/createAdmin.js you@yourchurch.org "SomeStrongPassword!"`
   once, against the production database, to create your first login.
5. Update `APP_BASE_URL` to your real deployed URL, and if using SSO,
   update the reply/redirect URL registered with each identity provider
   to match `${APP_BASE_URL}/api/auth/sso/callback`.
6. Use HTTPS everywhere in production — required for SSO and for the
   session cookie's `Secure` flag to actually work, and just generally
   expected for a site handling admin logins.

### Before you deploy a fork, change these

A few things default to placeholder or project-specific values and should
be treated as "must set," not "nice to set":
- `S3_BUCKET_NAME` — your own bucket, not a shared one.
- `SESSION_SECRET` — generate your own; never reuse the example value or share it across environments.
- `NOMINATIM_CONTACT` — your own email, so misbehaving geocoding traffic isn't attributed to someone else.
- If reusing `.github/workflows/backend-deploy-aws.yml` as-is, set the repository variables described above rather than leaving it pointed at this project's AWS resources.

### If you're running a private fork alongside this public repo

Some churches keep a private fork for their real production deployment
(with real AWS resource names, secrets, etc.) while pulling updates from
this public repo as upstream. If that's your setup:
- Keep anything environment-specific (real resource names, deploy
  credentials) in your platform's config/Secrets, **never** hardcoded
  into a file that gets merged from upstream — otherwise every sync
  either overwrites your real values with this repo's placeholders, or
  creates a merge conflict on every pull.
- The two repos need *shared git history* for `git merge upstream/main`
  to work as a normal, low-conflict merge instead of hitting "refusing to
  merge unrelated histories." If your fork predates this repo's public
  history (e.g. it was split off by copying files rather than filtering
  git history), you'll likely need a one-time reconciliation merge
  (`git merge upstream/main --allow-unrelated-histories`, resolving
  conflicts file-by-file) before ongoing syncs become simple merges.
- After merging in an update, always run `npm install` and your test
  suite/build before deploying — a clean git merge doesn't guarantee the
  result actually runs.

### Demo mode

Optional, and only relevant if you want to stand up a public demo
instance — a deployment anyone can visit and actually try the admin
dashboard on, running fake seeded data that resets on a schedule so
nothing anyone does there is permanent.

Set three env vars (see `backend/.env.example`):
- `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` — the login you publish for
  visitors to use.
- `DEMO_RESET_TOKEN` — a random secret (`openssl rand -base64 32`). This
  is what makes `POST /api/demo/reset` exist at all — the route isn't
  mounted unless this is set, so a normal deployment with real data has
  no trace of this feature. Leave all three unset for a real deployment.

Optionally, `SEED_MISSIONARY_COUNT`/`SEED_ORGANIZATION_COUNT` control how
much fake data each reset generates (default 35/12, same as local
`npm run seed`) — a public demo might want more to look fuller.

Calling `POST /api/demo/reset` with `Authorization: Bearer <DEMO_RESET_TOKEN>`
(or running `npm run demo:reset` locally/on the server directly) wipes the
database (`npx prisma migrate reset --force`) and reseeds it
(`backend/prisma/seed.js`), recreates the demo login
(`backend/prisma/createAdmin.js`), and sets Church Settings to a
demo-branded name/tagline/about-text that tells visitors it's a live
demo and states the login credentials — reusing the existing
white-labeling mechanism, no frontend changes needed. See
`backend/scripts/reset-demo-data.js` for the exact sequence.

To actually reset on a schedule, add a scheduled job **in your fork's own
repo** (not this one — scheduling is deployment-specific) that calls the
route periodically, e.g. a GitHub Actions workflow with a `schedule:`
cron trigger doing:
```bash
curl -X POST https://your-demo-domain/api/demo/reset \
  -H "Authorization: Bearer ${{ secrets.DEMO_RESET_TOKEN }}"
```
No additional infrastructure needed beyond what
[INFRASTRUCTURE.md](INFRASTRUCTURE.md) already sets up — this reuses
GitHub Actions, which you already have for deploys.

**This wipes the entire database.** Never set `DEMO_RESET_TOKEN` (or run
`npm run demo:reset`) against a deployment holding real partner data.

## Upgrading a fork

If you forked this repo, see [UPGRADING.md](UPGRADING.md) for the full
process — it's a normal `git merge` from an `upstream` remote, and stays
conflict-free as long as your church's customization lives in Church
Settings/env vars rather than hand-edited code (see
[CONTRIBUTING.md](CONTRIBUTING.md) for why). Check
[CHANGELOG.md](CHANGELOG.md) for what changed before upgrading — entries
flagged as breaking (`MAJOR` version bump) usually mean a required
migration or a new required env var.

## Security operations

### Rotating SESSION_SECRET

This signs the session cookie — rotating it (generate a new value, e.g.
`openssl rand -base64 48`, and update it wherever your backend gets its
env vars) **instantly invalidates every currently-issued session token**,
logging everyone out. That's the correct, expected behavior if you ever
suspect the value has leaked — do it, then have everyone log back in.
There's no partial/soft rotation; it's all-or-nothing by design.

### Rotating FIELD_ENCRYPTION_KEY

This encrypts MFA secrets and SSO client secrets at rest
(`backend/src/utils/crypto.js`). Unlike `SESSION_SECRET`, rotating it is
**not** a drop-in swap — every value already encrypted with the old key
becomes unreadable the moment you change it, which breaks MFA logins and
SSO for every provider until re-entered. If you need to rotate it: decrypt
and re-encrypt every affected row under the old key before switching
(there's no built-in script for this since it's rare enough not to warrant
one — SSO client secrets can just be re-entered from Church Settings after
switching, and MFA-enabled users can have their MFA reset from Manage
Users and re-enroll). Only rotate this if you suspect it's actually
leaked; otherwise leave it alone indefinitely.

### Restricted-country masking policy

Every missionary/organization record has an `isRestricted` flag —
enabling it masks the name (missionaries only), precise GPS, and overview
on the public site. Review `backend/src/utils/maskData.js` as a team
periodically: the defaults are reasonable, but you know which fields are
genuinely safe to show for your specific restricted-access partners. This
file is the single place to adjust that policy. Full explanation of what
gets masked: [USER_GUIDE.md § Understanding restricted-access partners](USER_GUIDE.md#understanding-restricted-access-partners).

### Database backups

Nothing in this app manages backups for you — that's your Postgres
provider's job (most managed providers, including Neon, offer
point-in-time recovery out of the box). Confirm your provider's backup
retention matches how much data loss your church would tolerate before
you're relying on real partner data.

## Troubleshooting

- **`node --test test/` fails with `MODULE_NOT_FOUND`**: this is a Node
  24 regression with bare-directory arguments; the repo's `npm test`
  script already works around it with an explicit glob
  (`test/*.test.js`) — if you've customized the script, apply the same
  fix.
- **`npm install` fails on Vite/plugin-react version mismatch**: Vite 8
  needs `@vitejs/plugin-react` 6.x — if you've pinned an older
  plugin-react version, bump it alongside Vite.
- **SSO login redirects to `/login?error=sso`**: check the server log —
  every SSO failure (unknown/disabled provider, expired state, discovery
  failure, domain not allowed, disabled account) logs its specific reason
  server-side before redirecting; the login page itself only ever shows a
  generic message so it doesn't leak details to an unauthenticated caller.
- **A restricted missionary/org doesn't show up on the public map**: they
  need a resolvable pin — see
  [USER_GUIDE.md § The public site](USER_GUIDE.md#the-public-site) for
  what that requires (a country name that matches `COUNTRY_CENTROIDS`
  exactly).
