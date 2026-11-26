# 4. General problems: docs, comments, screenshots, recurring issues and bugs

**Status: Checked by the lead reviewer, 2026-11-26. The findings listed under "Lead check" were re-checked; the rest stand as the helper reported them.**

> **Lead check**
> - **G2 confirmed (read in the code):** `surveyUpload` is in the backup's model list (`backend/src/utils/backup.js:94`) but missing from the binary-fields list (`backup.js:148-156`). I did not re-run the restore.
> - **G3 confirmed (read in the code):** rows are added to the "considered" set before the send (`backend/src/utils/emailDispatchDelivery.js:141`), a failure only writes an error note (`:176`), and the scheduler then stamps every considered row as sent and clears the error (`backend/src/utils/emailDispatchScheduler.js:85-89`). Nobody has run a real send.
> - **G4 confirmed (read in the code):** `render.yaml:127-140`.
> - **G6 confirmed in part (read in the code):** the seed gives its example accounts one fixed password (`backend/prisma/seed.js:2431`). I did not re-run the sign-in.
> - **G7 reproduced by the lead** while setting up: the seed stops at `seed.js:2350` on a freshly created empty database. Installing the backend also failed for me with no database address set, which is what a person hits if they run the install before creating `.env`.
> - **G1 not re-run.** It is consistent with RUNBOOK.md's own entry "A squashed-migration deploy reports `live`, but the schema never actually changed".
> - **Not re-checked:** G5, G8 to G14, the test-suite counts, the screenshot comparison and the closed-issue reading.
**Reviewed:** branch `dev` at e713437 (0.1.0-beta.3), 2026-11-26.

## Summary

The app is not ready to invite churches yet, for reasons that have little to do with features. A church that installs today and later presses "Sync fork" gets a site that reports a healthy deploy and then errors on every page, and the only documented way out is to erase the database. The backup that is supposed to be the safety net could not be restored from the seeded data set (it fails as soon as one survey photo is waiting for approval). The setup guide understates the monthly cost and skips the one manual step the background worker needs, without which scheduled email silently never sends. The email digest marks updates as sent even when the send failed. The test suites are healthy (all green once the environment matches CI), the docs link checker passes, and I found no restricted-partner leak in any send path I read. The docs and screenshots have drifted again since the last sweep, two days ago.

## Test-suite results

| Suite | Command | Result |
|---|---|---|
| Docs links | `npm run check:docs` | "Documentation links OK." |
| Backend unit, no `DATABASE_URL` | `cd backend && npm test` | 285 pass, **12 fail** (12 test files crash on load: `prismaClient.js` cannot parse an unset `DATABASE_URL`) |
| Backend unit, `DATABASE_URL` set | same | 427 pass, 0 fail, 0 skipped |
| Backend routes, set up as `scripts/test-db.js` does (local Postgres `mpt_general_test`, `NODE_ENV=test`) | `npm run test:routes` | 1015 pass, **15 fail**, 0 skipped |
| Backend routes, plus `APP_BASE_URL=http://localhost:4000` (which CI sets) | same | 1030 pass, 0 fail, 0 skipped (181 s) |
| Frontend unit | `cd frontend && npx vitest run` | 71 files, 467 pass, 0 fail |

No flaky tests seen in two route runs. The 15 route failures are all the same cause (see G9). Playwright e2e was not run.

---

## Findings

### G1. Upgrading breaks a live site without warning, and the only fix erases the church's data

