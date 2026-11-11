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

## Git/commit hygiene specific to an agent

A human contributor mostly doesn't need these written down; an agent
does, since nothing else in this repo states them and a different
tool/session has no way to infer them:

- Always create a new commit; never `--amend` after a pre-commit hook
  failure — the commit didn't happen, so `--amend` would silently touch
  the *previous* commit instead.
- Never skip hooks (`--no-verify`) or bypass commit signing without an
  explicit, one-time ask.
- Never force-push to `main`.
- **Merge permission is granted per-PR, not blanket.** A prior "merge it
  all" covering one batch of work doesn't carry over to a PR opened
  later for an unrelated reason — ask again rather than assuming it
  still applies.
- If a merge is blocked for a reason outside this repo's control (see
  "Approval gates for autonomous action" above), don't retry or work
  around it — surface that it's green and ready, and wait.

## CI-polling cadence

The four checks (`lint`, `backend-tests`, `frontend-build`, `e2e`) take
roughly 3-4 minutes combined, `e2e` being the long pole (it boots the
real app against a fresh Postgres). Don't sleep before the first poll —
check immediately, then poll every 20-30s. Avoid a plain fixed-interval
loop that reprints identical output on every tick; only emit when the
check states actually change, or you'll spam duplicate updates for the
whole 3-4 minutes.

## Schema changes and redeploy caches

A `schema.prisma` change landing on a deploy that reuses a build cache
(dev-test, the production demo) can silently skip `prisma generate` and
serve a stale generated client against the new columns. Clear the
build cache on that redeploy rather than reusing it whenever a push
touches `schema.prisma` — see [RUNBOOK.md](RUNBOOK.md) for where that's
done.

## Screenshot maintenance

Identity/content conventions (church name, real seeded data, mocking
external APIs, restoring state afterward) are in
[CONTRIBUTING.md § Documentation screenshots](CONTRIBUTING.md#documentation-screenshots)
— that's the human-contributor-facing version. What follows is the
operational detail specific to an agent actually doing a capture pass,
not covered there.

**Fixed viewport, never `fullPage: true`.** Capture at `1280x900` for a
normal content/list/queue page, `1280x1400` for a settings/form page.
Check an existing screenshot's real dimensions
(`file docs/assets/screenshots/<similar-page>.png`) before guessing
which one a new page needs — `admin-partner-detail.png` is the one
deliberate exception, allowed to run long. Beyond just being the wrong
height, `fullPage: true` forces Playwright to scroll the whole page
before compositing the image, which can catch a sticky/floating element
(e.g. the `form-has-floating-actions` save bar) mid-transition and bake
it into the image stranded mid-page instead of pinned to the viewport
bottom where a real user always sees it. A fixed-viewport, non-fullPage
capture can't reproduce that bug at all — treat "did this page use
fullPage" as the first thing to check if a save bar ever looks wrong.

**A nav/sidebar change invalidates essentially every existing
screenshot, not just the pages that obviously relate to it.** The
sidebar is shared chrome on every admin page, so one nav edit (a link
added/removed/renamed, a page split, a group reordered) goes stale
everywhere it renders, independent of whether that page's own content
changed. Default to "recapture everything sidebar-visible" rather than
reasoning page-by-page about relevance.

When a nav/UI change lands, work through this instead of re-deriving it:

0. Get the demo state rich first — seeded partners with full profiles,
   About Church/Branding filled in with real content, a dispatch queue
   spanning its different visible states, prayer requests/one-time
   needs with more than one status represented, an unmatched email
   sitting in the queue — and set `ChurchSettings.backupReminderDisabled
   = true` so the backup-reminder banner doesn't show up in any admin
   capture. Once per sweep, not per screenshot. This has been built as
   a single process serving the production build (`frontend/npm run
   build` writes into `backend/public`; the backend then serves both
   the API and that build from one origin), not the two-process `:5173`
   dev split — so the stack to review live during/after a sweep is
   **`http://localhost:4000`** alone, whatever port `backend/.env`'s
   `PORT` resolves to (4000 by default). **Leave that server running
   when the sweep finishes, instead of tearing it down immediately** —
   the project owner reviews the result live before it ships; only tear
   down the scratch Postgres/`.env`/temp scripts once told the review is
   done, not as part of finishing the capture pass itself.
1. `ls docs/assets/screenshots/` for the full inventory, then
   `file docs/assets/screenshots/*` to record each file's current real
   dimensions — that's also your sizing target when recapturing it.
2. Classify every file as **sidebar-visible** (in scope, assume stale)
   or not: public site pages, GroupMe/WhatsApp's own apps, raw rendered
   email HTML, print/booklet output, and cropped UI-element shots with
   no sidebar in frame are the standing "not in scope" list.
   `docs/index.html` reuses a large share of this same pool directly (23
   of the 53 files in `docs/assets/screenshots/`, confirmed by grep) —
   it has no admin sidebar of its own, but several of the admin
   screenshots it embeds do, so recapturing one of those for
   `ADMIN_GUIDE.md`/`USER_GUIDE.md` means `docs/index.html` is showing
   the same now-stale image too. Review it in the same pass, not as an
   afterthought once the guides are done.
3. For every sidebar-visible file: log in as the demo admin, navigate to
   it on the current build, recapture at its existing viewport.
4. A handful need real state rebuilt, not just a nav change — an
   integration shown "fully configured" (simulate via a direct
   `ChurchSettings` write, not a real token), MFA enrollment (has to
   actually walk the TOTP flow), reports/booklet pages (need realistic
   filtered data present). Handle these as their own small scripts, not
   folded into the mechanical sweep.
5. **Identity check before anything ships, every time:** confirm
   nothing visible — "Signed in as," a user list, any real API response
   — shows a non-`@hillsidecommunity.org` email or the app's own
   technical demo login. Cheaper to check per-file up front than to
   catch it after a background fork has already captured and committed
   a batch.
6. This is long and mechanical — a good candidate to hand to a
   background fork once the inventory/classification above is done. The
   fork doesn't need re-briefing on identity/sizing/mocking conventions
   if this file and `CONTRIBUTING.md` are in its context; still
   spot-check its output against step 5 yourself rather than trusting
   its own self-report alone.
7. Update doc prose/anchors (across `ADMIN_GUIDE.md`, `USER_GUIDE.md`,
   and `docs/index.html` alike) only where the page itself moved or was
   renamed — separate from just refreshing a screenshot, don't touch
   wording that's still accurate.
8. Commit in reviewable batches (one logical group of pages at a time),
   not one giant commit — a bad capture is much easier to spot and redo
   from a small diff.

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
