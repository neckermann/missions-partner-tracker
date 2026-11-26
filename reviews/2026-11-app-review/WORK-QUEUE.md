# Work queue: running the review's fixes without supervision

**Written:** 2026-11-26. Decisions behind this are in [PLAN.md](PLAN.md); the findings and issue text are in [README.md](README.md). Issues: #489 to #497, plus notes on #477.

## Rules for an unattended run

Decided by the owner (D17 to D20):

1. **One item, one branch, one PR into `dev`.** Branch off `origin/dev` (named `fix/<short-name>` or `feat/<short-name>`), never off the review branch. CI runs on the PR (`ci.yml`).
2. **Merge to `dev` myself when CI is green**, except the in-app restore (16f), which waits for the owner. Never merge `dev` into `main`, and never open that PR: a merge into `main` is a release that every church's install follows (`release.yml`; #495).
3. **Schema changes go last, in one batch.** Do every no-migration item first. For the schema batch, make the change with `prisma migrate dev` (never hand-written, squashed into the baseline per `CLAUDE.md`), open the PR, and **stop for the owner before merging**, because dev-test's database then needs a reset that only the owner can approve.
4. **When stuck, skip it, note it, continue.** Leave a short comment on the item's issue (what was tried, what failed, what is needed), mark it `blocked` below, and move to the next independent item. Do not retry endlessly and do not stop the whole queue.
5. **Never, unattended:** touch Render (services, env vars, deploys, the demo reset), reset or migrate any remote database, read or print `demo/.env` or any `.env`, force a notification schedule to fire, or push to `main`.
6. **Every PR:** follow `CONTRIBUTING.md` and the `CLAUDE.md` hard rules (no hardcoded church values, relative URLs only, `useConfirmDialog` not `window.confirm`, no hand-written migrations). Tests for every behaviour change. Run `cd backend && npm test && npm run test:routes`, the frontend build and `npm run test:e2e` when the frontend changes, plus lint and prettier. Read the final diff once more with `/code-review` before merging. PR body: link the issue, say what changed and what was tested, and note anything skipped.
7. **After each merge:** tick the item below, and add one line under "Log" with the PR number.

### Running the tests locally (what worked in this container)

Postgres 16 is installed. `service postgresql start`; create a role and a database; export `DATABASE_URL`, `APP_BASE_URL=http://localhost:3000`, and the secrets the config check demands (`SESSION_SECRET`, and `FIELD_ENCRYPTION_KEY` once A10 makes it required; `npm run generate-secrets` prints values). Then `cd backend && npm ci && npx prisma migrate deploy`. Also export `NODE_ENV=test`, as CI does: without it the sign-in rate limits are the production ones and about 57 route tests fail with HTTP 429 (checked: the same 57 fail on plain `dev`). Without `APP_BASE_URL`, about 15 route tests fail (B14). Also run `npm ci` at the repo root, which provides the pinned eslint and prettier (`npx eslint <files> --quiet`, `npx prettier --check <files>`). With those set, A6 passed 427 unit tests and 1040 route tests.

## The queue, in order

Order is: safety first, then the install path, then the small bugs, then everything that touches the schema.

### Phase 1: no schema change

