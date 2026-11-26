# App review, November 2026: what to do first

**Reviewed:** branch `dev` at `e713437` (0.1.0-beta.3), 2026-11-26. `main` held the same code at that commit, so everything here applies to the live demo's code too. `dev` has since gained PR #488 (trip-application emails and a monthly backup reminder); the lead read its diff afterwards and it changes none of the findings (see "PR #488" near the end).

**The app is not ready to invite more churches, if those churches are the ones this review was asked to judge for: a non-technical volunteer running missions alone.** It is close to ready for a church that has a technical helper on call and accepts that its data may be wiped during the beta. The permission system, the handling of uploads and secrets, and the care features themselves are in good shape; what blocks adoption is everything around them. The three things I would do first:

1. **Make the live demo safe, today.** Anyone using the demo's published admin sign-in can, as far as the code shows, post their own words to your real GroupMe group, send email through your real Postmark sender, spend your Anthropic key, and lock every other visitor out (A1). This is first because it is the only finding that can hurt you or other people right now, and the stop-gap takes minutes: remove the real credentials from the demo's environment.
2. **Stop the app exposing people by default.** A new partner is published to the internet unless the admin unticks a box, a brand-new install can be claimed by any stranger who finds it first, and the settings that protect partners in sensitive places are on a page a default install cannot open (A2, A3, A4). These are small changes, and they are the ones where a church could do real harm to a missionary without knowing it.
3. **Make install, upgrade and backup something a church can trust.** Today the install needs a terminal, the documented one-click setup leaves the background service unable to send, an upgrade silently breaks the site unless the database is wiped, and a backup can fail to restore (A5 to A8). No church has real data yet, so this is the last cheap moment to end the "wipe on upgrade" convention.

After those, the work in issue #477 (a first-run guide and fewer switches) is what turns "safe to try" into "useful in the first ten minutes" (A9).

## The reports

| # | Report | What it answers |
|---|---|---|
| 0 | [Fresh eyes](0-fresh-eyes.md) | How the built app compares with a blank-page sketch of what a church needs |
| 1 | [Complexity](1-complexity.md) | Every switch, settings page, alert, job, email and role, counted from the code, with a recommendation for each |
| 2 | [Security](2-security.md) | Demo findings first, then what affects every install |
| 3 | [Usability and acceptance](3-usability.md) | Walkthroughs as each kind of user, with screenshots, and "would a church say yes?" |
| 4 | [General problems](4-general-problems.md) | Docs against code, stale screenshots, recurring issues, bugs in the risky areas |
| 5 | [A hosted version](5-hosted-version.md) | Feasibility note on two routes to a hosted service |
| - | [Plan](PLAN.md) and [Work queue](WORK-QUEUE.md) | The owner's decisions and the ordered list of fixes |

**Where these live, and why.** The brief asked for `docs/reviews/…`. AGENTS.md says `docs/` is the published marketing site, so the reports are in `reviews/` at the repo root instead, on the branch `review/2026-11-app-review` (not on `dev`, so dev-test is not redeployed by each push). Both were the owner's choices during the review.

**How far to trust each finding.** Every finding in the reports says how it is known: reproduced in a running local copy, read in the code, or inferred. Each report was written by a helper and then checked by the lead reviewer; the "Lead check" box at the top of each report lists exactly which findings were re-checked and which were not. The "Checked" column below repeats that for the ranked items. Nothing was tested against the demo, dev-test or any hosted site, nothing was sent on a real channel, and no schedule was forced.

**Ids.** F = fresh eyes, C = complexity, S = security, U = usability, G = general problems.

---

## A. Fix before inviting more churches

Ranked by how much each one stops a non-technical church from adopting the app and using it safely. Size is small (a day or two), medium (about a week) or large (several weeks).