- **What is wrong:** Before 1.0 the project rewrites its single database migration in place for every schema change. An existing database sees that migration as already applied, so the upgrade step does nothing and reports success. The new code then runs against the old tables. Both upgrades between betas so far (beta.1 to beta.2, beta.2 to beta.3) have needed a full database reset.
- **Where:** `backend/prisma/migrations/20261122092854_init/`; `render.yaml` `preDeployCommand`; `backend/src/server.js:255` (health check does not touch the database); UPGRADING.md "Sync fork" section and step 4; SPEC.md § 8.3; CHANGELOG "Upgrading" entries for beta.1, beta.2, beta.3.
- **Who it affects:** Every church that installs now and upgrades later. On Render, a push to the fork's `main` redeploys automatically, so pressing GitHub's "Sync fork" button is enough to trigger it.
- **Evidence:** I built a database from the baseline as it stood at commit 4a27b3e (package version 0.1.0-beta.1), then ran today's `npx prisma migrate deploy` against it: "No pending migrations to apply", exit 0. Starting today's server on that database: `/api/health` returns 200, `/api/public/settings` returns a server error ("The column `ChurchSettings.groupmeCareTopicId` does not exist"). Render would therefore mark the deploy live. SPEC § 8.3 says the opposite ("expected to fail at `preDeployCommand` ... the live site stays up"); RUNBOOK.md "Common failures" describes the silent variant correctly. UPGRADING.md's "easy way" never mentions a reset; the warning sits in step 4 of "the manual way" and in the CHANGELOG. The CHANGELOG's advice is "back up first", but a backup made on the old version cannot be restored into the new one (see G2), and beta.3's note says "There is nothing to carry across before 1.0".
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Stop squashing before the first church is invited: from that release on, every schema change is a normal additive migration made with `prisma migrate dev`, so `migrate deploy` upgrades real data. Until then, say plainly at the top of README, UPGRADING and the marketing page that an install made today will have to be wiped. Make the health check (or a start-up check) fail when the database does not match the code, so a bad upgrade never goes live. When to end the squash convention is a decision for the owner.
- **How I know:** reproduced in the running app

### G2. A backup cannot be restored if any survey photo is waiting for approval

- **What is wrong:** The backup file stores a survey's uploaded photo in a form the restore cannot read. The restore runs as one all-or-nothing step, so the whole restore fails and nothing is restored.
- **Where:** `backend/src/utils/backup.js:144` (`BYTES_FIELDS` has no entry for `surveyUpload`; schema `SurveyUpload.bytes Bytes`); `backend/scripts/restore-backup.js`.
- **Who it affects:** Any church using Partner surveys with a photo question, on the day they need their backup.
- **Evidence:** Built a backup from a seeded database with the app's own `buildBackup`, then ran `node scripts/restore-backup.js` into a freshly migrated empty database: exit 1, "Invalid `prisma.surveyUpload.create()` ... Argument `bytes`: Invalid value provided. Expected Bytes, provided Object." With that one field corrected in memory (scratch script, no repo change) the same file restored all 1,981 rows, so this is the only blocker in the seeded data. `test/routes/backups.test.js` has no survey upload in it.
- **Related, read in the code or docs only:**
  - The "wrong version" safety check compares migration names, and the name never changes before 1.0, so it cannot tell a beta.2 backup from a beta.3 one. An old backup passes the check and then fails on the first changed column.
  - The backup is built entirely in memory (`backups.js`, `buildBackup`), every photo and document included, on a 512 MB service. Inferred: a church with a few hundred MB of files may not be able to download a backup at all. Not tested.
  - ADMIN_GUIDE.md "Restoring a backup" step 2 tells the admin to put the file on "a temporary, unlisted file host". The same guide calls this file "the most sensitive thing this app can produce" (unmasked restricted partners, password hashes).
  - Restore is command-line only, through Render's Shell. A volunteer admin will not manage that alone.
  - WhatsApp must be linked again after a restore (documented in the WhatsApp section, not in the restore section). Two-factor secrets and integration keys survive only if `FIELD_ENCRYPTION_KEY` is the same; the guide says so.
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Add `surveyUpload: ["bytes"]`, and add a test that backs up and restores a database containing one row of every model with a binary column. Record the app version in the safety check, not only the migration name. Replace the "file host" advice. Longer term a church needs a restore it can do from the screen; whether to build that is a decision for the owner.
- **How I know:** reproduced in the running app (the restore failure); the related points are read in the code or inferred as marked