| # | Item | Issue | Notes |
|---|---|---|---|
| 1 | **A6** backup restore: read binary columns from the schema, add the round-trip and schema cross-check tests | #493 | A draft exists on local branch `fix/backup-bytes-fields` in the planning container (untested; its second test needed tidying). May be redone from scratch |
| 2 | **A2a** new partners start private: form default unticked, plain sentence on that step, visible public status on the partner page | #490 | Test: accepting every default is not returned by `/api/public/partners` |
| 3 | **A1** demo guards: `DEMO_TESTING_SITE` switch; block sends, AI scan, password and email changes, integration changes on a guarded demo; hide logins when the switch is on; reset stops restoring real credentials on a guarded demo | #489 | Biggest of the early items. Tests must stub the sending layer; nothing may reach a real service. Owner cleans the production demo when this ships |
| 4 | **A3** first admin: only one can ever be created (check and create as one step); `/` goes to `/setup` on an empty install; empty-state front page; guide line | #497 | Same file as item 5; do them back to back |
| 5 | **A9 small piece** first admin joins the missions team at setup; contact log and key-date reminders on by default | #477 (comment) | Defaults only; the wizard is #477's own work |
| 6 | **A4** new Privacy and safety page: restricted-partner settings, public directory and map switches; link from the restricted switch; remove the old box on Dispatches; guests cannot change visibility or restricted status (backend check and hidden controls) | #491 | |
| 7 | **A2b** public directory and map start off on a new install; one skippable screen after first sign-in (after two-factor enrolment): "Show your partners on a public website? Yes / Not yet", off if skipped | #490 | After items 4 and 6, which provide the setup flow and the switches' new home |
| 8 | **A7** remove the worker: schedulers and WhatsApp start from `server.js` behind a database advisory lock; delete `worker.js` and the worker service in `render.yaml`; fix docs and the cost figure | #494 | Test that overlapping instances do not double-fire. First task: measure memory on a local run if possible; the dev-test measurement is the owner's. Owner deletes the Render worker services after release |
| 9 | **A5** refuse to go live on a database that doesn't match the code; correct SPEC § 8.3 and UPGRADING.md; wipe-on-upgrade warning in README, UPGRADING.md and the marketing page | #492 | No freeze (D1). Stays within `CLAUDE.md`'s migration rule |
| 10 | **A8** install without a terminal: guides match the Deploy to Render button; `APP_BASE_URL` set in the Blueprint; true requirements and cost; region note; UPGRADING.md rewritten for no fork; warning about merges to `main` that rewrite the migration | #495 | Docs and `render.yaml` only. Cannot be tested on Render from here; say so in the PR |
| 11 | **B1** digest marks failed sends as sent | #498 | Stamp only rows that reached a recipient; keep the error visible |
| 12 | **B9** sign-in throttling: hop count as a setting with a start-up warning, plus a per-account limit | #504 | |
| 13 | **B7** scheduled jobs use the church's local date; time zone change takes effect without a restart | #502 | |
| 14 | **B8** dispatch records: (a) do not create one when no channel is on (GroupMe, WhatsApp, Email sending); (b) delete unsent rows older than 14 days, one constant. Rows held for review (`needsReview`: restricted partner or care-team entry) are kept | #503 | Read `dispatchRecording.js`, `dispatchOrchestrator.js` (the "vacuous case" guard keeps rows no on-channel applies to) and the readers: the bell (`notifications/categories.js`), Pending Dispatches, the communication report. Test the all-off case, the "channel on but row doesn't apply" case, and that held rows survive |
| 15 | **B10** email receiving: hold auto-filed mail for a quick review by default (admins can switch it off); cap and expire the unmatched queue | #505 | May need a column; if so, move to Phase 2 |
| 16 | **B12** seed: seeded people inactive or random printed password; seed creates the settings row it needs | #507 | |

| 16a | **B2** email "on but not ready" is treated as off everywhere (use the existing copy-link fallbacks) and one "Email isn't finished setting up" notice is shown. Does not tackle the Postmark-is-hard question | #499 | Covers Add User dead end and the Subscribe page's false "check your email" |
| 16b | **B11** guest wording: one line at each place a care-team guest is told what they are, what is hidden, and that their entries wait for approval; the Add User form stops offering Guest when it cannot be used and no longer calls it trips-only | #506 | |
| 16c | **B15** dead ends: no bell item or link leads to a switched-off or hidden page; Enabled Features no longer says updates "wait on Pending Dispatches" when that page is blocked; Monthly Support gets a menu entry | #510 | |
| 16d | **B6 part 2** ask for the admin's password again before a backup download; replace the restore guide's "temporary, unlisted file host" advice with safe handling; read-only: record in the issue what Render's Postgres plan already backs up (no change to Render). **Optional passphrase encryption of the downloaded file**, with a clear warning that a lost passphrase cannot be recovered; unencrypted stays available (D27) | #501 | Scheduled backups deferred (D25) |
| 16f | **B6 part 3** restore from inside the app, for a church that cannot run `npm run backup:restore`. Requires: admin re-enters password; upload the file; typed confirmation; asks for the passphrase if the file is encrypted; checksum and migration-version check (as the CLI does); an automatic backup of the current data first; the site refuses other writes while it runs; the whole restore is one transaction (as `restoreRows` already is); an audit entry. Replaces the guide's "CLI-only" reasoning | #501 | Largest, riskiest item: a bug here wipes a church's data. Tests against a real database for every guard; cannot be tried on dev-test unattended. Put after 16e. Opens the PR but is **not** merged to `dev` without the owner (rule 2 exception) |
| 16e | **B5** plain words, using report 1's jargon table (exact string, file, replacement), including the ticket number printed at `AdminDispatchSettings.jsx:313`; update tests | #500 | Last in Phase 1: touches many files, so run it after the others to avoid conflicts |