| # | What | From | Size | Checked by lead |
|---|---|---|---|---|
| A1 | The demo's published sign-in can cause real sends, real spend and a lock-out | S1 to S5 | Small | Absence of any demo check confirmed in code; what is configured on the live demo is unknown |
| A2 | New partners are public by default | S8, F1, C3, U14 | Small | Confirmed in code |
| A3 | A new install can be claimed by a stranger, and its front page is a dead end | S7, U3 | Small | Both reproduced by lead |
| A4 | Protections for partners in sensitive places are hidden, weak by default, and changeable by guests | C4, S9, U4 | Small to medium | C4 confirmed in code; S9 reproduced; S9 and U4 are current design, so these are decisions |
| A5 | Upgrading silently breaks the site, and the only fix wipes the data | G1, U2 | Medium | Not re-run by lead; consistent with RUNBOOK.md |
| A6 | A backup can fail to restore | G2 | Small | Cause confirmed in code |
| A7 | The one-click Render setup leaves the background service unable to send, costs more than stated, and the app cannot tell | S10, G4, G5, U8, C2 | Medium | Confirmed in code and `render.yaml`; not tested on Render |
| A8 | Installing needs a terminal, git and Node | U1 | Medium (or large, if the answer is hosting) | Not re-checked; read from the guides |
| A9 | Nothing useful happens until the admin finds and sets several things | C1, C7, C8, U5, F2 | Large | First admin not on missions team confirmed in code. **Already covered by #477; no new issue proposed** |
| A10 | A sole admin who loses their phone is locked out for good | S11, G8 | Medium | Absence of recovery codes confirmed by search |

Issue text for each follows. A9 is already tracked by #477, so it has notes rather than issue text.

<details>
<summary><strong>A1. Demo: a visitor using the published sign-in can send real messages, spend real money and lock everyone out</strong></summary>

**Title:** Demo: block real sends, AI spend and password changes from the published sign-in

**Body:**

The public demo publishes an admin sign-in. Demo mode only stops *scheduled* sends (`backend/src/utils/demoMode.js` says so in its own comment). Anything a signed-in person triggers by hand runs for real, using the real integration credentials that `backend/scripts/reset-demo-data.js` restores on every reset.

What a visitor can do, from reading the code (not tested against the demo):

- Mark a prayer request or one-time need "urgent" and have their own text posted at once to the real GroupMe group, and to WhatsApp if a number is paired (`sendUrgentDispatch` in `dispatchOrchestrator.js` has no demo check; nor do `groupmeChannel.js` or `whatsappChannel.js`).
- Send email from the real Postmark sender: Add User sends a welcome email to any address, and an urgent request is emailed to every sign-in and confirmed subscriber with the visitor's wording.
- Change the shared admin password, which signs everyone out until the nightly reset (reproduced locally with demo mode on).
- Run the AI scan on any uploaded file with the real Anthropic key (limit: 30 per 15 minutes per address).
- Change the church name and text, upload images that are served publicly, and point links elsewhere, until the next reset.

Stored secrets cannot be read back; that was checked.

**Do now, no code:** remove the real GroupMe, Postmark and Anthropic values from the demo's environment (or revoke those tokens) and run a reset.

**Then, in code:** on a demo deployment, refuse or stub every send that leaves the app (urgent dispatch, chat posts, welcome and other hand-triggered emails, the public subscribe confirmation), refuse the AI scan, refuse password and email changes on the published accounts, and refuse changes to integration settings. Show the visitor what *would* have been sent instead.

**Done when:** a test proves that with `DEMO_RESET_TOKEN` set, none of the above reaches Postmark, GroupMe, WhatsApp or Anthropic, and the published accounts' passwords cannot be changed.

Source: `reviews/2026-11-app-review/2-security.md`, S1 to S6.
</details>

<details>
<summary><strong>A2. New partners are published to the internet by default</strong></summary>

**Title:** New partners should start private, and the form should say plainly what "public" shows

**Body:**

The database default for a partner is private (`isPublic` false, `backend/prisma/schema.prisma:20`). The New Partner form overrides it: it opens with "Show on public site" ticked (`frontend/src/pages/AdminPartnerForm.jsx:32`). The public directory and public map are both on by default. So an admin who clicks Next, Next, Finish has published a family's name, photo and location, and the only explanation on screen is a hover tooltip.

Some partners work where being named publicly is dangerous. This default should fail safe.

