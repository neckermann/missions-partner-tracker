# 3. Usability and acceptance
**Status: Draft, not yet verified by the lead reviewer.**
**Reviewed:** branch `dev` at e713437 (0.1.0-beta.3), 2026-11-26.

## Summary

Once it is running and somebody has switched the right things on, the day-to-day app is good: the "My partners" view answers "who do I need to be in touch with this week?", logging a contact takes five taps, the reports are named as plain questions, a partner's survey works well on a phone, and no screen I visited overflowed sideways at phone width. The problem is everything before and around that. A non-technical volunteer cannot install it (the first documented step is a terminal command that needs Node and git), cannot safely upgrade it (pre-1.0 releases require erasing the database), and on first sign-in lands on a page with a backup warning about "your Postgres provider" and no guidance, with every care feature the marketing leads with switched off. Getting one birthday reminder onto the bell took 17 clicks and three things nobody tells you; getting it by email cannot be done in the browser at all. Two things are unsafe rather than awkward: a brand-new site's front page says "Loading..." for ever with no way to sign in, and a church member given a "limited" Guest login can take a partner off (or put one on) the public site. **It is not ready to invite non-technical churches.** It is ready for a church that has a technical volunteer who will stay involved.

Method: an empty install (port 4130) and a seeded install (port 4131) were driven with Playwright at 1280x900 and at 390x844. Install, hosting and upgrading were judged by reading the documents as the volunteer would. Nothing was deployed, no email or chat channel was configured, and the worker was never started.

---

## Walkthrough A: the admin setting it up

### A1. Discovery and install (read, not done)

| Step | What the documents ask | Stall? |
|---|---|---|
| 1 | Marketing page (`docs/index.html`): "You will need a GitHub account and about an hour" | N (but untrue, see U1) |
| 2 | Create a GitHub account, press **Fork** | N |
| 3 | "Make your own copy of this repo, then name it": `npm run name-instance -- your-church-name oregon` | **Y**. Needs the copy on your computer (git), Node.js, and a terminal. None of these is mentioned as a requirement. |
| 4 | Choose a region: "it cannot be changed afterwards ... destroying and recreating both the service and the database" | **Y**. A one-way decision with no advice on which to pick. |
| 5 | `git commit -am "..."` and `git push` (in README only; missing from the Admin Guide walkthrough) | **Y** |
| 6 | Create a Render account, add a payment card, **New → Blueprint**, pick your fork, authorise Render's "GitHub App" | Y (new vocabulary: Blueprint, GitHub App) |
| 7 | Render asks for `MFA_ISSUER`, `NOMINATIM_CONTACT` and, for the worker, `FIELD_ENCRYPTION_KEY`. Guide: "leave them blank" | **Y** (see U8) |
| 8 | Apply; wait for the build | N |
| 9 | Visit the site, go to `/setup` | **Y** (the site root gives no hint, see U3) |

