# Working here as an agent

**Last verified**: 2026-11-11 · **Owner**: @neckermann

For an agent/subagent picking up work in this repo. Project basics
(what this is, hard rules, key commands) are in
[CLAUDE.md](CLAUDE.md) — read that first. This doc covers approval
gates, the repo map, and a starter-brief template for delegating a
task.

## Repo map

```
backend/
  src/routes/       one file per resource (partners, prayerRequests, settings, ...)
  src/utils/         notification channels, encryption, email, WhatsApp/GroupMe clients
  prisma/            schema.prisma + one squashed baseline migration (pre-1.0, see CONTRIBUTING.md)
  test/              node:test unit tests; test/routes/ needs a real Postgres (see e2e job)
frontend/
  src/pages/         one file per admin/public page
  src/components/    shared building blocks (forms, modals, review UI — see STYLE-GUIDE.md)
  e2e/               Playwright suite
demo/                operational details (real secrets, Render blueprint) for the one live public demo — see demo/README.md
docs/                the published marketing/docs site only (docs/index.html) + screenshots — contributor/agent docs live at repo root, alongside this file
```

Full data model and backend/frontend structure: [SPEC.md](SPEC.md).

## Approval gates for autonomous action

Confirmed with the project owner (2026-11-11): an agent may, without
asking first —

- Push directly to `dev`
- Open and merge a `dev` → `main` PR
- Trigger a production demo-data reset
- Repoint or modify Render service configuration

**Two of those four are not actually unlockable by this policy alone**,
and a future session should not assume full autonomy on them just
because they're listed above:

- **Triggering a database reset** (`prisma migrate reset --force`, or
  anything equivalent) against a live database runs into Prisma's own
  AI-agent safety guard, which demands the env var
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` be set to the *exact,
  verbatim text of the user's current, specific, in-the-moment
  consent* — not a project-policy statement, not a prior approval
  reused across runs. This policy entry means "don't stop to ask
  whether this kind of action is in-bounds" — it does not mean the
  tooling will proceed without a fresh, specific human confirmation
  each time.
- **Repointing/modifying a Render service** (branch, repo, env vars via
  the Render API) may be blocked by the acting agent's own safety
  classifier (categories like "Modify Shared Resources") regardless of
  this stated policy. That classifier isn't something a CLAUDE.md/
  AGENTS.md policy can override — if blocked, the action has to be
  done manually (Render dashboard) or unblocked via the operator's own
  permission settings, not retried.

Practically: cite this policy to skip asking "is this the kind of
thing I'm allowed to do," but still expect to need a specific human
in the loop for an actual destructive-DB or Render-config action when
the tooling itself demands it — that's a safety mechanism outside this
project's control, not a formality.

## What not to touch

- `demo/.env` — real secrets, gitignored. Never print its contents in
  full, never commit it.
- Any `.env`/`.env.*` file, anywhere in the repo.
- Don't invent a church-specific value in application code — see
  [CONTRIBUTING.md § The one rule that matters most](CONTRIBUTING.md#the-one-rule-that-matters-most-keep-forks-upgradable).

## Notification safety

Forcing a notification schedule to fire sends on real channels (email,
GroupMe, WhatsApp) to whatever's actually configured on the
environment you're pointed at — see
[WORKFLOW.md § Testing live sends](WORKFLOW.md#testing-live-sends).
Informational, not a hard gate: the test data itself is synthetic and
reset routinely either way.

## Starter brief template

When delegating a task to a fresh agent in this repo, include:

- Which branch/environment it's working against (local, dev-test,
  production) and why that one.
- What "done" looks like — a passing test suite, a specific screen
  verified in a browser, a merged PR.
- Whether it's expected to push/merge/deploy itself, or hand back a
  diff/PR for review.
- Links to the specific doc sections relevant to the task (not just
  "read CLAUDE.md") — e.g. "adding a new notification channel, see
  [SPEC.md § 6](SPEC.md) and
  [CONTRIBUTING.md § Code style](CONTRIBUTING.md#code-style)."

## TODO

- [ ] No formal process exists yet for what an agent should do when it
  hits one of the two tooling-level gates above mid-task (retry later,
  hand back to the user, something else) — ask the project owner if
  this comes up in practice before assuming a default.
