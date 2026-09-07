# Upgrading a fork

This project is meant to be forked once per church, not run as a shared
hosted service — so "upgrading" means pulling changes from the original
project into your own fork, the same way you'd pull upstream changes into
any fork. Forking (rather than, say, GitHub's "Use this template" button)
is deliberate: a real fork keeps a tracked relationship to this repo,
which is what unlocks the easy update path below — a template-generated
copy doesn't have that relationship, and would leave you with the manual
git path as your only option.

This works cleanly for one specific reason: everything that makes your
instance *yours* — church name, logo, brand color, the term you use for
partners — lives in the database (Church Settings), set through the admin
UI, not hardcoded in the files that get updated. As long as you keep it
that way, pulling in new releases should almost always be a clean,
conflict-free update. If you *have* directly edited application code for
your own church, that's fine, but expect an occasional merge conflict on
the lines you changed — see the last section below.

Logged-in admins also see a banner right in the dashboard when their
instance is running behind the latest release — you don't have to
remember to check GitHub. See `backend/src/utils/versionCheck.js` if
you're curious how that works.

## The easy way: GitHub's "Sync fork" button

If you haven't directly edited application code, this is the whole
process — no terminal, no git commands, done entirely in your browser:

1. Go to your fork's page on GitHub (`github.com/<you>/missions-partner-tracker`).
2. Click **Sync fork** (above the file list) → **Update branch**. This
   fast-forwards your fork's `main` to match this project's `main`.
3. Whatever machine you deploy from, pull that update down and finish the
   remaining steps (reinstall dependencies, apply migrations, redeploy) —
   see steps 3–6 under **The manual way** below; they're the same either
   way, this just replaces steps 1–2.

This only works cleanly as a plain fast-forward — if you've made your own
commits on `main`, GitHub will tell you a merge is needed instead and
you'll want the manual path below. It also only applies to a genuine
GitHub fork (created via the **Fork** button) — a private fork that was
set up by copying files rather than forking the actual repo won't have a
**Sync fork** button at all (see
[ADMIN_GUIDE.md § If you're running a private fork alongside this public repo](ADMIN_GUIDE.md#if-youre-running-a-private-fork-alongside-this-public-repo)).

## The manual way: git

Use this if you've directly modified application code, your fork is
private and wasn't created via GitHub's Fork button, or you just prefer
the command line.

**One-time setup** — add this repository as a second remote (`upstream`)
alongside your own fork (`origin`):

```bash
git remote add upstream https://github.com/neckermann/missions-partner-tracker.git
```

(If the project has since been renamed/moved, GitHub redirects the old URL
automatically, so this keeps working either way.)

**Pulling in an update:**

1. Check [CHANGELOG.md](CHANGELOG.md) for what changed since the version
   you're on, and whether it's flagged as a breaking (`MAJOR`) change —
   that usually means a required migration or a new required env var.
2. Fetch and merge:
   ```bash
   git fetch upstream
   git merge upstream/main
   ```
3. Reinstall dependencies in case any changed:
   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```
4. Apply any new database migrations:
   ```bash
   cd backend
   npx prisma migrate deploy
   ```
   This only applies migrations that aren't already recorded as run
   against your database, so it's safe to run every time — already-applied
   migrations are skipped automatically.
5. Check `backend/.env.example` for any new variables and add them to your
   real `.env` / hosting platform's config.
6. Build the frontend (`cd frontend && npm run build` — writes into
   `backend/public`) and redeploy the backend, which serves both the API
   and the frontend as one deployable unit — see
   [ADMIN_GUIDE.md § Deploying to production](ADMIN_GUIDE.md#deploying-to-production).

## If you've directly modified application code

Merge conflicts will show up in `git merge` the normal way — resolve them
like any git conflict. If you find yourself resolving the same conflict on
every upgrade (e.g. a hardcoded label or color you changed by hand), that's
usually a sign the value should have been a Church Settings field or an env
var instead. Consider opening an issue or PR to make it configurable
upstream — that fixes it for your fork's future upgrades and for everyone
else forking after you.
