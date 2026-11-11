# The idea-to-production pipeline

**Last verified**: 2026-11-11 · **Owner**: @neckermann

How a change gets from a local edit to the live public demo. See
[docs/AGENTS.md](AGENTS.md) for what an agent/subagent is and isn't
allowed to do at each stage, and [CONTRIBUTING.md](../CONTRIBUTING.md)
for the underlying rules (migrations, dependencies, screenshots) this
pipeline assumes.

## The pipeline, stage by stage

```
local build/test  →  [feature branch → PR into dev]  →  push to dev  →  dev-test (live check)  →  PR dev→main  →  merge  →  production demo
                       optional, for larger work          (auto-deploy)                              (auto-deploy)
```

### 1. Local build/test

Before committing anything non-trivial, run it locally — see
[ADMIN_GUIDE.md § Local development setup](../ADMIN_GUIDE.md#local-development-setup)
to get the backend/frontend running, then:

```bash
cd backend  && npm test && npm run test:routes
cd frontend && npm run test:e2e
```

This is the fast loop — no deploy, no real notification channels, a
throwaway or Docker-local Postgres (see
[CONTRIBUTING.md § Running tests](../CONTRIBUTING.md#running-tests)).

### 2. Push to `dev` → dev-test

```bash
git switch dev && git pull
# ... commit ...
git push origin dev
```

Render's `dev-missions-partner-tracker` service watches `dev` directly
and redeploys on every push — no PR needed to see it live. Use this to
check something that's hard to verify locally (a real deploy
environment, a schema change against a real Postgres, an integration
that needs real credentials). It's pre-prod: throwaway data, reset
routinely, never the thing a real user sees.

**For anything bigger than a single small commit**, don't push
straight to `dev` — branch off it and PR into `dev` instead (CI already
runs on a PR targeting `dev`, not just `main`). Otherwise dev-test sits
broken or half-finished between commits for as long as the feature
takes. See
[CONTRIBUTING.md § Feature branches for larger work](../CONTRIBUTING.md#feature-branches-for-larger-work)
for the exact commands.

If the push changed `schema.prisma`, the next deploy's
`preDeployCommand` (`prisma migrate deploy`) can fail if dev-test's
database doesn't have a matching migration history — see
[demo/README.md § Recovering after a migration squash](../demo/README.md#recovering-after-a-migration-squash)
for the recovery procedure (the same one applies to dev-test's own
database, not just the demo's).

### 3. PR `dev` → `main`

```bash
gh pr create --base main --head dev
```

This is the only place CI runs (`.github/workflows/ci.yml`'s `lint`,
`backend-tests`, `frontend-build`, `e2e` jobs — see the comment at the
top of that file for why it's PR-only, not push-triggered). `main` is
branch-protected: all four must pass, no direct pushes. Open the PR
even as a draft to get a CI run — nothing runs on a bare push to `dev`.

### 4. Merge → production demo

Merging the PR deploys automatically — Render's production
`missions-partner-tracker` service tracks `main`. **A merge into
`main` is a release**, not a checkpoint (see
[CONTRIBUTING.md § Branches and releasing](../CONTRIBUTING.md#branches-and-releasing)).

Same migration-squash caveat as step 2 applies here, against the
production database — see [demo/README.md](../demo/README.md).

### Rollback

Render keeps prior deploys — redeploy an older commit from the
service's dashboard, or revert the merge commit on `main` and push (a
direct push requires temporarily lifting branch protection; see
[CONTRIBUTING.md](../CONTRIBUTING.md#branches-and-releasing)). There is
no automated rollback step.

## Testing live sends

Email, GroupMe, and WhatsApp are real external channels — there's no
sandbox mode. Forcing a notification schedule to fire early (resetting
`lastXSentAt` columns, hand-editing a cadence field to make something
due now) sends for real, on real channels, to whatever
recipients/groups are configured on whichever environment you're
pointed at.

This isn't a hard gate — the actual stakes are the channels themselves
(a WhatsApp number's ban risk, a real GroupMe group getting test
noise, a real inbox), not the data (dev-test and the demo are reset
and reseeded with synthetic data routinely; see
[demo/README.md](../demo/README.md)). Know which environment you're
pointed at and which real-world recipients/groups are wired to it
before forcing a send — see [docs/RUNBOOK.md](RUNBOOK.md) for which
integrations are live on which environment.

## TODO

- [ ] Confirm whether there's a documented process for testing a schema
  change against dev-test *before* it's pushed (vs. the "push and see
  if preDeployCommand fails" loop described above).