**Change:**

- Start the form with "Show on public site" unticked.
- On that step, say in a sentence what ticking it shows to anyone on the internet (name, photo, place on the map, overview), and what "restricted" changes.
- After saving, show whether the partner is public on the partner page where it can't be missed.
- Decision for the owner: should the public directory and map also start switched off on a new install, and be offered in first-run setup instead?

**Done when:** a partner created by accepting every default is not returned by `/api/public/partners`, with a test.

Source: S8, F1, C3, U14.
</details>

<details>
<summary><strong>A3. A new install can be claimed by a stranger, and its front page is a dead end</strong></summary>

**Title:** First-run setup: require a setup code, make it one-time for real, and send an empty install's front page to setup

**Body:**

Three problems on a brand-new install:

1. **Anyone can claim it.** Until the church creates the first admin, `/api/auth/setup` accepts whoever arrives first, and `/api/auth/setup-status` tells any caller the install is unclaimed. The guides don't warn about this.
2. **"Only succeeds once" isn't true.** The route counts users, then creates one, as two separate steps (`backend/src/routes/auth.js`, about lines 114-140). Three sign-ups sent at the same moment to a fresh local database all returned 201 and all three became admins.
3. **The front page doesn't lead anywhere.** On an install with no accounts and no partners, `/` shows "Loading..." for ever (`frontend/src/pages/PublicDirectory.jsx:50` treats "no partners" as "still loading"), has no sign-in link, and does not go to `/setup`.

**Change:**

- Require a one-time setup code only the person deploying can see (for Render, a generated variable in `render.yaml` that the setup page asks for; elsewhere, printed in the server log at first start).
- Make creating the first admin a single step that fails if any account exists.
- When no account exists, send `/` to `/setup`. When there are simply no public partners yet, show an empty state with the church's name and a sign-in link, not "Loading...".

**Done when:** concurrent setup requests create exactly one admin (test); setup without the code is refused; a fresh install's `/` reaches setup.

Source: S7, U3. Both reproduced locally.
</details>

<details>
<summary><strong>A4. Protections for partners in sensitive places are hidden, weak by default, and changeable by guests</strong></summary>

**Title:** Sensitive-location partners: put the safety settings where an admin can find them, and decide the defaults

**Body:**

Three related points. The second and third are how the app is designed today (SPEC.md § 5.2 and § 7), so they are decisions for the owner, not bugs.

1. **The settings are on a page a default install cannot open.** "Allow restricted partner dispatch" and "show initials for restricted partners" live only on Settings → Dispatches (`frontend/src/pages/AdminDispatchSettings.jsx:137-166`). That page is shown only when GroupMe, WhatsApp or Email (Sending) is on (`frontend/src/main.jsx:388-394`). The initials setting also controls the public site.
2. **"Restricted" still publishes initials, the exact country and the region label.** A restricted partner came back from the public API as "E.F.", Indonesia, West Java. For a small team in a small region that can be enough to identify someone. Decision: should the default be no initials and continent-level only, with the church opting in to more?
3. **A care-team guest can change "Show on public site" (and the restricted switch is enabled in the same dialog) with no review.** Their prayer requests are held for approval; this is not. Decision: make visibility and restricted status staff-only, or hold those changes the same way.

**Change:** move the two restricted-partner settings to a page that always exists (About & Branding, or a "Privacy and safety" page), explain each in one plain sentence, and apply whichever defaults the owner chooses for 2 and 3.

**Done when:** the settings are reachable on an install with every messaging feature off, and tests cover the chosen defaults.

Source: C4, S9, U4.
</details>

<details>
<summary><strong>A5. Upgrading silently breaks the site, and the only fix wipes the data</strong></summary>

**Title:** End the "rewrite the one migration" convention before the first church has real data, and refuse to start on a mismatched database

**Body:**

Before 1.0 the project rewrites its single database migration in place for every schema change (SPEC.md § 8.3). An existing database sees that migration as already applied, so `prisma migrate deploy` does nothing and reports success. The new code then runs against old tables.