Count: 3 accounts (GitHub, Render with a card, an authenticator app on a phone) plus a fourth (Postmark, and access to the church's domain DNS) for any email. 3 tools on a computer (git, Node.js, a terminal). Roughly 9 steps before the first screen of the app. Advertised cost "$13 a month"; what the Blueprint actually creates costs about $20 (U8).

Upgrading later: "Sync fork" on GitHub is one click, but the instructions then say to "pull that update down ... reinstall dependencies, apply migrations, redeploy", and the changelog carries five separate "must be reset" notices for recent releases (U2). Backups: manual download only; restoring needs a command line (U7).

### A2. First run in the browser (empty install)

| Step | What I did | What happened | Stall? |
|---|---|---|---|
| 1 | Opened `/` | "Our Missionaries" and "Loading..." for ever. No sign-in link. ([screenshot](screenshots/u-empty-install-root-loading-forever.png)) | **Y** |
| 2 | Typed `/setup` by hand | "Welcome. This is a fresh instance with no admin account yet..." Asks for email and password only. ([screenshot](screenshots/u-setup-welcome.png)) | N |
| 3 | Tried the password "church" | Nothing visible happened; no rule is shown on the page | Y (minor) |
| 4 | Created the account | Sent to "Team Login" and asked to type the same email and password again | N |
| 5 | Signed in | "Two-Factor Setup Required. An administrator requires two-factor authentication on this account." Offers a passkey, or an authenticator app with good step-by-step help. "Don't have your phone handy? Ask your administrator for help." ([screenshot](screenshots/u-forced-two-factor-enrolment.png)) | Y: I *am* the administrator, and the only one |
| 6 | Entered the code | Landed on "Welcome". Top of page: "This app doesn't manage database backups itself — confirm your Postgres provider's backup/retention settings." One card: "SYSTEM · Time to check your backups". Then seven "Browse" tiles. ([screenshot](screenshots/u-first-landing-empty-home.png)) | **Y**: nothing says what to do first |

**Path 1: a partner whose birthday reminder reaches a person.**

| # | Click / action | What the screen said | Had to guess? |
|---|---|---|---|
| 1-5 | Partners → + Add Missionary → name, country → Next → Next → Finish | Three-step wizard. Step 3 has "Show on public site" already ticked. | Decision: public or not |
| 6-7 | On the partner page, Adults → + Add → name and birthday → Save | Birthday saved. Nothing mentions reminders. | |
| 8-12 | Settings → Enabled Features → click the "Admin Features" card → switch on "Key-date reminders" → scroll → Save | The page shows only On/Off labels; the switches appear after clicking the card. | **Guess 1:** that reminders are a feature that is off. **Guess 2:** that the card is clickable. |
| | Checked the bell and Home | "Nothing waiting." The birthday is 4 days away. | |
| 13-16 | Settings → Partner Care (a new menu item that appeared without notice) → click the "Missions team" card → tick myself → Save | "Nobody is on the Missions team, so partners without a care team have no one looking after them: no reminders, and nothing on My partners. Pick at least one person." | **Guess 3:** that this page exists and matters |
| 17 | Opened the bell | "🎂 Key dates coming up 1" ([screenshot](screenshots/u-path1-birthday-on-bell.png)) | |

- **By bell: completable in the browser.** 17 clicks, about 10 screens and dialogs, 6 decisions, 3 things I had to work out with no prompt. No worker or email needed. Elapsed time is not meaningful for a script; for a person who already knows the route, about 10 minutes; for one who does not, there is no upper bound, because after step 12 the app looks finished and simply stays silent. The bell item does not say who or when; clicking it opens the top of the partner's page.
- The bell only reaches someone who signs in. A birthday more than 7 days away shows nothing at all, so a volunteer testing with a real date sees no proof it will work.
- **By email: not completable in the browser.** After switching on "Email (Sending)", Settings → Email says "Sends and receives email through Postmark, a dedicated email service ... Enabled · Not configured" and the form asks for a "Server API Token" after you "verify a sending domain (adds SPF/DKIM records to your domain's DNS)". It also needs the separate worker service running with a key copied into it by hand (U8). That is where it stops. ([screenshot](screenshots/u-email-settings-postmark-jargon.png))

**Path 2: a logged contact with a "follow up by" date that shows as due.**

| # | Click / action | Result |
|---|---|---|
| 1-5 | Add the partner (as above) | |
| 6-10 | Settings → Enabled Features → Admin Features card → "Contact log" → Save | Home immediately shows "Partners to reach out to · 1 item" (never contacted) |
| 11-14 | Settings → Partner Care → Missions team → tick myself → Save | Needed, or "My partners" is empty (screen text quoted above). Already done in my run. |
| 15-16 | Partners → the partner | A contact card and a "Contact Log" section have appeared |
| 17-19 | + Log contact → "Phone call" → follow-up date, note → Save | Simple, clear form. Entry reads "by Someone" (U15). |
| 20-21 | Partners → "My partners" tab | Row shows "Follow up: November 26, 2026 **Due**" and "Next key date: Birthday (Daniel) · November 30, 2026 **Soon** · Send greeting" |

- **Completable in the browser.** 21 clicks from first landing (17 if the Missions team is already set), about 9 screens and dialogs, 5 decisions, the same two guesses (find the feature; click the card).
- The due follow-up has no signal of its own: Home said "Partners to reach out to · 1 item" before I logged anything and still said "1 item" after. Only the "My partners" table shows "Due", and that table is not in the menu (it is a tab inside Partners).

### A3. Making it theirs

| Step | What happened | Stall? |
|---|---|---|
| Church name | Settings → About & Branding → click "Church Info" card. Saved. Admin sidebar now says the church name; **the public site still says only "Our Missionaries"** (U9). | Y |
| Timezone | A list of several hundred raw names ("America/Indiana/Tell_City"), default America/Chicago. "Changing this takes effect the next time the app restarts, not instantly." | Y: how does a volunteer restart it? |
| Colors, font, logo | Three colour pickers with clear descriptions, six fonts, Reset to Default. Fine. | N |
| What they call a partner | Singular/plural boxes, plus a separate tick "Also use this term in the admin interface". Fine. | N |
| Second user | Add User wizard, role list "Admin / Editor / Viewer / Guest (only the trips you choose)" with no description of the first three. With email off: a setup link to copy, which works well. With email on but not set up: dead end (U6). | Y |
| Public directory on/off | Enabled Features → "Public Site" card. Wording: "The public list/search view at the site's root ("/")." | Y (minor) |
| "What is public right now?" | No single place answers this. Every new partner is public by default (U14). The "View Public Site" menu link is the only check. | Y |

---

## Walkthrough B: a missions team member, week to week (seeded install)

I created an editor ("Sam", on the Missions team) and a care-team guest ("Grace", one partner). The seed already had the care features on; on a real install an admin must first switch on Contact log, Key-date reminders, Care teams, Support preferences and Partner surveys (all off by default).

| Step | What I did | What happened | Stall? |
|---|---|---|---|
| Sign in | Setup link → choose password → sign in | "Welcome, Sam. Choose a password ... a few random words makes a strong, easy-to-remember password." Clear. | N |
| Home | Looked for "who do I contact this week?" | Eleven cards under "Needs attention", each a title and "N items". First is "Dispatches needing approval". "Partners to reach out to" is fifth. No names anywhere. ([desktop](screenshots/u-editor-home-eleven-count-cards.png), [phone](screenshots/u-phone-editor-home-count-cards.png)) | **Y** |
| Who to contact | Clicked "Partners to reach out to" | "My partners" table: last contact, "Quiet" badges, follow-up, next key date with "Send greeting". This is the best screen in the app. | N |
| Log a contact | Partner page → + Log contact | Five taps. Good. No shortcut from the My partners row. | N |
| Add a prayer request | Partner page → Prayer Requests → + Add | "Category: Strategic (ministry vision/calling — can be shared publicly) / Situational (... admin-only)", "Show on public profile", "Not tracking this one for a specific answer", "Mark as urgent -- send right away" with a 50-word caveat. ([screenshot](screenshots/u-add-prayer-request-jargon.png)) | **Y** |
| Mark one answered | Clicked a request → Mark Answered → Save | Saved. The partner page list looks exactly the same afterwards (no "Answered" mark). | Y |
| One-time need and decision | + Add, then click it → Record Decision | "Approved Amount ($) / Approved Date / Decision Note". No approve/decline choice. Typing 500 against 900 produced "Partially Funded". ([screenshot](screenshots/u-record-decision-no-decline-option.png)) | **Y** |
| Upload a newsletter | + Upload → file, Kind, Save | Clear. | N |
| When did we last hear? | Top of partner page: "Last contact: 10 days ago". Reports → "Last heard from: Which partners have gone quiet?" | Clear. | N |
| Something for Sunday | Print Booklet | Live preview, sensible options. Prints adults' phone numbers and emails by default, including for a partner marked "Use caution ... never text or call". | Y (minor) |
| Bell | Opened it | Eight lines of category + number. ([screenshot](screenshots/u-editor-bell-open.png)) "Unmatched emails 3" leads to "This feature is turned off". ([screenshot](screenshots/u-bell-item-leads-to-feature-turned-off.png)) | Y |

**Care-team guest (phone width):**

| Step | What happened | Stall? |
|---|---|---|
| Sign in | Lands on a Partners list of one. Header says "Missions Team Admin". Nothing says "you are a guest; you can see only this partner". | Y |
| Partner page | Sees almost everything staff see except monthly support: both adults' phones and emails, mailing address, GPS coordinates, emergency contact, sending organisation's contact. | - |
| Add a prayer request | Same form as staff, minus "urgent", still with "Show on public profile" and "Admin Notes". ([screenshot](screenshots/u-phone-guest-add-prayer-request.png)) Saved. **No message that it is held for approval.** ([screenshot](screenshots/u-phone-guest-after-saving-prayer-no-held-notice.png)) | **Y** |
| What is missing and why | Monthly Support section and Pending Dispatches are simply absent; no explanation. Menu shows "Trips 1" and the bell shows "Trip applications pending review 1". | Y |
| Status & Visibility | Opens with working switches for "Show on public site" and "Restricted-access location" (U4). | **Unsafe** |

---

## Walkthrough C: an ordinary church member (no account)

| Step | What happened | Stall? |
|---|---|---|
| Directory `/` | Cards with name, region and one line. Title "Our Missionaries". No church name, no "about", no contact, no footer. | Y |
| Partner page | Bio, focus, languages, a "Website" button, sending church and organisation, and an email sign-up. No prayer requests, no way to send a note, no address for a card. ([screenshot](screenshots/u-phone-public-partner-page-nothing-to-do.png)) | **Y** |
| Map | Pins and a list. Background map tiles did not load in my sandbox ("The background map isn't loading right now. Locations below are still accurate.") so I could not judge it. | not checked |
| Subscribe to prayer digest | Entered an address, pressed Subscribe: "Check your email to confirm your subscription." Email was switched on but not set up, so nothing was sent; the server log shows "Confirm email failed". ([screenshot](screenshots/u-phone-subscribe-says-check-email-but-email-not-configured.png)) Choices are Monthly or Quarterly only. | **Y** |
| Find a trip and apply | "Trip Opportunities" lists open trips with "Apply now" and "Donate". Three-step form (your info; address and emergency contact; trip questions). Clear on a phone. I did not submit. | N |
| Group chat | From `dispatchBlurbs.js`: "🙏 New prayer request from Jeff Jorgensen:" + the text; "🎁 New one-time need from ...: Be praying about this opportunity — we'll talk about it more at our next meeting. ... Requested: $900". A restricted partner becomes "J.J." with "Specific details are withheld for security". Readable. No link or action. | N |

Is there anything for a member to **do** to care for a partner? Read a bio, follow a website link, ask for a monthly or quarterly email, apply for a trip. Nothing else.

---

## Walkthrough D: a partner (missionary)

| Step | What happened | Stall? |
|---|---|---|
| Admin builds a survey | Settings → Surveys → + New survey → title, intro → + Add question (types: Free text, Yes/No, Pick one, Pick any, Photo, Mailing address, Support preferences) → Save questions → Open survey. Easy. | N |
| Admin gets the link | "Get link" per partner: "Nothing was emailed. Send each partner their personal link yourself. Copy this link below and send it yourself -- a personal email, a text, or in person all work." Good. | N |
| Partner opens it (phone) | Title, intro, questions, "Submit" and "Save and finish later". No church name, no greeting by name, and the church's public menu (Directory, Map, Trip Opportunities) across the top. ([screenshot](screenshots/u-phone-partner-survey.png)) | Y (minor) |
| Partner submits | "Thank you, your answers are in. You can change them below until the survey closes." Good. | N |
| Admin sees it | On the partner's page under Surveys: "Christmas check-in · answered 11/26/2026"; click to read. The answer "Please pray for ..." stays a survey answer; there is no way to turn it into a prayer request except retyping it. | **Y** |
| Email a newsletter in | Not configurable by a volunteer: needs Postmark, an MX record on a dedicated subdomain, "Include raw email content in JSON payload", and a webhook URL containing a username and password (`https://<username>:<password>@.../api/inbound-email/postmark`). From the code: a matching sender is filed silently as a Newsletter (`.eml` file); anything else waits in "Unmatched Emails". The partner never gets a reply either way. | **Y** |

What a partner **cannot** do: send a prayer request directly; update their own details except when the church happens to send a survey that asks; see what the church holds about them; see who is on their care team; know whether an emailed newsletter arrived.

---

## Walkthrough E: a stranger landing on the site root

| What they see | Concern? |
|---|---|
| "Our Missionaries", a grid of names, regions and one-line descriptions. No church name, logo (unless uploaded), address or contact. ([screenshot](screenshots/u-public-root-no-church-name-or-sign-in.png)) | They cannot tell whose site it is. |
| Partner page: full names, region, city in the bio, sending church. The public data includes map coordinates at city level. No children's names, no contact details, no adults' individual details. | Reasonable. Restricted partners are masked. |
| Every new partner is public the moment it is saved. | A church entering data for the first time is publishing as it types (U14). |
| No sign-in link. | Staff must know to type `/login`. |

---

## Findings

### U1. A non-technical person cannot install this; "you don't need to know how to code" is not true
- **What is wrong:** The first step of the recommended install is a terminal command that needs git, Node.js and npm on a computer, followed (in README only) by `git commit` and `git push`. The Admin Guide walkthrough leaves the commit and push out altogether, so someone following it exactly deploys a file that was never renamed. The marketing page says only "You will need a GitHub account and about an hour".
- **Where:** `ADMIN_GUIDE.md` lines 44-103; `README.md` lines 54-80; `docs/index.html` ("Free, open source, and yours to run"); `scripts/name-instance.js`.
- **Who it affects:** Every church without a developer.
- **Evidence:** "You don't need to know how to code, run a database, or use a command-line tool beyond the one short command below". That "one short command" is `npm run name-instance -- your-church-name oregon`. Jargon met before the app is reached: fork, repo, Blueprint, region, GitHub App, `sync: false`, environment variables, `MFA_ISSUER`, `FIELD_ENCRYPTION_KEY`, migrate.
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Remove the terminal from the install. Either let the Blueprint deploy with default names and let the church name live only in Church Settings (it already does), or tell people to edit two lines of `render.yaml` in GitHub's web editor. State the true requirements on the marketing page: a GitHub account, a Render account with a payment card, a phone for two-factor, and about $20 a month. Longer term the honest answer for non-technical churches is a hosted version (a decision for the owner; the marketing page already asks who would want one).
- **How I know:** read in the code

### U2. Upgrading currently means erasing the church's data, and the one-click upgrade would not say so
- **What is wrong:** Recent releases have repeatedly changed the database in a way that the normal upgrade step does not apply (five separate notices in the changelog, the latest for beta.2 to beta.3). The changelog instruction is to reset the database, which "erases all data". A church on Render that presses GitHub's "Sync fork" gets the new code deployed automatically; the automatic database step would report success and change nothing, leaving new code running on an old database.
- **Where:** `CHANGELOG.md` lines 101, 115, 157, 190, 216; `UPGRADING.md` "Pre-1.0 exception"; `render.yaml` `preDeployCommand`; the in-app "Update available" banner (Settings → About App).
- **Who it affects:** Any church that adopts before 1.0 and then upgrades.
- **Evidence:** "A database that ran 0.1.0-beta.2 must be reset again (pre-1.0) ... `npx prisma migrate deploy` against a database that already ran the baseline will not apply it. Reset the database (`npx prisma migrate reset`)". The easy path in `UPGRADING.md` also tells a Render user to "pull that update down ... reinstall dependencies, apply migrations, redeploy" on "whatever machine you deploy from", which does not match how Render works.
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Stop squashing the baseline before inviting any church, and say so (this is the pre-1.0 convention in SPEC §8.3, so it is a decision for the owner). From that point ship only ordinary additive migrations made with `prisma migrate dev`. Rewrite the easy upgrade path for Render as: press Sync fork, wait for the green deploy, done. Until then the marketing page should say plainly "beta: upgrades may require starting over".
- **How I know:** read in the code (the Render behaviour after a sync is inferred; I did not deploy)

### U3. A brand-new site's front page says "Loading..." for ever and offers no way to sign in
- **What is wrong:** On an install with no partners, `/` shows the heading and "Loading..." permanently. The public site has no "Sign in" link at all, and `/` does not send a fresh install to `/setup`. The new admin must know to type `/setup` or `/login`.
- **Where:** The public directory. `frontend/src/pages/PublicDirectory.jsx` lines 50 and 169 (`loaded = records.length > 0`); `frontend/src/components/PublicSiteHeader.jsx` (no sign-in link).
- **Who it affects:** Every new admin in their first minute; every staff member afterwards who has not bookmarked `/login`.
- **Evidence:** [screenshot](screenshots/u-empty-install-root-loading-forever.png). The request for partners returned an empty list successfully; the page still said "Loading...".
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** When setup is still needed, send `/` to `/setup`. Show "No partners have been added yet" for an empty list. Add a small "Team sign in" link in the public footer.
- **How I know:** reproduced in the running app

### U4. A care-team Guest can take a partner off, or put one on, the public website
- **What is wrong:** A Guest (described to admins as a church member with a limited login) can open "Status & Visibility" on their partner and change "Show on public site". It saves at once with no review. The "Restricted-access location" switch sits in the same dialog and is also enabled.
- **Where:** Partner page → Status & Visibility, signed in as a Guest with a care-team seat.
- **Who it affects:** Partners, above all those in sensitive places; the church's public site.
- **Evidence:** As the guest I switched "Show on public site" off and saved: the page showed "SHOWN ON PUBLIC SITE No" and the public address for that partner returned "not found". I switched it back on and it was public again. ([screenshot](screenshots/u-phone-guest-can-edit-public-visibility.png)) I did not test saving the "Restricted-access location" switch.
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Make visibility, restricted status, display name and photo deletion staff-only for care-team members, or hold those changes for approval the way their prayer requests are held. The security report should confirm the server side.
- **How I know:** reproduced in the running app

### U5. The care features the app is sold on are all off, and nothing leads a new admin to them
- **What is wrong:** The marketing headline is "Your missionaries should never feel forgotten", with reminders, a contact log and care teams listed first. On a new install all of these are off, the first screen has no "start here", and switching a feature on does not say what else it needs. Key-date reminders stay silent until someone is put on the "Missions team", on a settings page that appears without notice.
- **Where:** First landing (`/admin`); Settings → Enabled Features; Settings → Partner Care.
- **Who it affects:** Every new admin.
- **Evidence:** Path 1 above: 17 clicks and three unprompted discoveries. After enabling Key-date reminders with a birthday four days away, the bell said "Nothing waiting." The explanation ("Nobody is on the Missions team ... Pick at least one person") is only on Settings → Partner Care ([screenshot](screenshots/u-partner-care-nobody-on-missions-team.png)). Enabled Features lists 23 switches described in words like "The public list/search view at the site's root ("/")" and "work regardless of this flag".
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Replace the empty Home with a short checklist that completes itself: name your church, add your first partner, choose who looks after partners, turn on reminders, invite a teammate. Put the person who runs setup on the Missions team automatically. Turn Contact log and Key-date reminders on by default for new installs (a decision for the owner). When a feature is switched on but cannot work yet, say so on the spot.
- **How I know:** reproduced in the running app

### U6. Email is the hinge for most of what is promised, it needs a specialist to set up, and the half-set-up state fails silently
- **What is wrong:** Reminder emails, digests, welcome emails, survey invitations and the public prayer sign-up all need "Email (Sending)". Setting it up means a Postmark account, DNS records on the church's domain, a pasted token, and the separate worker service. Switching the feature on without finishing is worse than leaving it off.
- **Where:** Settings → Email; Settings → Manage Users; public `/subscribe`; `ADMIN_GUIDE.md` § Email (Postmark).
- **Who it affects:** Admins; new users; church members who subscribe.
- **Evidence:** (a) With email on but not set up, "Send setup link" for a new user shows only "Email isn't configured -- add a Postmark server token and From address under Settings → Email" and no link to copy ([screenshot](screenshots/u-add-user-dead-end-when-email-on-but-not-set-up.png)); with email off, the same button gives a link to copy. (b) "Public prayer digest" could be switched on in that state; a visitor is then told "Check your email to confirm your subscription." and nothing is sent ([screenshot](screenshots/u-phone-subscribe-says-check-email-but-email-not-configured.png)). (c) The setup text: "verify a sending domain (adds SPF/DKIM records to your domain's DNS), then copy the Server API Token".
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Treat "on but not set up" exactly like "off" everywhere (always offer the copy-link fallback; do not let Public prayer digest switch on until a test email has succeeded). Rewrite the setup as numbered steps with a "Send test email" gate at the end. Consider a simpler sending option for small churches (a decision for the owner).
- **How I know:** reproduced in the running app

### U7. Backups and recovery need a technician, and the app's first words to a new admin are about that
- **What is wrong:** There is no automatic backup. The download is manual, and restoring it is command-line only, through Render's Shell, after uploading the most sensitive file the app can produce to "a temporary, unlisted file host". A lone admin who loses their phone has no recovery codes; the screen says "ask an admin to reset it".
- **Where:** Banner on every admin page; Settings → About App; `ADMIN_GUIDE.md` § Database backups and § Restoring a backup; My Account → Two-Factor Authentication.
- **Who it affects:** Every church; worst for the one-person missions team.
- **Evidence:** First landing banner: "This app doesn't manage database backups itself — confirm your Postgres provider's backup/retention settings." About App: "if one is ever exposed, rotate SESSION_SECRET (see ADMIN_GUIDE.md)". Guide: "Restoring is deliberately CLI-only". I found no recovery path for a sole admin locked out of two-factor in the Render walkthrough.
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Say in one plain sentence what Render already backs up on the plan the Blueprint creates, and show the banner only after there is data. Offer one-time recovery codes at two-factor enrolment and prompt the first admin to add a second admin. Longer term, a guided restore.
- **How I know:** read in the code (banner and account text reproduced in the running app; sole-admin lockout is inferred)

### U8. The Render walkthrough leaves the background worker unable to send, and the real cost is about $20, not $13
- **What is wrong:** The Blueprint always creates a worker service (about $7 more a month). The worker needs the same encryption key as the website, "copied by hand" from one Render screen to another after deploy. The walkthrough has no such step and says to leave the prompted values blank.
- **Where:** `render.yaml` (worker `FIELD_ENCRYPTION_KEY`, `sync: false`, and its header comment on cost); `ADMIN_GUIDE.md` lines 84-103 and § Skipping the worker service; `README.md`; `docs/index.html`.
- **Who it affects:** Any church that later sets up email, GroupMe or WhatsApp: the daily reminder email and scheduled digests would never go out.
- **Evidence:** `render.yaml`: "about $13/mo for the web service + database, plus another ~$7/mo for the worker" and "MUST be the exact same value as the web service's own FIELD_ENCRYPTION_KEY, copied by hand". Guide step 3: "leave them blank to skip those optional features for now. `SESSION_SECRET` and `FIELD_ENCRYPTION_KEY` are generated automatically, nothing to enter." The guide itself admits "nothing in the admin UI currently checks whether the worker is actually running".
- **Severity:** causes real confusion
- **Recommendation:** Add the copy-the-key step to the walkthrough, or remove the need for it. Show "Background worker: running / not seen since ..." on Settings → About App. Quote the full monthly cost everywhere.
- **How I know:** read in the code (not deployed)

### U9. The public site does not say whose it is, and gives a member nothing to do
- **What is wrong:** The church's name never appears on the public site. A partner's public page has no prayer requests and no way to encourage them. A checkbox that promises otherwise does nothing a visitor can see.
- **Where:** `frontend/src/components/PublicSiteHeader.jsx` line 20 (reads logo and partner term, not the church name); public partner page; `frontend/src/components/admin/PrayerRequestFormFields.jsx` lines 51-64 ("Show on public profile"); `frontend/src/pages/PublicSubscribe.jsx` line 42.
- **Who it affects:** Church members and visitors; staff who tick "Show on public profile" expecting it to appear.
- **Evidence:** With the church name saved as "Hillside Community Church", `/` still read "Our Missionaries" ([screenshot](screenshots/u-public-root-no-church-name-or-sign-in.png)). The public partner data contains no prayer requests. The Subscribe page prints a fixed Bible passage, "Ephesians 6:13–20 (ESV)", for every church, which also breaks the rule that nothing church-specific is hardcoded. The digest offers only Monthly or Quarterly.
- **Severity:** causes real confusion
- **Recommendation:** Show the church name (from Church Settings) in the public header and browser tab. Either show public-flagged prayer requests on the partner's page or rename the checkbox to what it does. Move the verse into Church Settings or drop it. Add at least one thing a member can do (for example "Send a note of encouragement", delivered to the care team). Offer a weekly digest.
- **How I know:** reproduced in the running app

### U10. A partner has almost no voice, and what they do send has to be retyped
- **What is wrong:** Partners can only answer a survey the church chooses to send, or email a newsletter into a system only a technician can set up. A prayer need written in a survey stays a survey answer. An emailed update gets no acknowledgement.
- **Where:** Settings → Surveys (question types); partner page → Surveys; `backend/src/routes/inboundEmail.js` lines 86-170.
- **Who it affects:** Partners; the staff member who copies their words by hand.
- **Evidence:** The survey question types have no "prayer request". My answer "Please pray for the January leadership cohort ..." appeared only in a read-only dialog with "Edit answers". The inbound email code files or queues the message and returns; nothing is sent back. The survey page shows no church name ([screenshot](screenshots/u-phone-partner-survey.png)).
- **Severity:** causes real confusion
- **Recommendation:** Add a "Prayer request" question type whose answer arrives in the same approval list as other survey updates and becomes a real prayer request on approval. Put the church name and "Hello, [partner name]" at the top of the survey page and remove the public menu from it. Consider a standing personal link each partner can use at any time to send a prayer request or update (a decision for the owner).
- **How I know:** reproduced in the running app (inbound email: read in the code)

### U11. A Guest is not told what they are, what is hidden, or that their entries are held
- **What is wrong:** The guest's screens look like the staff screens with pieces missing. Nothing says "you can see only this partner" or "what you add is checked by staff before it is shared".
- **Where:** Guest sign-in landing; partner page; Add Prayer Request dialog; Add User wizard.
- **Who it affects:** Church members on care teams; admins inviting them.
- **Evidence:** After saving a prayer request as the guest, the dialog closed and the request appeared in the list like any other ([screenshot](screenshots/u-phone-guest-after-saving-prayer-no-held-notice.png)); staff see "Awaiting review · entered by a care team member" on Pending Dispatches. The role is labelled "Guest (only the trips you choose)" even when the next step is "Care team" ([screenshot](screenshots/u-add-user-guest-role-says-trips-only.png)). The guest's bell showed "Trip applications pending review 1".
- **Severity:** causes real confusion
- **Recommendation:** One line at the top of a guest's pages ("You're helping look after Eric and Jenny. You can see only their page."), and after saving: "Thanks. The missions team will review this before it's shared." Relabel the role "Guest (only the partners or trips you choose)". Hide staff-only fields ("Admin Notes", "Show on public profile") and staff alerts from guests.
- **How I know:** reproduced in the running app

### U12. You cannot see what is editable
- **What is wrong:** On a partner page, sections such as Status & Visibility, Ministry Overview and Wedding Anniversary have no Edit button; the whole card is a hidden click target. Settings pages work the same way, so Enabled Features looks like a read-only status list.
- **Where:** `frontend/src/components/admin/EditableSection.jsx` lines 66-77; Settings → Enabled Features, About & Branding, Partner Care, Email.
- **Who it affects:** Everyone, most of all on a phone, where there is no hover.
- **Evidence:** [partner page](screenshots/u-partner-page-sections-have-no-edit-button.png), [Enabled Features](screenshots/u-enabled-features-no-visible-switches.png). Some sections have "+ Add" buttons and some have nothing, on the same page.
- **Severity:** causes real confusion
- **Recommendation:** Put a visible "Edit" button on every editable card. On Enabled Features, show the switches on the page itself.
- **How I know:** reproduced in the running app

### U13. Home and the bell count things instead of naming them
- **What is wrong:** Alerts read "Key dates coming up · 1 item" or "Partners to reach out to · 5 items". They never say who or when, and system chores are listed above people.
- **Where:** `/admin` "Needs attention"; the bell.
- **Who it affects:** Every signed-in user, weekly.
- **Evidence:** Eleven cards for an editor on the seeded install, "Dispatches needing approval" first ([screenshot](screenshots/u-editor-home-eleven-count-cards.png)); at phone width that is about five screens of scrolling. The key-date bell item opens the top of a partner page without pointing at the date. "Unmatched emails 3" leads to "This feature is turned off. Turn it back on at Church Settings › Features" (the menu is actually Settings → Enabled Features). A follow-up that falls due does not change any count.
- **Severity:** causes real confusion
- **Recommendation:** Lead Home with "This week": named lines such as "Jeff Jorgensen's birthday is Tuesday" and "Follow up with the Okafors (due today)", each with one action. Put people before system items. Do not raise alerts for features that are off.
- **How I know:** reproduced in the running app

### U14. Everyday forms ask for decisions in the app's own vocabulary, and new partners are public at once
- **What is wrong:** Several common forms use internal terms or hide the choice the person actually has to make.
- **Where:** New Partner step 3; Add Prayer Request; Record Decision; partner page prayer list.
- **Who it affects:** Editors and admins doing weekly data entry.
- **Evidence:**
  - "Show on public site" is ticked by default on a new partner ([screenshot](screenshots/u-new-partner-step3-public-by-default.png)), and the public directory is on by default, so first data entry is published immediately.
  - Prayer request categories "Strategic" and "Situational"; "Not tracking this one for a specific answer"; the urgent option: "Sends immediately to WhatsApp, bypassing everyone's own schedule ... still respects a muted WhatsApp content type".
  - Record Decision has no decline choice ([screenshot](screenshots/u-record-decision-no-decline-option.png)); from the code a decline is an approved amount of 0.
  - A prayer marked answered looks unchanged in the partner page list.
- **Severity:** causes real confusion
- **Recommendation:** Default new partners to not public until someone chooses, or keep the whole directory off until the admin turns it on from the setup checklist (a decision for the owner). Rename the categories to what they mean ("OK to share" / "Team only"). Give Record Decision three buttons: Approve in full, Approve part, Decline. Mark answered prayers in the list.
- **How I know:** reproduced in the running app

### U15. The first admin has no name, and the first-run wording talks to them as if they were someone else
- **What is wrong:** Setup asks only for email and password. The admin then appears as "Someone" on what they log, and the two-factor screens refer them to an administrator.
- **Where:** `/setup`; forced two-factor screen; contact log; Manage Users; Missions team picker.
- **Who it affects:** The person setting the app up.
- **Evidence:** Contact entry "by Someone"; Missions team picker "pat@hillsidecommunity.org (pat@hillsidecommunity.org)"; "An administrator requires two-factor authentication on this account"; "Ask your administrator for help."
- **Severity:** minor
- **Recommendation:** Ask for first and last name (and the church's name) on `/setup`. Reword the two-factor screen for the first admin, and sign them in directly after setup instead of asking for the password twice.
- **How I know:** reproduced in the running app

### U16. Small things (one list)
- **Severity:** minor. **How I know:** reproduced in the running app.
- Empty Partners list says "No partners match these filters." instead of inviting the first partner.
- `/setup` shows no password rule; a too-short password gives no visible message.
- "Ctrl+K" hint on the search box at phone width.
- At phone width the "My partners" table cuts off "Follow up" and "Next key date" unless scrolled sideways ([screenshot](screenshots/u-phone-my-partners-key-columns-off-screen.png)).
- Raw status "accepting_applications" shown on the partner page Mission Trips list.
- Add User without `APP_BASE_URL` (non-Render hosts): "the welcome email couldn't be sent (APP_BASE_URL isn't set, so a setup link can't be built)".
- Dispatch Settings: "Every schedule on this page only fires from the separate background worker process".
- About App lists Node.js, React, Express and Prisma versions before the backup button.
- "Contact Log" has a page of its own (`/admin/contact-log`) that is not in the menu; "My partners" is a tab, not a menu item.
- Feature description typo: "add an My partners view".
- The System/Light/Dark switch takes a full row of the header on every public page on a phone.
- The booklet prints adults' phone and email by default, including for a partner marked "Use caution".

---

## Would a church say yes today?

**No**, for the church this is meant for: a small or mid-sized church where one volunteer or staff member runs missions and has no developer to call. **Yes, conditionally**, for a church that has a technical volunteer who will install it, stay on call, and accept that this is a beta whose upgrades may wipe the data.

Why they would not, in order:

1. **They cannot get it running.** Terminal, git, Node, a hosting dashboard, a region that can never be changed. The promise that no coding knowledge is needed fails at step one.
2. **They cannot trust it with real data yet.** Upgrades have repeatedly required erasing the database; backups are manual; restoring needs a command line.
3. **The first five minutes give them nothing.** A front page stuck on "Loading...", a second password prompt, a mandatory authenticator app, then a backup warning about "Postgres" and an empty dashboard with the care features switched off.
4. **The headline promise needs email, and email needs a specialist.** Without Postmark, DNS records and the worker, reminders only reach people who remember to sign in and look at the bell.
5. **The "limited" guest login is not limited enough** to hand to ordinary church members: they see adults' personal contact details and can change whether a partner is public.
6. **Their congregation and their missionaries get little from it.** Members can read and subscribe; partners can answer a survey. Neither can say anything to the other.

What would change the answer fastest: an install with no terminal (or a hosted option), a promise of no more data resets, a first-run checklist that turns on reminders and the contact log and puts the admin on the Missions team, and fixing U3 and U4.

---

## What I couldn't check, and why

- **A real install on Render, and a real upgrade.** Out of bounds. U1, U2 and U8 come from the documents and `render.yaml`; what Render does after "Sync fork" on a squashed release is inferred.
- **Any real email, the worker, GroupMe, WhatsApp, AI scanning, Joshua Project.** Not configured and not started, by instruction. The reminder email, digests and scheduled sends were judged from settings screens and code only.
- **How long a real volunteer takes.** I counted clicks, screens and decisions; a script's elapsed time says nothing about a person's. The minute figures are estimates.
- **The public map.** Background tiles could not load in the sandbox, so I saw pins on grey. I did not judge pin precision visually; the public data carries city-level coordinates.
- **Passkeys** (needs a real device), **submitting a trip application**, the trip participant pages and trip admin screens.
- **Whether a Guest can save "Restricted-access location".** I saw the enabled switch and proved the neighbouring "Show on public site" switch saves; I did not try the restricted one.
- **`npm run preview:digest`.** It writes files inside the repository, which I was not allowed to do; I called the same message builder directly instead and read its output.
- **Why partner photos did not appear on public cards** in my screenshots; I did not investigate.
- **Screen readers and keyboard-only use.** Not tested.
- Both my local servers were stopped once mid-review by something outside my session and restarted with the same databases; nothing was lost, and the affected step was re-run.