| 16g | **C12** a plain warning before a restricted partner's letter is sent to the AI scan, and guests cannot trigger the scan | #512 | Near #325 |
| 16h | **C13** partner photos are no longer reachable by web address when the partner's settings say they shouldn't be public | #513 | Read how photos are served before changing anything |
| 16i | **C14** link fields accept only web addresses (http and https), not any text | #514 | |

| 16j | **C9a** Record Decision gets a decline option; a one-time need can be saved without a dollar amount | #511 | Read the need and decision code first to confirm the current states; check reports and email text that assume an amount |
| 16k | **B14** docs pass, last in Phase 1: SPEC § 4 feature list and § 5 numbering, ADMIN_GUIDE care-teams count, `APP_BASE_URL` documented as required, other written inaccuracies from report 4. Screenshots are left for the owner | #509 | Run after every code item so the docs describe what shipped |

Issues for the B and C items were filed on 2026-11-26 (#498 to #514) and are linked in the Issue column. Link the issue in each PR.

### Phase 2: schema batch (stop before merging)

| # | Item | Issue | Notes |
|---|---|---|---|
| 17 | **A10** two-factor: recovery codes at enrolment; documented command to clear two-factor; `FIELD_ENCRYPTION_KEY` required at start-up; encourage a second admin in setup | #496 | New table or columns. Check `render.yaml`, docs and the demo setup so existing deployments still start |
| 19 | **C9b** a one-time need gets a "someone's on it" / "met" state, shown on the need and in the bell and reports where needs are counted | #511 | New column or table; confirm the state names with the owner once the code is read |
| 18 | **B13** the Bible passage on the public subscribe page becomes a church setting, empty by default | #508 | New column |

One PR for the batch is fine. Open it, then stop and report. The owner approves the dev-test reset.

### Not in the queue

- **B3, B4 (both stay in #477), scheduled backups (B6 part 1)** and the whole C group: larger, or decisions first. B3 and B4 belong to #477. B14's docs fixes are partly picked up by A8 and A5; the rest waits.
- **The Viewer role, WhatsApp removal, the "Trips departing soon" alert, what to do with trips (C1 to C3):** owner decisions, undecided. WhatsApp stays (D12).

## Owner tasks (not mine)

- [ ] Give dev-test its own `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` in Render, and set `DEMO_TESTING_SITE=true` there once A1 ships.
- [ ] Clean up the production demo (remove or revoke the GroupMe, Postmark and Anthropic values; unpair any WhatsApp number) when A1 reaches production.
- [ ] Delete the production and dev-test worker services on Render after A7 ships.
- [ ] Approve and run the dev-test database reset after the Phase 2 batch.
- [ ] Decide when to merge `dev` into `main` (a release for every church).
- [ ] Test the Blueprint on a real Render account (default name taken? address? `APP_BASE_URL`?).

## Status

Update this table as items land.

A6's PR is #515.

| # | Item | Status | PR |
|---|---|---|---|
| 1 | A6 | merged to dev | #515 |
| 2 | A2a | merged to dev | #516 |
| 3 | A1 | merged to dev | #517 |
| 4 | A3 | merged to dev | #518 |
| 5 | A9 small piece | merged to dev | #519 |
| 6 | A4 | merged to dev | #520 |
| 7 | A2b | merged to dev | #521 |
| 8 | A7 | merged to dev | #522 |
| 9 | A5 | merged to dev | #523 |
| 10 | A8 | merged to dev | #524 |
| 11 | B1 | merged to dev | #525 |
| 12 | B9 | PR open, CI running | #526 |
| 13 | B7 | not started | |
| 14 | B8 | not started | |
| 15 | B10 | not started | |
| 16 | B12 | not started | |
| 16a | B2 | not started | |
| 16b | B11 | not started | |
| 16c | B15 | not started | |
| 16d | B6 part 2 | not started | |
| 16e | B5 | not started | |
| 16f | B6 part 3 | not started | |
| 16g | C12 | not started | |
| 16h | C13 | not started | |
| 16i | C14 | not started | |
| 16j | C9a | not started | |
| 16k | B14 | not started | |
| 17 | A10 | not started | |
| 18 | B13 | not started | |
| 19 | C9b | not started | |

## Log

- 2026-11-26: item 1 (A6) merged to `dev` as #515 after all four checks (backend-tests, lint, frontend-build, e2e) passed. Item 2 (A2a) merged as #516 (all four checks green). #490 stays open for A2b. Item 3 (A1) opened as #517; a code review of the first version found four real problems (email settings guard on the wrong method, remote reset scripts, the worker, setup links), all fixed before merge. #517 merged after all four checks passed. Owner follow-ups from #517: set `DEMO_TESTING_SITE=true` on dev-test's web service AND worker, give it its own `DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD`; clean the production demo's keys. Item 4 (A3) merged as #518 (all four checks green; CI's e2e job also runs the whole route suite, which passed on a clean database). Item 5 merged as #519 (all four checks green). Item 6 (A4) merged as #520 (all four checks green): new Privacy and safety page, guests can no longer change the public/restricted flags (an existing care-team test that asserted the old behaviour was rewritten). Item 7 (A2b) opened as #521 (its first e2e run failed on four map specs: the route tests leave the public flags unset and the map is now off by default, so CI's "enable trips for e2e" step now also enables the public directory and map; reproduced locally): directory and map off by default, one-time question after first sign-in; 17 existing route tests that assumed the public directory was on were updated to turn it on themselves. Lesson: a route test that changes shared settings (setup turns two-factor on) must restore them, or later test files cannot sign in; and a route-suite run must not be killed mid-way (use a background run), or it leaves fixture users behind that fail later runs.

- 2026-11-26: item 8 (A7) merged to `dev` as #522 after all four checks passed. Owner follow-ups: delete the production and dev-test `...-worker` services in Render (they will fail to start now). Local memory check: the web process alone ~227 MB, with the jobs ~239 MB; to confirm on dev-test.
- 2026-11-26: item 9 (A5) opened as #523: the server refuses to start on a database whose migration was rewritten; the next deploy of any out-of-date database (dev-test, the demo) will fail until reset. #521 hit a changelog merge conflict with #522 and was brought up to date.
- 2026-11-26: items 7 (A2b, #521) and 9 (A5, #523) merged to `dev` after all four checks passed on their final heads. Item 10 (A8) started.
- 2026-11-26: item 10 (A8) opened as #524 (docs and Blueprint comments only). Checked the review's claim that `APP_BASE_URL` is missing from the Blueprint: wrong, every link already falls back to Render's `RENDER_EXTERNAL_URL`, so no Blueprint change; the guide now says so. Not verifiable from here: whether the default service name is accepted when taken, and the exact address a fresh install gets (needs one real test deploy).
- 2026-11-26: item 11 (B1) opened as #525. #524 (A8) had one e2e failure in the route tests that run inside that job (1052 of 1055 passed, 2 skipped, 1 failed; the diff is docs only and no test reads them; B1's full local run is 1060/1060): failed jobs re-run once. Also noted: in CI the two first-admin tests are skipped by their own safety check (the e2e admin is created before the route tests run), so they only run locally.
- 2026-11-26: item 10 (A8) merged as #524 after its failed e2e job passed on the one allowed re-run (all four checks green). The single route-test failure on the first run was not reproduced and its test was not identified (the PR is docs only, and B1's full local route suite is 1060/1060): treat it as an unexplained one-off, and look at the first-attempt log of job 140141282660 if it recurs.
- 2026-11-26: item 11 (B1) merged as #525 (all four checks green). Item 12 (B9) started.
- 2026-11-26: item 12 (B9) opened as #526. At the owner's request the dev-test worker service on Render was deleted (it followed `dev`, which no longer has `worker.js`). The production worker was left running on purpose: it follows `main`, which still has the old code until the first release; delete it after `dev` is merged into `main`.