Reproduced by the review helper: a database built at 0.1.0-beta.1, upgraded with today's `migrate deploy`, reported "No pending migrations"; `/api/health` returned 200; `/api/public/settings` failed on a missing column. Render would mark that deploy live. SPEC § 8.3 says the deploy fails safely; RUNBOOK.md describes the silent version correctly. UPGRADING.md's "easy way" (GitHub's "Sync fork" button) never mentions that the database must be reset, and on Render that button alone triggers the upgrade.

The moment a church has real data, an upgrade either breaks their site or erases their records.

**Change:**

- Decision for the owner: pick the release from which the baseline is frozen. From then on every schema change is a normal migration made with `prisma migrate dev`, so real data upgrades in place. This changes the hard rule in CLAUDE.md and CONTRIBUTING.md about squashing before release.
- At start-up (or in the health check Render uses), compare the database with what the code expects and refuse to go live on a mismatch, so a bad upgrade never replaces a working site.
- Until the freeze, say at the top of README, UPGRADING.md and the marketing page that an install made today will have to be wiped.

**Done when:** an install made at release N upgrades to N+1 with its data intact in a test, and a mismatched database fails the deploy instead of going live.

Source: G1, U2.
</details>

<details>
<summary><strong>A6. A backup can fail to restore</strong></summary>

**Title:** Backup restore fails when a survey photo is waiting for approval; add a round-trip test

**Body:**

`surveyUpload` is in the backup's list of tables (`backend/src/utils/backup.js:94`) but missing from the list of binary fields (`backup.js:148-156`), so its photo bytes are not encoded the way the others are. The review helper reproduced the result: `restore-backup.js` exits with an error on that table, and because a restore is all-or-nothing, nothing is restored. With the one field added in memory, all rows restored.

A church only finds this out on the day it needs the backup.

**Change:** add the field; add a test that fills every table in the backup's model list (including every binary column), backs up, restores into an empty database and compares, so a new table cannot be forgotten again. Also check the version guard: it compares migration names, which never change before 1.0, so it cannot detect a backup from an older schema.

**Done when:** the round-trip test passes and fails if a binary column is left out.

Source: G2. (Making backups automatic, protected and restorable without a command line is B6.)
</details>

<details>
<summary><strong>A7. The one-click Render setup leaves the background service unable to send, costs more than stated, and the app cannot tell</strong></summary>

**Title:** Render Blueprint: fix the worker's secrets, document the worker and its cost, and show in the app whether it is running

**Body:**

Everything scheduled (email digests, chat posts, key-date and trip reminders, scheduled reports, the audit clean-up, the WhatsApp connection) runs in a separate worker service. Four problems:

1. **Wrong session secret.** `render.yaml:125-126` gives the worker its own generated `SESSION_SECRET`, and the comment above says the worker never signs anything. It does: the worker runs the email schedule (`backend/src/worker.js:42`), which signs unsubscribe and confirm links with that secret (`backend/src/utils/emailDispatchShell.js:73-98`). The website checks them with a different secret, so every unsubscribe link in a scheduled email is rejected. Not tested on Render.
2. **Hand-copied encryption key.** The worker's `FIELD_ENCRYPTION_KEY` must be copied by hand from the web service (`render.yaml:127-140`). ADMIN_GUIDE.md's walkthrough says keys are automatic and to leave the prompts blank. A worker without the right key starts anyway and cannot read the email or GroupMe credentials.
3. **The cost is understated.** README, ADMIN_GUIDE.md, `docs/index.html` and issue #430 say about $13 a month. `render.yaml` creates a third paid service and its own comment says about $7 more.
4. **The app cannot tell whether the worker is running.** There is no heartbeat anywhere in the code or schema. If the worker is missing, misconfigured or asleep, nothing is sent and nothing says so.

**Change:**

- Make the worker use the web service's `SESSION_SECRET` and `FIELD_ENCRYPTION_KEY` without a manual step (Render can share values between services through an environment group or `fromService`), and correct the comment.
- Have the worker record "last seen" every minute, and show a plain warning to admins when it is stale: "Scheduled emails and reminders are not running."
- State the real monthly cost and what the worker is for, in every place the $13 figure appears.

**Done when:** a Blueprint deploy made by following the guide exactly sends a digest whose unsubscribe link works, with no hand-copied values; stopping the worker produces the warning.

Source: S10, G4, G5, U8, C2.
</details>

<details>
<summary><strong>A8. Installing needs a terminal, git and Node</strong></summary>

**Title:** Install without a terminal, and state the real requirements

**Body:**

ADMIN_GUIDE.md says "You don't need to know how to code, run a database, or use a command-line tool beyond the one short command below". That command is `npm run name-instance -- your-church-name oregon`, which needs git, Node.js and npm on a computer, then (in README only) `git commit` and `git push`. The Admin Guide leaves the commit and push out, so someone following it exactly deploys a file that was never renamed. The region chosen in that step can never be changed. The marketing page says only "a GitHub account and about an hour".

For the person this app is meant for, the install ends here.

**Change (decision for the owner between these):**

- **Smallest:** let the Blueprint deploy with its default names, so there is no command to run. The church's name already lives in Church Settings, not in the service name. Offer a "Deploy to Render" button from the marketing page and README.
- **Or:** tell people to edit the two lines of `render.yaml` in GitHub's web editor, with screenshots.
- **Or:** decide that non-technical churches are served by a hosted version and say so plainly (see report 5 and issue #430).

Whichever is chosen, list the true requirements where people first read about the app: a GitHub account, a Render account with a payment card, a phone for two-factor sign-in, and the real monthly cost (see A7).

**Done when:** a person can go from the marketing page to their own `/setup` screen using only a web browser, following the guide word for word.

Source: U1.
</details>

<details>
<summary><strong>A9. Nothing useful happens until the admin finds and sets several things (covered by #477)</strong></summary>

**No new issue proposed: #477 already tracks the first-run guide and the complexity review.** These are the specifics this review adds, for whoever picks #477 up:

- First-run setup asks only for an email and password. It never asks the church's name, time zone, or whether partners should be public (C8). The first admin has no name, so entries read "by Someone" (U15).
- Contact log, key-date reminders and care teams are all off on a new install (U5). The first thing a new admin sees is a banner about "your Postgres provider" and an empty dashboard (C11, U7).
- Turning key-date reminders or the contact log on does nothing until someone is on the missions team, and nobody is, including the first admin (`backend/src/routes/auth.js:132-140`). The bell says "Nothing waiting." with a birthday four days away (C7, U5).
- Counted from an empty install: 17 clicks and 3 unprompted guesses to get one birthday reminder on the bell; getting it by email cannot be finished in the browser at all (report 3). About 15 touches across 7 Settings pages and 2 outside systems for one reminder email (C1).
- The complexity report proposes a target of 3 touches, none of them in Settings, before the app is useful.
- Home shows counts, not names ("5 items"), and there is no "this week" list (F2, U13).

One piece is small enough to do ahead of the wizard: put the first admin on the missions team at setup, and turn the contact log and key-date reminders on by default.
</details>

<details>
<summary><strong>A10. A sole admin who loses their phone is locked out for good</strong></summary>

**Title:** Two-factor sign-in: recovery codes, a documented way back in, and no lock-out when the encryption key is missing

**Body:**

A new install requires two-factor sign-in from the first sign-in. That is a good default, but for a church with one admin it has no way back:

- There are no recovery codes anywhere in the app (searched backend and frontend).
- Another admin can reset someone's two-factor, but a sole admin has no other admin.
- `createAdmin.js` does not clear two-factor, and the guides say nothing about recovery.
- Off Render, `FIELD_ENCRYPTION_KEY` is documented as "Recommended" (`ADMIN_GUIDE.md:180`). Without it, two-factor enrolment fails with "Server error", and because enrolment is required, the first admin cannot get in at all (reproduced by the review helper).
- Losing or changing that key later locks out everyone who uses an authenticator app.

**Change:**

- Give recovery codes at enrolment and make the person confirm they saved them.
- Provide and document a command the person who runs the server can use to clear two-factor for an account.
- Treat a missing or invalid `FIELD_ENCRYPTION_KEY` as a start-up failure (like `SESSION_SECRET` already is), and document it as required.
- In first-run setup, encourage adding a second admin.

**Done when:** a sole admin can get back in with a recovery code, and the app refuses to start without a usable encryption key.

Source: S11, G8.
</details>

---

## B. Fix soon

Draft issue text only; not for filing yet.

| # | What | From | Size |
|---|---|---|---|
| B1 | The email digest marks updates as sent when the send failed | G3 | Small |
| B2 | Email "on but not set up" fails silently, and setting email up needs a specialist | U6, C1, C6 | Medium |
| B3 | Home should be a "this week" list that names people, and the coordinator should get it by email | F2, F3, U13 | Medium |
| B4 | Fewer switches: merge, default and hide per the complexity inventory | C9, C13, C14, F8, F12 (part of #477) | Large |
| B5 | Plain words in place of the app's own vocabulary | C10, U14, U16 | Medium |
| B6 | Backups: automatic, protected, restorable without a command line | U7, S14 | Medium |
| B7 | Scheduled jobs use the wrong day east of about UTC+5, and a time zone change needs a restart | G11, G12 | Small |
| B8 | Updates queue for ever while no channel is on, then all post at once | G10 | Small |
| B9 | Sign-in throttling depends on exactly one proxy in front of the app | S12 | Small |
| B10 | Email receiving trusts a weak sender check and has no storage cap | S13 | Small to medium |
| B11 | A guest is not told what they are, what is hidden, or that their entries wait for approval | U11, C12 | Small |
| B12 | The seed creates working sign-ins with a password that is in the repo, and fails on an empty database | G6, G7 | Small |
| B13 | A Bible passage in one translation is written into the public subscribe page | U9 | Small |
| B14 | Docs and screenshots are out of date again; `APP_BASE_URL` is documented as optional but much depends on it | G9, plus the tables in report 4 | Medium |
| B15 | Bell items and links that lead to a switched-off or hidden page | C5, U13 | Small |

<details>
<summary>Draft issue text for B1 to B15</summary>

**B1. Digest marks failed sends as sent.** `sendToRecipients` adds every eligible row to the "considered" set before sending (`backend/src/utils/emailDispatchDelivery.js:141`); a failed message only writes an error note (`:176`); `runEmailDispatchTier` then stamps every considered row as sent and clears the error (`backend/src/utils/emailDispatchScheduler.js:85-89`). A church whose email is misconfigured loses those updates silently. Stamp only rows that reached at least one recipient, keep the error visible to admins, and retry next tick. Read in the code; no real send was run.

**B2. Email half-set-up states.** With Email (Sending) switched on but no mail account entered: Add User dead-ends with no copy-link fallback; the public Subscribe page tells visitors "Check your email to confirm" while the server logs a failure; no page warns that nothing can be sent. Treat "on but not ready" as off everywhere (use the existing copy-link fallbacks), and show one clear "Email isn't finished setting up" notice. Separately, setting up email needs a Postmark account and DNS records; decide whether a simpler provider path or a hosted sending domain is worth offering (see report 5).

**B3. A "this week" home.** Replace the count cards with a short list that names people: who is due for contact, whose birthday is coming, what arrived, which needs are open. Make "My partners" reachable from the menu. Offer the same list as one weekly email to each person. Relates to #295 and #477.

**B4. Fewer switches.** Use the tables in report 1: every one of the 23 registry switches and 22 others has a recommendation (default on, default off, merge, hide until needed, or remove). Headline moves: contact log and key-date reminders on by default; care switches merged into one "Partner care" choice; integrations and sign-in options moved to an Advanced area; one style of switch. Removals proposed, each a decision for the owner: WhatsApp, the Viewer role, the "Trips departing soon" alert.

**B5. Plain words.** Report 1's jargon list gives the exact string, its file and a replacement for each: "dispatch", "Pending Dispatches", "cadence", "tier", "Unmatched Email", "FIPS", "Strategic/Situational", "Postgres provider", and a ticket number ("#209") printed in help text at `AdminDispatchSettings.jsx:313`.

**B6. Backups.** Today a backup is a manual download of an unprotected file containing everything, including password hashes; restoring needs a command line; and the restore guide suggests staging the file on "a temporary, unlisted file host". Offer a scheduled backup, ask for the password again before download, document safe handling, and provide a restore that does not need a terminal. PR #488 adds a monthly reminder email, which helps but is not a backup.

**B7. Time zones in scheduled jobs.** Key-date and care-post jobs compute "today" from the UTC day, so east of about UTC+5 they run a day late (the same class of bug as closed issues #253 and #401). A time zone change in settings takes effect only after both services restart. Use the church's local date everywhere a job asks "what day is it", and re-read the time zone without a restart.

**B8. Queued updates.** With no channel on, recorded updates never expire; the day GroupMe or WhatsApp is first switched on, the whole backlog posts at once. Expire or cap the backlog, and ask before sending anything older than a few days.

**B9. Sign-in throttling.** `trust proxy` is fixed at 1 (`backend/src/server.js:77`). With no proxy in front, a caller can set their own address header and avoid the limit (30 of 30 attempts went through in the helper's test); with two proxies, all visitors share one counter. Make the hop count a setting with a start-up warning, and add a per-account limit that does not depend on the address.

**B10. Email receiving.** A message is filed and announced as a partner's newsletter when the sender check passes and the From address matches, which can be forged. Unmatched mail (up to 15 MB each) is stored with no cap. Hold auto-filed mail for a quick review by default, and cap and expire the unmatched queue.

**B11. Guests.** A care-team guest sees no explanation of their role, of what is hidden from them, or that their prayer requests and uploads wait for staff approval. Add one line at each of those points. The Add User form offers Guest even when it cannot be used, and describes it as trips-only.

**B12. Seed.** `npm run seed` creates editor and viewer sign-ins with a fixed password that is in the repo (`backend/prisma/seed.js:2431`); the docs call the seed "optional fake partners". It also stops at `seed.js:2350` on a freshly created empty database, which is the documented quick start. Create seeded people as inactive (or with random passwords printed once), and make the seed create the settings row it needs.

**B13. Hardcoded passage.** `frontend/src/pages/PublicSubscribe.jsx` (about lines 30-43) prints Ephesians 6 with an "(ESV)" credit. A church that uses another translation, or none on that page, has to change application code, which is what the fork rule in CLAUDE.md forbids. Move it to a church setting, empty by default.

**B14. Docs.** SPEC.md § 4 lists 17 features against 23 in the registry, and § 5 is numbered 5.7, 5.9, 5.10, 5.8. ADMIN_GUIDE.md still says four features need Care teams. `APP_BASE_URL` is documented as optional although setup emails, sign-in links, passkeys, surveys and unsubscribe links depend on it, and the documented local test steps omit it (15 route tests fail without it). Report 4 lists the stale screenshots.

**B15. Dead ends.** Enabled Features says updates "wait on Pending Dispatches", a page that is blocked on a default install; one bell item leads to "This feature is turned off"; the Monthly Support page has no link in the menu.

</details>

---

## C. Later

Draft notes only. Several are decisions for the owner rather than work.

| # | What | From | Size |
|---|---|---|---|
| C1 | **Decision:** trips are about a quarter of the product and the blank-page sketch left them out. Keep as is, move to an advanced area, or split off | F4 | Large |
| C2 | **Decision:** remove WhatsApp. It depends on an unofficial client pinned to a pre-release, and it is the one always-open connection in the worker | F12, S18, report 1 | Medium |
| C3 | **Decision:** remove the Viewer role; merge care-team Lead and Member | C12, report 1 | Small |
| C4 | A hosted version | Report 5, #430 | Large |
| C5 | Give partners a voice: a self-update link, and survey answers that can become prayer requests | U10 (covered by #290) | Medium |
| C6 | Give church members something to do: prayer requests and a giving link on the public page, the church's name on the site | U9, F5 (covered by #294) | Medium |
| C7 | Import from a spreadsheet; paste a list of names to start | F7, F9 | Medium |
| C8 | A per-partner contact rhythm and a "not this season" snooze, so a new install is not instantly all overdue | F10 | Medium |
| C9 | One-time needs without a required dollar amount; "someone's on it / met"; a decline option on Record Decision | F11, U14 | Small |
| C10 | Something ready for Sunday: a one-page prayer sheet or slide, not only the full booklet | F6 | Medium |
| C11 | Money is whole US dollars with the currency fixed in code | G13 | Medium |
| C12 | AI scan: no extra warning before a restricted partner's letter is sent to an outside service; guests can trigger it | S16 (near #325) | Small |
| C13 | Partner photos stay reachable by web address whatever the partner's settings | S15 | Small |
| C14 | Link fields accept any text; only the content policy stops a script link | S17 | Small |
| C15 | Smaller scheduling bugs and the hardening table | G14, report 2's table | Small |

---

## What this review could not check, and why

- **The live demo, dev-test and any hosted site.** Off limits by the brief. Every demo finding is inferred from the code and from `demo/README.md`. Whether the demo really holds live GroupMe, Postmark and Anthropic credentials, and whether a WhatsApp number is paired, is unknown.
- **Real sends.** No email, GroupMe or WhatsApp message was sent, the worker was never started, and no schedule was forced. Findings about sending (A7, B1, B7, B8) come from reading the code.
- **A real Render install or upgrade.** The install review followed the guides and `render.yaml` on paper and ran the app locally. A7 and A8 are not tested on Render.
- **The AI scan at runtime.** No API key was available, so prompt injection from a hostile document was not tried.
- **Everything the lead did not re-check.** Each report's "Lead check" box says which findings were re-checked. The rest rest on one helper's work.
- **The fresh-eyes sketch.** The first sketch was written by a helper that had not opened the repo but had the project's CLAUDE.md summary in its context. It was redone in a separate session with no repository attached; that one is Appendix A of report 0 and the first is Appendix B.
- **Not looked at:** passkeys with a real device, the trip admin pages in depth, screen-reader and keyboard-only use, most of the 99 documentation screenshots.

## PR #488, read after the review

PR #488 merged to `dev` while the review was running. The lead read its backend diff (not run). It adds two emails: one to every admin when someone applies for a trip, and one to each admin about once a month saying backups need checking.

- **It does not close or change any finding.** The reminder tells an admin to check backups; it does not make one, so A6 and B6 stand.
- **It does not make the demo finding (A1) worse.** Both new emails check for a demo and send nothing there.
- **It depends on the same weak points.** The backup reminder runs in the worker and needs email set up, so on an install hit by A7 it never arrives, and the church that most needs the reminder is the one least likely to get it. Its link needs `APP_BASE_URL` (B14).
- **It moves two counts in report 1:** scheduled timers go from 8 to 9, and kinds of email from 19 to 21.
- **Two small wording points:** the reminder email still says "your Postgres provider" (B5), and the trip email tells every admin "You get this because you help run trips".
- **Checked and fine:** the public application form already has its own rate limit and a honeypot, the applicant's name is escaped in the email, and the email leaves out their contact details.

## Issues filed

Filed 2026-11-26 after the owner's approval, with the owner's decisions folded in (see PLAN.md):

| Item | Issue |
|---|---|
| A1 | neckermann/missions-partner-tracker#489 |
| A2 | neckermann/missions-partner-tracker#490 |
| A3 | neckermann/missions-partner-tracker#497 (setup code dropped by the owner; atomic creation and front-page fix only) |
| A4 | neckermann/missions-partner-tracker#491 |
| A5 | neckermann/missions-partner-tracker#492 |
| A6 | neckermann/missions-partner-tracker#493 |
| A7 | neckermann/missions-partner-tracker#494 (reworked: remove the worker) |
| A8 | neckermann/missions-partner-tracker#495 |
| A9 | Notes added as a comment on neckermann/missions-partner-tracker#477 |
| A10 | neckermann/missions-partner-tracker#496 |