### G3. The email digest marks updates as sent when the send failed, and wipes the error

- **What is wrong:** When the digest goes out, every update that was meant for at least one person is stamped "sent" for that schedule, whether or not the email provider accepted the message. The same step clears the error that had just been recorded, so the "Dispatch send failures" notice never sees it. Once stamped, the update is removed from the queue.
- **Where:** `backend/src/utils/emailDispatchDelivery.js:130-185` (`consideredIds` is filled before sending; failures only write `emailError`); `backend/src/utils/emailDispatchScheduler.js:83-92` (`runEmailDispatchTier` stamps all of them and sets `emailError: null`); the urgent path does the same at `dispatchOrchestrator.js:262-274`.
- **Who it affects:** Digest readers and public subscribers, whenever the provider rejects messages (a bounced address, or everyone if the sender address is not yet approved). Admins, who are told nothing.
- **Evidence:** On a scratch copy with the email sender replaced by a stub that fails every message, `sendDigestTier("monthly")` logged the failure and still returned 8 queue rows for the scheduler to stamp as sent. The comment at `emailDispatchDelivery.js:181` ("a failed send records nothing and retries") is true only for key dates, not for the updates themselves.
- **Severity:** causes real confusion
- **Recommendation:** Stamp a row only when at least one message carrying it was accepted, and do not clear `emailError` on rows whose messages failed.
- **How I know:** read in the code (supported by the stubbed run above; no schedule was fired)

### G4. The setup guide skips the step the worker needs, and understates what the worker does

- **What is wrong:** Three linked problems in the Render walkthrough.
  1. The worker's encryption key must be copied by hand from the web service after both exist (`render.yaml` says so in capitals). The walkthrough never mentions it; step 3 says the keys are "generated automatically, nothing to enter" and to leave the prompted values blank.
  2. Without that key the worker still starts (a missing key is only a warning), but cannot read the stored email or GroupMe credentials.
  3. "Skipping the worker service" says the worker only runs "four schedules" (GroupMe, WhatsApp, the digest, trip reminders). It also runs key-date reminder emails, partner care chat posts, scheduled report emails and the nightly audit-log clean-up.
- **Where:** ADMIN_GUIDE.md lines 86-104 and 122-167; `render.yaml` lines 118-140; `backend/src/worker.js:43-49`; `backend/src/config/env.js:60-75`.
- **Who it affects:** Every church following the recommended install that later turns on email, GroupMe or WhatsApp.
- **Evidence:** `worker.js` starts seven schedulers. With no key, `email.js` cannot decrypt the Postmark token, so each digest attempt throws and is only written to the worker's log; GroupMe at least records "Could not decrypt stored GroupMe token" on each queued row. The guide itself admits "nothing in the admin UI currently checks whether the worker is actually running" (closed issue #300 was resolved with that paragraph and a static notice).
- **Severity:** blocks adoption or is unsafe (scheduled sends silently never happen on a by-the-book install)
- **Recommendation:** Add the copy-the-key step to the walkthrough, with a picture. Better, remove the need for it (for example, have the worker refuse to start without a usable key, or run the schedules inside the web service for a single-church install and drop the second service; that is a decision for the owner). Have the worker record a "last seen" time and show a warning on Dispatch Settings and Home when it is stale. Correct the list of what stops without the worker.
- **How I know:** read in the code (worker not started, per the review limits)

### G5. The published cost is about $13 a month; the recommended install creates about $20 a month of services

- **What is wrong:** README (twice), ADMIN_GUIDE and the marketing page all say "about $13/mo" for "one web service plus one Postgres database". The blueprint creates a third paid service, and its own comment says "about $13/mo for the web service + database, plus another ~$7/mo for the worker".
- **Where:** README.md lines 53 and 90; ADMIN_GUIDE.md line 104; `docs/index.html` line 317; `render.yaml` lines 16-19 and the `type: worker` service. Open issue #430 repeats the $13 figure.
- **Who it affects:** A church budgeting for the app, and their trust when the first bill arrives.
- **Evidence:** As quoted. Add Postmark's own fee if email is used; no guide gives a total.
- **Severity:** causes real confusion
- **Recommendation:** State one honest number everywhere, with what it includes, and what it drops to if the worker is deleted.
- **How I know:** read in the code (Render's current prices were not checked)

### G6. The "optional demo data" step adds working logins with a published password

- **What is wrong:** `npm run seed`, offered in README's Quick start and ADMIN_GUIDE's local setup as "optional: ~35 fake partners for demoing", also creates active editor and viewer accounts whose password is written in the public repo, with no two-factor. Nothing in those guides says so. The seed does not wipe existing data, so an admin can run it on a real instance to "see what it looks like".
- **Where:** `backend/prisma/seed.js:2429-2450`; README.md "Quick start"; ADMIN_GUIDE.md "Local development setup".
- **Who it affects:** Any church that seeds an instance it then keeps. Those accounts can read every partner, restricted ones included.
- **Evidence:** On my local seeded copy, signing in as `patreynolds@example.org` with the seed's password returned a full editor session.
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Seed the fake partners without logins unless a demo flag is set, or refuse to seed when real users already exist. Say in both guides that the seed is for throwaway databases only.
- **How I know:** reproduced in the running app

### G7. The Quick start fails at the seed step

- **What is wrong:** Following README or ADMIN_GUIDE in order (migrate, seed, create admin), the seed stops with an error on a new database because it updates a settings row that does not exist yet. It has already written partners and users by then, so the database is left half-seeded.
- **Where:** `backend/prisma/seed.js:2350`; README.md lines 127-133; ADMIN_GUIDE.md lines 416-421.
- **Who it affects:** Every new contributor, and any technical volunteer evaluating the app locally.
- **Evidence:** Fresh database, `npx prisma migrate deploy`, `npm run seed`: "No record was found for an update ... `seedTripsDemo` (seed.js:2350)". `scripts/test-db.js` avoids it by setting `SEED_DEMO_EXTRAS=false`, which is why CI does not catch it.
- **The other lead, checked:** `npm ci` failing without `DATABASE_URL` does not hit someone who follows the docs, because they copy `.env.example` first and it contains a placeholder URL. It does hit anyone who installs before creating `.env`.
- **Severity:** causes real confusion
- **Recommendation:** Use an upsert in the seed. Add a CI step that runs the plain seed on an empty database.
- **How I know:** reproduced in the running app

### G8. Outside Render, a new install without the encryption key locks the first admin out

- **What is wrong:** The guides call `FIELD_ENCRYPTION_KEY` "Recommended" and say that without it "only two-factor enrollment fails". A new install requires two-factor from the first sign-in, so the first admin can create the account and then can never finish signing in. The screen says only "Server error".
- **Where:** ADMIN_GUIDE.md environment table; `backend/.env.example` lines 33-35; `backend/src/routes/auth.js:140-150` and `:512-523`; `backend/src/config/env.js`.
- **Who it affects:** Self-hosters not on Render (Render generates the key).
- **Evidence:** Empty database, no key: `POST /api/auth/setup` 201, `POST /api/auth/login` returns `mfaSetupRequired`, `POST /api/auth/mfa/setup` returns 500 "Server error" (log: "FIELD_ENCRYPTION_KEY is not set").
- **Severity:** causes real confusion
- **Recommendation:** Treat the key as required (refuse to start, as for `SESSION_SECRET`), and mark it "Yes" in the table.
- **How I know:** reproduced in the running app

### G9. The site's own address is treated as optional, but much of the app needs it

- **What is wrong:** `APP_BASE_URL` is documented as optional, "only needed for ... the GroupMe newsletter notification ... nothing else in the app needs this". Today it is needed for welcome and password-setup emails, password reset, emailed sign-in links, passkeys, survey links, public subscription confirmations (silently not sent without it), trip links and the unsubscribe link. On Render the app falls back to the `onrender.com` address, so a church with its own domain gets emails that link to the Render address, and passkeys tied to the wrong host. No guide mentions custom domains.
- **Where:** `backend/.env.example` lines 9-17 (also points at `utils/groupme.js`, which no longer exists); ADMIN_GUIDE.md environment table; RUNBOOK.md "optional, app degrades gracefully"; code: `passwordSetup.js:36`, `publicSubscribeEmails.js:8,22`, `welcomeEmails.js:86,132`, `passkeys.js:12-24`, `surveys.js:388,481`, `passwordless.js:114`.
- **Who it affects:** Self-hosters off Render; any church with a custom domain; contributors (this is why 15 route tests fail locally: CI sets the variable, CONTRIBUTING and `scripts/test-db.js` do not).
- **Evidence:** Route tests without it: unsubscribe header is `<null>`, the password-setup email is not sent (`0 !== 1`), trip links come back relative. With it: 1030 of 1030 pass.
- **Severity:** causes real confusion
- **Recommendation:** Document it as required off Render and whenever a custom domain is used; better, ask for the site address in first-run setup and keep it in `ChurchSettings`. Add it to `test-db.js`'s printed instructions.
- **How I know:** reproduced in the running app (test runs) and read in the code (custom-domain effect is inferred)

### G10. Updates pile up for a church with no channel on, then all post at once when one is switched on

- **What is wrong:** Every prayer request, need and newsletter is queued for sending even when GroupMe, WhatsApp and email are all off. The clean-up deliberately keeps a row that has reached nobody. Nothing ever ages rows out. When the church later turns on GroupMe or WhatsApp, the next daily post takes the whole backlog, however old. The opposite also holds: when a channel is merely off at the moment another channel finishes, the row is cleared for good and the channel never gets it (SPEC § 6.1 says so; no screen does).
- **Where:** `backend/src/utils/dispatchOrchestrator.js:86-96` (the "vacuous case" guard) and `:25-27`; `groupmeChannel.js` `runGroupMePass` (takes every eligible row); `dispatchRecording.js` (always records).
- **Who it affects:** A church that runs the app for months and then connects its group chat: the group receives months of old requests in one burst.
- **Evidence:** As read. Pending Dispatches has a per-row delete only.
- **Severity:** causes real confusion
- **Recommendation:** When a channel is first switched on, start it from "now" (stamp or clear what is already queued, after asking). Drop queue rows older than a set age. Say on the settings screen what happens to waiting updates when a channel is turned on or off.
- **How I know:** read in the code

### G11. Key-date reminders and partner care posts use the wrong day east of about UTC+5

- **What is wrong:** The 05:00 and 07:00 daily jobs run at church-local time but then work out "today" from the UTC calendar. For a church in India, South-East Asia, Australia or New Zealand, that is still yesterday, so every "days until" is one too many and reminders arrive a day late. This is the same class of bug that issue #253 fixed for reports by adding `resolveToday`; the newer jobs do not use it.
- **Where:** `backend/src/utils/keyDateReminderScheduler.js:24,38`; `careChatDispatch.js:137,144`; `emailDispatchDelivery.js:86`; `keyDateQueries.js:35` (`toUtcDay(today)`); compare `backend/src/utils/today.js`.
- **Who it affects:** Churches outside the Americas and Europe.
- **Evidence:** With `TZ=Asia/Singapore` at 07:00 local on 26 November, `toUtcDay(now)` gives 2026-11-25 and `resolveToday` gives 2026-11-26.
- **Severity:** minor (causes real confusion for an affected church)
- **Recommendation:** Pass `resolveToday()` into these jobs. Add a test that runs them under an eastern timezone.
- **How I know:** read in the code (the date arithmetic was run; the jobs were not)

### G12. Changing the timezone does nothing until both services restart

- **What is wrong:** The timezone is read once when each process starts. A new church that sets its timezone after first sign-in keeps sending at the old zone's hours (the default is US Central) until the next deploy. The About screen says "takes effect the next time the app restarts"; a volunteer has no idea how to restart two Render services.
- **Where:** `backend/src/worker.js:26-39`, `server.js:273-286`, `frontend/src/pages/AdminSettingsAbout.jsx:223`.
- **Who it affects:** Every church not in US Central time, in its first weeks.
- **Evidence:** As read.
- **Severity:** causes real confusion
- **Recommendation:** Have the schedulers read the timezone from settings on each tick (compute the local hour with `Intl.DateTimeFormat` for that zone) so the change is immediate.
- **How I know:** read in the code

### G13. Money is whole US dollars only

- **What is wrong:** Every amount (monthly support, needs, trip contributions, budgets) is a whole number, and the screen shows "$". A cheque for $127.50 cannot be logged as given. The currency is a code default, not a church setting, which is against the project's own first rule for a church outside the US.
- **Where:** `backend/prisma/schema.prisma` (`amount Int` at 598, 891, 958); `backend/src/routes/trips.js:926`; `frontend/src/pages/AdminTripContributions.jsx:186`; `frontend/src/utils/format.js:75`.
- **Who it affects:** Trip leaders logging real gifts; any non-US church.
- **Evidence:** As read. No rounding bug exists because there are no fractions at all.
- **Severity:** minor
- **Recommendation:** Either say "whole dollars" beside each amount box, or store cents. Put the currency in `ChurchSettings`. Which is a decision for the owner.
- **How I know:** read in the code

### G14. Smaller sending and scheduling bugs

| # | What | Where | Effect |
|---|---|---|---|
| a | A trip meeting reminder is marked sent even if every email failed (the send helper swallows errors) | `tripReminderScheduler.js:36-62`, `tripEmails.js:75-78` | A provider outage at the wrong hour means no reminder and no retry |
| b | If the email provider throws part-way through a digest of more than 250 recipients, or the worker restarts mid-send, the whole digest is sent again on the next minute, for as long as the hour lasts | `emailDispatchScheduler.js:83-92`, `emailDispatchDelivery.js:166` | Duplicate digests (large lists only) |
| c | A monthly digest fires only during one hour of one day. If the worker is down for that hour, that month's digest is skipped until next month | `emailDispatchScheduler.js:62-70` | A missed month, no notice |
| d | A send hour of 2 is skipped on the spring clock-change day | `chatSchedule.js:9`, `emailDispatchScheduler.js:52,64` | One missed day (or month, for the digest) |
| e | A scheduled report that fails for one recipient is retried the next day for all of them | `reportScheduler.js:96-115` | Duplicates for the earlier recipients |

All: minor, read in the code.

I found no path that sends a restricted partner's real name or text: every channel I read goes through `buildBlurb`, and `isRestricted` is read fresh at send time.

---

## Docs that say something the code does not do

The serious ones are G1, G4, G5, G7, G8 and G9 above. The rest:

| Doc | Claim | What is true |
|---|---|---|
| SPEC.md § 4 | Lists 17 features | The registry has 23. Missing: Contact log, Key-date reminders, Care teams, Support preferences, Partner surveys, Audit log (on by default). AI Features is shown with no dependency; it requires Newsletters & Docs |
| ADMIN_GUIDE.md "What each feature needs" | Key-date reminders, Support preferences, Partner surveys and Contact log need Care teams | None of them do (`features.js` has no such `requires`; CHANGELOG beta.3 says the requirement was removed) |
| SPEC.md § 5 | Sections run 5.7, 5.9, 5.10, 5.8 | Out of order |
| SPEC.md § 8.3 | A squash "is expected to fail at preDeployCommand" | It succeeds silently (G1) |
| SPEC.md § 8.4, RUNBOOK.md env list ("verified ... nothing inferred") | Complete list of variables | Missing `DEMO_GUEST_PASSWORD`, `RENDER_SERVICE_NAME`, `RENDER_GIT_COMMIT`, `DEMO_DATABASE_URL`, `DEV_DEMO_DATABASE_URL`, `RESET_URL` |
| SPEC.md § 9 item 2 | Two cron registrations in `emailDispatchScheduler.js` and `groupmeChannel.js` | Both are in `emailDispatchScheduler.js`; the worker now registers eight |
| ADMIN_GUIDE.md about line 1000 | Schedules run "inside `server.js`", one web service | They run in the worker |
| README.md "Auth" | "a new install starts with [two-factor] on" | True through the `/setup` screen. Not true through `createAdmin.js`, which is the path README's own Quick start uses |
| `backend/.env.example` | "This project's own deployment uses Neon" | The blueprint uses Render Postgres |
| CONTRIBUTING.md "Running tests" | Unit tests cover masking and auth; "routes ... aren't covered by these unit tests, that's what the e2e suite is for" | There are 77 route test files |
| `backend/test/routes/helpers.js:6-8` (comment) | "the unit suite still runs with no database at all" | 12 unit test files fail without `DATABASE_URL` |
| `backend/scripts/restore-backup.js` closing message | Lists MFA, GroupMe, Joshua Project, Anthropic keys | Omits Postmark and the WhatsApp link |
| `backend/src/utils/keyDateQueries.js:25` (comment) | "`today` is a UTC-day Date" | The schedulers pass the current instant (G11) |
| "Last verified" headers | CLAUDE.md, RUNBOOK.md, WORKFLOW.md: 2026-11-11. AGENTS.md, STYLE-GUIDE.md: 11-22. SPEC.md, ARCHITECTURE.md: 11-23 | The worker split, care teams, surveys, passkeys and the beta track all landed after 11-11 |

`npm run check:docs` checks links and anchors only, so it passes while all of the above stand.

## Screenshots

`docs/assets/screenshots/` holds 99 files (not about 53). Every file referenced by the guides and the marketing page exists. One file is unreferenced: `surveys-template.png`.

Compared against the current app (seeded local copy, all features on):

| Screenshot | Stale because |
|---|---|
| `care-teams-settings.png` | Page is now "Partner Care"; "Default lead" card is now "Missions team"; new "Email digest for new members" card; new "Earlier heads-ups" timing line; sidebar says "Care Teams" |
| `enabled-features.png` (also on the marketing page) | No Partner surveys row; Key-date reminders and Support preferences still say "Needs Care teams"; none of the "Without email" lines; sidebar says "Care Teams", no "Surveys" |
| `manage-users.png` | Missing the "Passkey sign-in" card and the helper lines under both other cards; emails are now links |
| `admin-home.png` (and every admin shot showing the foot of the sidebar) | The sidebar now ends with a System / Light / Dark switch; "Survey Updates" entry missing |
| Every admin shot with Settings expanded | Sidebar shows "Care Teams" where the app shows "Partner Care", and has no "Surveys" entry |

Not viewed, but the page changed after the screenshot's last commit (inferred stale): `add-user.png`, `add-user-care-team.png`, `account-settings-digest.png`, `my-account-passkeys.png`, `login-page.png`, `care-team-and-contact.png`, `contact-card-caution.png`, `contact-card-instructions.png`, `assign-care-team.png`, `dispatch-settings.png`, `groupme-settings.png`, `whatsapp-settings.png`, `pending-dispatches.png`, `admin-partner-detail.png`, `enabled-features-admin.png`.

This is the fifth time (issues #178, #264, #266, #321, #380). Recommendation: generate the screenshots from a script in CI against the seeded database, or cut the guides down to far fewer pictures. Which is a decision for the owner. Severity: causes real confusion. How I know: reproduced in the running app for the first five rows; inferred for the rest.

## Closed issues that are not really resolved, or keep coming back

| Issue | Closed as | What the current code shows |
|---|---|---|
| #300 Let a church skip the worker | Docs plus a static notice | The guide still says nothing checks whether the worker runs, lists only four of its seven jobs, and omits the key-copy step (G4) |
| #253 Timezone workarounds; #401 audit test fails part of each day | Fixed for reports | The same UTC-day mistake is back in the key-date and care-post jobs written since (G11) |
| #75 Database backups; #11 backup reminder | Done | Restore fails on survey uploads; the version check cannot work before 1.0 (G2) |
| #284 Route tests fail on a local database | "Local pollution", fixed | A local run by the documented steps still fails 15 tests, now for a missing `APP_BASE_URL` (G9) |
| #380, #321, #198, #82, #77 Docs sweeps; #321, #266, #264, #178 screenshot sweeps | Done each time | Stale again within two days (tables above). Nothing but the link checker guards against drift |
| #378, #277 Versioning | Done | The numbering is sound, but "upgrade" still means "wipe" (G1), and, per the issue's own closing comment (not re-checked in code), the update banner stays silent until a stable 0.1.0 exists, so a beta church is never told to update |
| #13 Error tracking | Not planned | Still true that every background failure in G3, G4 and G14 goes only to a log nobody reads |
| #7, #375, #384 Mobile sweeps | Done | Recurring theme; not re-tested here (usability review) |
| #423 Emails for trip applications and backup reminders | Merged in #488 | Not in the reviewed commit (e713437 is #487); `dev` has moved on |

Checked and found resolved, so not reported: #310, #367, #244, #402.

## Open issues already known and relevant to "ready to invite churches"

- #477 Simple to adopt: first-run setup wizard, complexity review, simpler marketing. Overlaps G4, G8, G9, G12.
- #430 Interested in a hosted version? Repeats the $13 figure (G5); a hosted option would remove G1, G2 and G4 for most churches.
- #420 New branding and marketing (rename is out of scope; the marketing copy overlaps G5).
- #290 Partner self-update link.
- #293 Year-end giving statements and budget-versus-actual (touches G13).
- #295 Missions committee tools.
- #294 Congregation engagement.
- #325 AI scan improvements.
- #273 Trips: no cross-trip identity for a repeat participant.

No open issue covers G1, G2, G3, G6, G7 or G10.

## What I couldn't check, and why

- **Real sends and the worker.** No schedule was fired and `worker.js` was not started (review limits). G3, G4, G10, G11, G12 and G14 rest on reading the code, plus one stubbed function call for G3.
- **How Postmark reports a rejected sender** (per message or as a thrown error). That decides how often G3 bites versus G14b. No credentials.
- **Render itself:** current prices, what a blank prompted variable does, whether "Sync fork" redeploys both services. G5 compares the repo's own statements only.
- **Backup size limits.** The memory concern in G2 is inferred; I did not build a large database.
- **Playwright e2e** was not run (would need a second server and time). CI's own status was not read.
- **Most screenshots.** I compared four closely and the sidebar across them; the rest are listed as inferred.
- **Sign-in and permission code** (`requireAuth.js`, `guestAccess.js`, `users.js`, `careTeams.js`, `passkeys.js`) was only skimmed, since the security review covers it. I read `auth.js` to line 330.
- **USER_GUIDE.md role tables, demo/README.md, WORKFLOW.md, AGENTS.md** were not checked line by line.
- **`maskData.js`, `reporting/masking.js`, `csv.js`, `supportNeeds.js`** were not read in depth.
- **Git history** before 24 November is squashed, so "when did this change" could not be dated for most screenshots.
- `dev` on GitHub is ahead of the reviewed commit (#488 at least).

Scratch databases left on the local Postgres for the lead to reuse or drop: `mpt_general`, `mpt_general_test`, `mpt_general_restore`, `mpt_general_old`, `mpt_general_empty`. Scratch files, logs and captures are in `/tmp/claude-0/-home-user-missions-partner-tracker/f2c4cd1e-b574-5284-a231-a151b8f69f79/scratchpad/general/`.
