# 1. Complexity: switches, settings, alerts, jobs, roles and words
**Status: Draft, not yet verified by the lead reviewer.**
**Reviewed:** branch `dev` at e713437 (0.1.0-beta.3), 2026-11-26.

## Summary

The app is not too complex to *use* on day one: an untouched install shows a short menu (8 entries), 5 Settings cards and one alert. It is too complex to *grow into*. Every useful extra (an email to the team, a birthday reminder, a trip sign-up link, a chat post) is a chain of three to six separate steps spread over different Settings pages, and the app rarely says which step is still missing. Switches read "On" while the thing they control cannot work yet; several pages tell you to "turn it on once configured" when the page is hidden until it is turned on. The vocabulary is the builder's ("dispatch", "cadence", "tier", "webhook", "MFA"), and a developer ticket number is printed on a Settings screen. The counts in issue #477 are roughly right for the feature list and the bell, but understate the rest: there are 45 church-wide on/off switches (not 23), 8 scheduled jobs (not 5), and about 105 individual settings. My answer to the review question, from the complexity side: **not ready to invite non-technical churches until the setup chains are collapsed and the defaults stop publishing partners.** The fixes are mostly merging and re-wording, not new features.

### Counts at a glance

Every number below was counted from the file named. Nothing is carried over from issue #477.

| Item | Count | Source |
|---|---|---|
| Feature switches in the registry | **23** (9 on by default, 14 off) | `backend/src/utils/features.js:17-221` |
| Church-wide on/off switches *outside* the registry | **22** shown to a church (plus 1 internal, `demoMode`) | `backend/prisma/schema.prisma:1213-1493` |
| Second copies of a registry switch on another page | **2** (the "Enabled" boxes on the Email page) | `frontend/src/pages/AdminSettingsEmail.jsx` (Sending and Receiving cards) |
| Per-person switches and choices | **5** on/off + **2** pick-one | `backend/prisma/schema.prisma:1506-1582` |
| All yes/no columns in the database | 55 (23 on `ChurchSettings`) | `grep Boolean backend/prisma/schema.prisma` |
| Settings cards on the Settings home page | **5** on a default install, **14** with everything on | `frontend/src/pages/AdminSettingsHome.jsx:5-93` (both seen in the running app) |
| Pages under Settings | **18** routes, plus My Account | `frontend/src/main.jsx:309-398` |
| Individual settings a church can change | about **51** on a default install, about **105** single values plus 6 list editors with everything on | counted per page, table in Reference B |
| Bell alert types | **20** (4 admin-only, 12 a guest can see) | `backend/src/notifications/categories.js:374-588` |
| Scheduled jobs | **8** timers started by 7 functions, plus 1 always-open WhatsApp connection. All in the worker; none in the web server | `backend/src/worker.js:42-57`, each `*Scheduler.js`, `careChatDispatch.js:161` |
| Distinct kinds of email the app can send | **19** | callers of `sendEmail` / `sendEmailBatch` / `sendParticipantEmail`, table in Reference E |
| Roles | **4** stored roles; **9** role-like states a person can be in | `schema.prisma:1516`, `1552`, `1604-1666` |
| Main menu entries for an admin | **8** default, **12** with everything on (plus 3 footer links) | `frontend/src/components/admin/AdminSidebar.jsx:133-181` |

## Findings

### C1. Getting one email to the team takes about eight steps in five places, and the app does not say which one is missing

- **What is wrong:** "Email my team a monthly update" needs, in order: (1) Enabled Features, turn on Email (Sending); (2) open a Postmark account and add records to the church's domain; (3) Settings, Email: paste a "Server API Token" and a From address; (4) Settings, Dispatches, Email Schedule: pick a day of the month and an hour, both empty by default; (5) each person opens My Account and picks a "Digest cadence", empty by default; (6) the second background service must be running on the host; (7) on Render that service needs a key copied by hand from the first service; (8) off Render, `APP_BASE_URL` must be set or links are left out. Miss any one and nothing is sent, with no message.
- **Where:** `features.js:102-109`; `backend/src/utils/email.js:12-23`; `schema.prisma:1374-1376` (schedule fields have no default); `emailDispatchScheduler.js:51,61,72` ("not configured yet" returns quietly); `schema.prisma:1560` (personal `cadence` is empty by default); `worker.js`; `render.yaml` (worker `FIELD_ENCRYPTION_KEY` is `sync: false`).
- **Who it affects:** The admin setting up, and everyone who then expects an email that never comes.
- **Evidence:** With Email (Sending) switched on and nothing else set up, Pending Dispatches showed only "Nothing waiting to go out." and My Account offered "Email Dispatch: No automatic digest" with no warning that no schedule or mail account exists. The only warning the page has is for when *all three* channels are off (`AdminPendingDispatches.jsx:217-228`). The Email card reads "Enabled · Not configured" (`AdminSettingsEmail.jsx:118-121`), so "on" does not mean "working".
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** One page, "Email updates", that walks the chain top to bottom and shows a tick or a plain "still to do" beside each link: mail account connected, test email received, day and time chosen, who gets it, background service seen in the last hour. Give the schedule a default (for example the 1st of the month at 9am) and put new missions team members on it by default, so steps 4 and 5 disappear. Remove the separate on/off switch: email is on when it is connected.
- **How I know:** reproduced in the running app

### C2. Seven kinds of sending depend on a second service the app cannot see

- **What is wrong:** Every scheduled thing runs only in a separate "worker" service: the email digests, GroupMe and WhatsApp posts, trip meeting and checklist reminders, the daily key-date email, scheduled report emails, partner care chat posts, and the nightly audit clean-up. The web app has no way to know whether the worker is running, so it cannot warn anyone. A church that skipped the worker (it costs about $7 a month more) or whose worker has the wrong key gets a site that looks complete and sends nothing.
- **Where:** `backend/src/worker.js:42-57`; `backend/src/server.js:270` ("Schedulers and the WhatsApp connection run in worker.js, not here"); the one on-screen mention is small grey text on Dispatch Settings (`AdminDispatchSettings.jsx:97-108`).
- **Who it affects:** Any church whose host is not running the worker, and the people waiting for reminders.
- **Evidence:** No "last seen" time for the worker exists in `ChurchSettings` or in `routes/systemInfo.js`. The warning text is on one page out of the seven features that depend on it; Partner Care, Trips, Reports and the feature list do not mention it.
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Have the worker record a "last ran" time once a minute; show "Reminders and scheduled emails are not running" on Home, About App and each affected page when it is more than a few minutes old. Decision for the owner: whether small churches should be able to run the timers inside the web service so there is only one thing to host.
- **How I know:** read in the code

### C3. An untouched install publishes partners to the internet

- **What is wrong:** Public directory and Public map are on by default, and the New Partner form starts with "Show on public site" ticked. A church that never opens Settings has every partner it enters listed on a public page and map unless the person entering it unticks a box on step 3 of the form.
- **Where:** `features.js:18-31` (`defaultEnabled: true`); `frontend/src/pages/AdminPartnerForm.jsx:32` (`isPublic: true`) and `:173-180`. The database default is the opposite (`schema.prisma:20`, `isPublic ... @default(false)`), so the form overrides a safe default.
- **Who it affects:** Partners, especially those in sensitive places; the church's duty of care.
- **Evidence:** On an empty install `/` showed "Our Missionaries" and `/map` showed "Our Missionaries Around the World" before any admin existed. The tick-box default is read from the form's starting values, not clicked through.
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Default both public switches off, merge them into one "Public site" choice (the map is a view of the same list), and ask "Should people outside your team be able to see your partners?" once during first-run. Start "Show on public site" unticked. This matches finding F1 in `0-fresh-eyes.md`.
- **How I know:** read in the code

### C4. The two safety settings for restricted partners live on a page that is hidden on a default install

- **What is wrong:** "Show initials for restricted partners" decides how a restricted partner's name appears *on the public site* (initials such as "J.R." by default; the page itself warns that initials plus country can identify someone). It is only editable on Settings, Dispatches, and that page is hidden and blocked unless Email (Sending), GroupMe or WhatsApp is on. So a church with the public site on and no messaging cannot reach the setting.
- **Where:** setting used by the public site at `backend/src/routes/publicPartners.js:33-38`; edited only at `AdminDispatchSettings.jsx:134-193`; page gated at `main.jsx:387-394` and hidden at `AdminSettingsHome.jsx:74-79`.
- **Who it affects:** Restricted partners; the admin who wants the safer option.
- **Evidence:** On a default install `/admin/settings/dispatches` answered "This feature is turned off. Turn it back on at Church Settings › Features to use this page again."
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Move both restricted-partner settings to a page that is always there (About & Branding, under the public site section, or a small "Restricted partners" card). Decision for the owner: make the generic label the default and initials the opt-in.
- **How I know:** reproduced in the running app

### C5. "Pending Dispatches" is where the app says things wait, but the page does not exist on a default install

- **What is wrong:** Enabled Features tells the admin, for Prayer requests, One-time needs and Newsletters: "Without email: New requests wait on Pending Dispatches, where you can copy what is ready to share." With email, GroupMe and WhatsApp all off (the default), Pending Dispatches is not in the menu and its address is blocked. The page even contains a warning written for exactly this case ("Nothing here goes out on its own... Email (Sending), GroupMe and WhatsApp are all off") that nobody can reach.
- **Where:** `features.js:36,44,52`; menu `AdminSidebar.jsx:160-166`; route `main.jsx:298-304`; unreachable warning `AdminPendingDispatches.jsx:217-232`.
- **Who it affects:** Any church without messaging set up. Also churches with Care teams on and no messaging: what a care team member enters is "held" for staff approval and raises the bell alert "Dispatches needing approval", whose link leads to the blocked page (`categories.js:87-97` has no feature check; `prayerRequests.js:142` sets the hold).
- **Evidence:** `/admin/pending-dispatches` on a default install: "This feature is turned off." The stuck-alert case for care teams is read from the code, not reproduced.
- **Severity:** causes real confusion
- **Recommendation:** Either always show the page (renamed "Updates to share", see C10) or stop promising it. Do not raise an alert whose page is blocked.
- **How I know:** reproduced in the running app

### C6. Setup pages say "turn it on once configured" but are hidden until it is turned on

- **What is wrong:** Three setup pages give instructions the menus make impossible. Integrations: "Turn it on in Enabled Features once a key is saved below", but the Integrations card only appears after AI Features or Joshua Project is on. GroupMe: "Turn this on in Enabled Features once it's configured below", but the GroupMe card only appears after GroupMe is on. Email is the reverse and stricter: the page cannot load at all until a switch is on, and shows a bare error.
- **Where:** `AdminSettingsIntegrations.jsx:21-23,58-59` vs `AdminSettingsHome.jsx:80-85`; `AdminSettingsGroupMe.jsx:227-229` vs `AdminSettingsHome.jsx:62-67`; `backend/src/routes/settingsEmail.js:63,81`.
- **Who it affects:** The admin, on the first attempt at each connection.
- **Evidence:** On a default install `/admin/settings/integrations` loads by address but has no card or menu link; `/admin/settings/email` shows "Couldn't load email settings."
- **Severity:** causes real confusion
- **Recommendation:** One rule everywhere: the connection page is always reachable from a single "Connections" card, and the thing is on when it is connected. That removes six registry switches as separate decisions (Email sending, Email receiving, GroupMe, WhatsApp, AI, Joshua Project).
- **How I know:** reproduced in the running app

### C7. Switches that do nothing until something on another page is set

- **What is wrong:** Several switches can be turned on and then silently do nothing. The list, each with what is still missing:
  - **Key-date reminders** and **Contact log**: nobody is "on the Missions team" by default (not even the first admin), so no one is reminded. The warning is only on Settings, Partner Care.
  - **Mission trips**: nobody can apply. Applying needs either Public trip discovery (another switch, plus a per-trip "public" tick) or "Allow staff to generate private application links" (Settings, Trips, Access & Links, off by default). The trip page shows a "Generate private application link" button that fails with "check that private application links are enabled in Trip settings".
  - **GroupMe / WhatsApp**: nothing posts until a daily "Time" is chosen on the separate Dispatches page (empty by default), although the GroupMe page says posts go out "as they're added".
  - **Biweekly / Monthly / Quarterly**: a person can pick Monthly while the church has set no day, so it never sends.
  - **Partner care chat posts** (three tick-boxes on Dispatches): each needs another feature on, and a "Partner care" topic picked on the GroupMe or WhatsApp page.
  - **Joshua Project**: needs a key *and* a country code typed on every existing partner.
  - **Time zone**: the default is America/Chicago, setup never asks, and a change "takes effect the next time the app restarts", which a volunteer cannot do.
- **Where:** `schema.prisma:1552` and `backend/src/routes/auth.js:133-140`; `backend/src/routes/trips.js:673-680`, `frontend/src/pages/AdminTripTeam.jsx:53,254`; `schema.prisma:1383`, `AdminSettingsGroupMe.jsx:226-229`; `AdminDispatchSettings.jsx:305-311,490-512`; `features.js:216`; `AdminSettingsAbout.jsx:222-226`, `schema.prisma:1393`.
- **Who it affects:** The admin, who sees "On" and reasonably believes it works.
- **Evidence:** I turned on Key-date reminders on a fresh install: Home and the bell were unchanged, and only Settings, Partner Care said "Nobody is on the Missions team, so partners without a care team have no one looking after them: no reminders, and nothing on My partners." The other items are read from the code.
- **Severity:** causes real confusion
- **Recommendation:** When a switch is turned on, finish the job in the same place: put the person turning on a partner-care feature on the missions team; turn on private application links with Trips; give chat and email schedules a default time; ask for the time zone at first-run and apply it without a restart. Where something still cannot work, show "On, but not working yet: ..." beside the switch.
- **How I know:** reproduced in the running app

### C8. Nothing guides a new church: setup asks for an email and a password and stops

- **What is wrong:** First-run collects only the admin's email and password, then requires two-factor sign-in. It never asks the church's name, time zone, or whether the site should be public. The admin lands on Home with no "start here" list. The menu title stays "Missions Team Admin" and the public site says "Our Missionaries" with no church name until someone finds Settings, About & Branding.
- **Where:** `frontend/src/pages/Setup.jsx:61`; `backend/src/routes/auth.js:116-152`; `frontend/src/pages/AdminHome.jsx` (no checklist).
- **Who it affects:** Every new church, in the first ten minutes.
- **Evidence:** Fresh install: the setup form has three fields. After sign-in, Home shows "Needs attention: Time to check your backups" and seven "Browse" cards. The first admin has no name on their own account.
- **Severity:** causes real confusion
- **Recommendation:** A three-screen first-run: your account; your church (name, time zone, public or private); your first partner. Then a short "Next steps" list on Home that ticks itself off and can be dismissed.
- **How I know:** reproduced in the running app

### C9. 45 church-wide switches in three different styles, plus duplicates

- **What is wrong:** A church meets 23 switches on Enabled Features and 22 more scattered across Manage Users (3), Dispatches (11), Trips settings (6), About & Branding (1) and About App (1). Some are worded as "on means allowed", some as "on means muted" ("Muted: None" shows three ticked boxes), one as "on means stop reminding". Email (Sending) and Email (Receiving) each have a second "Enabled" box on the Email page. Many are choices no small church needs to make (three separate digest frequencies; whether a passkey button shows on the sign-in page; whether the church's own partner word is used in the admin menu).
- **Where:** `features.js:17-221`; `schema.prisma:1235,1340,1350,1362,1367,1397-1405,1410,1416,1450-1452,1459-1476`; `AdminDispatchSettings.jsx:412-498`; `AdminSettingsEmail.jsx` (both cards).
- **Who it affects:** The admin; and the owner, since every switch is a combination to keep working.
- **Evidence:** Full list with a recommendation for each in Reference A.
- **Severity:** causes real confusion
- **Recommendation:** Following Reference A, a church would see about **9** feature choices instead of 23, and about **8** other switches instead of 22. The biggest merges: one "Public site"; one "Partner care" (contact log, key dates, care teams); connections on when connected (C6); chat content chosen by picking a topic rather than by six tick-boxes.
- **How I know:** read in the code

### C10. The words on screen are the builder's words

- **What is wrong:** The app's central idea for telling people things is called a "dispatch", sent on a "cadence" in "tiers", sometimes "subject to review", through "channels" with "content-type mutes". Setup pages ask for a "Server API Token", "Webhook Username", "Inbound webhook", "SPF/DKIM records", "HTTP Basic Auth". A developer ticket number is printed in help text: "Which tiers to offer at all (#209)." The same thing has several names: "MFA", "Two-factor sign-in", "Two-Factor Authentication"; "Unmatched Email" (menu), "Unmatched Emails" (page), "Inbound email errors" (bell); "Enabled Features" (menu) and "Church Settings › Features" (the blocked-page message); "Dispatches" (card) and "Dispatch Settings" (page title).
- **Where:** Full list with file and line in the Jargon section below. The ticket number is `AdminDispatchSettings.jsx:313`.
- **Who it affects:** Every non-technical admin; for alert names, every user.
- **Evidence:** 40 quoted strings in the Jargon section.
- **Severity:** causes real confusion
- **Recommendation:** Adopt the replacements in the Jargon section. The three that matter most: "dispatch" becomes "update"; "cadence/tier" becomes "how often"; "MFA / two-factor" becomes one phrase, "sign-in code", everywhere.
- **How I know:** read in the code

### C11. The bell has 20 alert types; the first one a new admin sees is about database backups

- **What is wrong:** On day one the only alert, and a banner across every page, is "Time to check your backups" with the text "This app doesn't manage database backups itself — confirm your Postgres provider's backup/retention settings." It returns every 30 days for every admin. With features on, the bell can show up to 20 differently named lines, six of them about trips, several of them pairs that mean nearly the same thing to the reader ("Trips departing soon" and "Trips departing soon, incomplete"; "Unmatched emails" and "Inbound email errors"; "Survey updates to review" and "New survey answers").
- **Where:** `categories.js:374-588`; `frontend/src/components/admin/BackupReminder.jsx:5-12`; 30-day repeat at `categories.js:30,341-350`.
- **Who it affects:** Admins first; then anyone reading the bell.
- **Evidence:** Fresh install, first sign-in: bell badge "1", Home "Needs attention: SYSTEM: Time to check your backups", and the banner above.
- **Severity:** causes real confusion
- **Recommendation:** Merge to about 9 alert types (Reference C). Hold the backup reminder until there is data worth backing up (for example 14 days in, or 5 partners), word it as "Download a safety copy of your data", and make the download the main button.
- **How I know:** reproduced in the running app

### C12. Nine role-like states, and the Add User form does not explain them

- **What is wrong:** A person can be an Admin, Editor or Viewer; a Guest who is a trip leader; a Guest on a care team; a care team Lead or Member (in addition to any role); "on the Missions team"; and can separately be active or "Awaiting setup". The Add User form lists "Admin / Editor / Viewer / Guest (only the trips you choose)" with no line saying what an Editor or Viewer can do. On a default install it offers Guest although Trips and Care teams are both off (so a guest can be given nothing), and shows the tick-box "On the Missions team (looks after partners that have no care team)", which has no effect until a partner-care feature is on. The Users table prints roles as lowercase code words ("admin").
- **Where:** `frontend/src/pages/AdminUserForm.jsx:133-160`; `frontend/src/pages/AdminUsers.jsx:304-309`; `schema.prisma:1516,1552,1604-1666`.
- **Who it affects:** The admin adding a teammate.
- **Evidence:** Fresh install, Settings, Manage Users, Add User: all four roles and the Missions team box are shown. Role inventory in Reference F.
- **Severity:** causes real confusion
- **Recommendation:** One sentence under each role ("Editor: can add and change everything except settings and users"). Hide Guest until Trips or Care teams is on, and the Missions team box until a partner-care feature is on. Decision for the owner: whether Viewer is needed at all for a team of two to five people.
- **How I know:** reproduced in the running app

### C13. Three church-wide sign-in switches on top of a required authenticator app

- **What is wrong:** A new install requires two-factor sign-in for everyone (set during setup). Manage Users then offers three more controls: "Two-factor sign-in: Stop requiring it", "Passkey sign-in: Show 'Sign in with a passkey' on the sign-in page", and "Passwordless sign-in". Add User has a fourth, per person: "Require two-factor authentication at first sign-in", shown even when it is already required for everyone. The very first admin is told "An administrator requires two-factor authentication on this account" when they are the administrator.
- **Where:** `backend/src/routes/auth.js:142-149`; `frontend/src/pages/AdminUsers.jsx:405-478`; `AdminUserForm.jsx:233-241`; `frontend/src/pages/Login.jsx:182`.
- **Who it affects:** The admin; each volunteer at first sign-in.
- **Evidence:** Seen on a fresh install (the three cards on Manage Users, and the message during the first admin's enrolment).
- **Severity:** minor
- **Recommendation:** Keep the requirement. Show the passkey button automatically whenever any account has a passkey (removes one switch). Tuck Passwordless under "More sign-in options". Hide the per-person box while the church-wide requirement is on. Whether requiring an authenticator app is the right bar for volunteers at all belongs to the security review.
- **How I know:** reproduced in the running app

### C14. Dependencies the registry does not declare, and a guide that declares ones that do not exist

- **What is wrong:** The registry says it is "the ONLY place a dependency is declared", and declares three (`publicTripDiscovery` needs `trips`; `publicPrayerDigest` needs `publicDirectory` and, to switch on, `outboundEmail`; `aiExtraction` needs `partnerFiles`). The code enforces more by hand: Email (Receiving) files nothing useful with Newsletters & Docs off (assigning a queued email answers "Not found"); a survey's support question needs Support preferences; the support-preferences template pack needs Care teams; partner care chat posts need Key-date reminders or Contact log; trip, key-date and report emails need Email (Sending). In the other direction, the Admin Guide's "What each feature needs" table says Key-date reminders, Support preferences, Partner surveys and Contact log all need Care teams. The code does not require that (they fall back to the missions team).
- **Where:** `features.js:229-232`; `backend/src/routes/inboundEmail.js:276-280`; `routes/surveys.js:290-294`; `utils/templatePacks.js:157`; `utils/careChatDispatch.js:144-153`; `ADMIN_GUIDE.md:248-251`; stale comment `categories.js:67`.
- **Who it affects:** An admin reading the guide to decide what to turn on; the owner maintaining it.
- **Evidence:** Dependency map below.
- **Severity:** minor
- **Recommendation:** Correct the guide's table. Declare Email (Receiving) needs Newsletters & Docs in the registry so the settings page greys it out with the reason.
- **How I know:** read in the code

### C15. The "Monthly support" switch describes a page with no link to it

- **What is wrong:** The switch reads "Monthly support: The Monthly Support report page." That page exists at `/admin/support/monthly` but nothing in the menu, Home, or any other page links to it. What the switch visibly controls is the Monthly Support section on each partner's page.
- **Where:** `features.js:56-61`; route `main.jsx:185-192`; no other reference in `frontend/src` (searched for `support/monthly`).
- **Who it affects:** Whoever keeps the church's support figures.
- **Evidence:** Typing the address on a fresh install opens a working "Monthly Support" page with "+ Add Support Entry".
- **Severity:** minor
- **Recommendation:** Link the page (from Reports, or the menu) or fold it into Reports, and drop the switch: support amounts are core to a partner record.
- **How I know:** reproduced in the running app

## Dependency map

"Declared" means in the registry (`features.js`), so Enabled Features greys the switch and says why. "By hand" means enforced somewhere else, so the admin finds out later or not at all.

| Feature | Needs | Declared? | Would a user hit it by surprise? |
|---|---|---|---|
| Public trip discovery | Mission trips | Declared (`features.js:81`) | No. But each trip also needs its own "public" tick (`schema.prisma:239`) |
| Public prayer digest | Public directory; Email (Sending) to switch on | Declared (`:138-141`) | Partly: also needs a mail account, a schedule and the worker (C1) |
| AI Features | Newsletters & Docs | Declared (`:206`) | Yes: also needs an Anthropic key, on a page hidden until this is on (C6) |
| Email (Sending) | Postmark account, token, From address | By hand (`email.js:17-22`) | **Yes.** Reads "Enabled" while "Not configured" |
| Email digests | Email (Sending) + a day and hour on Dispatches + each person's own choice + worker | By hand (`emailDispatchScheduler.js:51-72`) | **Yes** (C1) |
| Email (Receiving) | Postmark inbound webhook, username, password; Newsletters & Docs | By hand (`inboundEmail.js:105,276-280`) | **Yes.** Newsletters & Docs is not mentioned on the switch |
| GroupMe / WhatsApp | Token or linked phone; group and topics; a daily hour on Dispatches; worker | By hand (`groupmeChannel.js:128-137`, `schema.prisma:1383`) | **Yes.** Hour is on another page and empty by default |
| WhatsApp | A dedicated phone number; worker running continuously (it holds the connection) | By hand (`worker.js:51-57`) | **Yes** |
| Partner care chat posts (3 tick-boxes) | GroupMe or WhatsApp; Key-date reminders or Contact log; a Partner care topic | By hand (`careChatDispatch.js:132,144-153`) | Partly: the labels say "(needs ... on)" but the box can still be ticked |
| Key-date reminders | Someone on the missions team or a care team; birthdays entered. Email also needs Email (Sending) + worker | By hand (`ownership.js:23-29`, `keyDateReminderScheduler.js:31`) | **Yes** (C7) |
| Contact log alerts | Someone on the missions team or a care team | By hand (`categories.js:52-62`) | **Yes** (C7) |
| "Updates to pass on" alert | Contact log; reads One-time needs and Prayer requests | By hand (`contactLogQueries.js:147-153`) | Minor |
| "Trips wrapped up" alert | Mission trips and Care teams | By hand (`categories.js:191-197`) | No |
| Mission trips: applying | Public trip discovery, or "private application links" in Trips settings | By hand (`trips.js:676`) | **Yes** (C7) |
| Mission trips: support-raising page | "public support-raising pages" in Trips settings | By hand (`tripParticipants.js:225`) | Yes, same pattern |
| Trip emails and reminders | Email (Sending); reminders also need the worker | By hand (`tripEmails.js:16-21`, `tripReminderScheduler.js:20-21`) | Handled well when email is off (links are handed over to copy). Reminders silently never happen |
| Partner surveys: sending | Email (Sending); `APP_BASE_URL` | By hand (`surveys.js:384-389`) | Error message names an environment variable |
| Survey support question | Support preferences | By hand (`surveys.js:290`) | No, clear message |
| Scheduled report emails | Reports; Email (Sending); worker | By hand (`reportScheduler.js:58-59`) | Yes: silently skipped |
| Passwordless sign-in | Working email, `APP_BASE_URL`, the admin's own passkey | By hand (`passwordless.js:43-68`) | No: the page says why |
| Passkeys | `APP_BASE_URL` matching the site address | By hand (`passkeys.js:12-22`) | Yes off Render; message asks to "Tell whoever runs the site" |
| Joshua Project stats | API key; country code on each partner | By hand (`features.js:216`) | Yes |
| Pending Dispatches page | Email (Sending), GroupMe or WhatsApp on | By hand (`main.jsx:298-304`) | **Yes** (C5) |
| Dispatches settings (incl. restricted-partner settings) | same | By hand (`main.jsx:387-394`) | **Yes** (C4) |
| Every schedule | Church time zone; a restart after changing it | By hand (`worker.js:26-39`) | **Yes** (C7) |
| Audit log clean-up | Worker | By hand (`auditPruneScheduler.js`) | Entries past the chosen 30/60/90 days are kept if the worker is not running |
| Links inside worker-sent emails | `APP_BASE_URL` or Render's own address variable in the *worker* service | By hand (`dispatchBlurbs.js:39-41`) | **Inferred, not confirmed:** Render documents its address variable for web services; if the worker does not get it, digest and key-date emails would go out without links |

## Defaults verdict: what a church that never opens Settings gets

**What is on:** Public directory, Public map, Newsletters & Docs, Prayer requests, One-time needs, Monthly support, Print booklet, Reports, Audit log (`features.js`, the nine `defaultEnabled: true`). Two-factor sign-in is required for everyone (`auth.js:145-149`). Time zone is America/Chicago (`schema.prisma:1393`).

**What the menu shows (seen in the running app):** Home, Partners, Newsletters & Docs, Prayer Requests, One-Time Needs, Print Booklet, Reports, Settings; then View Public Site, My Account, Log out and a light/dark toggle. Settings has five cards: About & Branding, Manage Users, Audit log, Enabled Features, About App.

**What is public to the internet on day one:** The directory at `/` and the map at `/map`, and a page for every partner whose "Show on public site" box is left ticked, which is the starting state of the form (C3). A restricted partner appears with initials and a country-level pin. The site has no church name on it until Settings is opened.

**What alerts fire:** For an admin, "Time to check your backups" immediately and every 30 days, with a banner. For everyone, "New prayer requests" and "New one-time needs" as records are added. Nothing else can fire on defaults.

**What never works without setup:** Any email at all (new users get a setup link the admin must copy and pass on by hand; a forgotten password cannot be reset by email, `auth.js:453-472`). Any reminder. Any chat post. Trips, surveys, care teams, key dates, contact log. Each new prayer request, need and newsletter is still recorded for sending (`dispatchRecording.js:41-48`) to a queue page that cannot be opened (C5).

**Are the defaults right?** The shape is right: a small core on, everything that sends or needs an account off. Four defaults are wrong:

1. **Public by default.** Change to private until the church says otherwise (C3).
2. **Restricted partners shown as initials.** Decision for the owner: default to the generic label (C4).
3. **Nobody on the missions team.** The first admin should be on it, so the first partner-care switch works (C7).
4. **Schedules empty.** Day, hour and "how often" should have working defaults so that connecting email is the only step (C1).

I would also turn the Audit log switch into a fixed part of the app (it is on by default and a church gains nothing by choosing), and drop Monthly support as a switch (C15).

## A target: how many things a church must touch

**Today, to reach "my team can sign in and our partners are in": 7 touches, 3 Settings pages.**

1. `/setup`: email, password, confirm.
2. Sign in and set up an authenticator app or passkey (required).
3. Settings, About & Branding, Church Info: church name (and time zone, which then needs a restart).
4. Settings, Enabled Features: decide whether the public site should be on (or remember to untick a box on every partner).
5. Add the first partner (three-step form).
6. Settings, Manage Users, Add User: with email off, copy each person's setup link and send it yourself; each person then does step 2.
7. Deal with the backup banner.

**Today, to reach "the app reminds my team about something by email": 8 more touches, for 15 in all, across 7 Settings pages and 2 outside systems.**

8. Enabled Features: Email (Sending) on.
9. Postmark: open an account, verify the church's domain (DNS records).
10. Settings, Email: token, From address, Send Test Email.
11. Settings, Dispatches, Email Schedule: day and hour.
12. Each person: My Account, Email Dispatch, Digest cadence.
13. Host: worker service running with the same encryption key as the web service.
14. Enabled Features: Key-date reminders on.
15. Settings, Partner Care: tick who is on the Missions team.

**Target: 3 touches before the app is useful, none of them in Settings. One more page for email.**

- First-run of three screens: your account; your church (name, time zone, public or private); your first partner.
- "Email updates": one page, one outside account, with defaults for when and who.

**What would have to change to hit it:**

| Change | Removes touches |
|---|---|
| Ask church name, time zone and public/private in first-run; apply time zone without a restart | 3, 4 |
| Private by default; "Show on public site" unticked | 4 |
| Hold the backup reminder until there is data; plain wording | 7 |
| Connection pages always reachable; "on" means "connected" | 8, and the hidden-page traps in C6 |
| Default schedule (1st of month, 9am) and default "how often" for the missions team | 11, 12 |
| First admin is on the missions team; partner-care features merged into one | 14, 15 |
| Worker reports that it is alive; the app warns when it is not (or timers can run in the web service: owner's decision) | 13 becomes visible instead of silent |
| A simpler way to send email than a domain-verified Postmark account | 9. This is outside my review; it is the largest single obstacle and belongs with the install review |

Step 2 (authenticator app) and step 6 (copying setup links by hand) stay unless the owner decides otherwise.

## Jargon list

Replacements follow STYLE-GUIDE.md § Copy tone: plain, direct, no marketing language. "Not found on screen" means I searched `frontend/src` (non-test files) and the feature and alert labels in `backend/src` and found the word only in code or docs.

| Word | Exact string on screen | File | Plain replacement |
|---|---|---|---|
| dispatch | "Pending Dispatches" (menu, page title) | `AdminSidebar.jsx:165`, `AdminPendingDispatches.jsx:224` | "Updates to share" |
| dispatch | "Dispatches" (Settings card) / "Dispatch Settings" (page title) | `AdminSettingsHome.jsx:76`, `AdminDispatchSettings.jsx:82` | "Sending updates" (one name for both) |
| dispatch | "GroupMe dispatch", "WhatsApp dispatch" (feature names) | `features.js:118,126` | "Post updates to GroupMe", "Post updates to WhatsApp" |
| dispatch | "Email Dispatch" (My Account card) | `AccountSettings.jsx:264` | "Email updates" |
| dispatch | "Email Dispatch Customization" | `AdminDispatchSettings.jsx:198` | "How the update email looks" |
| dispatch | "Dispatches needing approval" (bell) | `categories.js:377` | "Updates waiting for your OK" |
| dispatch | "Dispatch send failures" (bell) | `categories.js:570` | "Updates that didn't send" |
| dispatch | "Approving marks this reviewed and eligible to send to any enabled dispatch channel" | `ApproveRestrictedTextConfirmBody.jsx:10` | "Approving lets this be sent to your team by email and chat" |
| held for approval | Not found on screen. The idea appears as "Recorded, subject to review" / "Never recorded" | `AdminDispatchSettings.jsx:144` | "Sent after someone approves it" / "Never sent" |
| cadence | "Digest cadence" | `AccountSettings.jsx:283` | "How often" |
| cadence | "e.g. Your {cadence} Update -- {month} {year}" | `AdminDispatchSettings.jsx:244` | Keep the placeholder but list it as "{how often}" |
| tier | "Which tiers to offer at all (#209). Turning a tier off moves anyone currently on it to the first tier still enabled... a one-time move, not reversible by re-enabling the tier later." | `AdminDispatchSettings.jsx:313-315` | "Choose which options people can pick. If you remove one, people on it move to the next one." (and delete "#209") |
| tier | "Not set -- these tiers won't send"; "Time (shared by all three tiers)" | `AdminDispatchSettings.jsx:369,378` | "Not set: monthly and quarterly emails won't send"; "Time of day" |
| digest | "Public prayer digest" | `features.js:135` | "Prayer updates by email for anyone" |
| digest | "No automatic digest" | `AccountSettings.jsx:220` | "Don't email me updates" |
| digest | "Earlier heads-ups ride in each person's email digest, once each." | `AdminSettingsPartnerCare.jsx:234` | "Earlier reminders are included in each person's regular update email." |
| mutes | "the chat channels' own content-type mutes, the restricted-partner safety gate" | `AdminDispatchSettings.jsx:92-93` | "what gets posted to chat, and the rules for restricted partners" |
| mutes | "Muted: None" (shown above three ticked boxes) | `AdminDispatchSettings.jsx:413-421` | "Posting: prayer requests, needs, newsletters" |
| channel | "these are near-real-time, chat-style channels" | `AdminDispatchSettings.jsx:438` | "Chat posts go out once a day at this time." |
| worker | "Every schedule on this page only fires from the separate background worker process, not the main site" | `AdminDispatchSettings.jsx:98` | "Scheduled sending needs the app's second service to be running. Ask whoever hosts the app if you're not sure." |
| restricted | "Restricted-access location" (tick-box) | `AdminPartnerForm.jsx:187` | "Sensitive location: hide name and exact place" |
| restricted | "Restricted partners" (as a tick-box label meaning "allow sending about them") | `AdminDispatchSettings.jsx:160-169` | "Allow updates about partners in sensitive locations (each one needs approval first)" |
| grant | Not found on screen | | |
| seat | Not found on screen (code only: "care team seat") | | |
| guest | "Guest (only the trips you choose)" | `AdminUserForm.jsx:139` | "Helper (sees only the trips or partners you choose)" |
| requirement | "Overdue trip requirements" (bell); "Requirements" (trip tab) | `categories.js:496`, `TripDetailLayout.jsx:90` | "Overdue trip to-dos"; "To-do list". The participant emails already say "checklist" (`tripEmails.js:216`), so the admin side can match |
| requirement | "Question library, requirement templates, and budgeting." | `AdminSettingsHome.jsx:36` | "Application questions, the standard to-do list, and budgets." |
| template pack | "Import a template pack"; "Couldn't read that pack" | `TemplatePackButtons.jsx:81,50` | "Import settings from a file"; "Couldn't read that file" |
| inbound / outbound | "Inbound email errors" (bell) | `categories.js:421` | "Emails that couldn't be read" |
| inbound / outbound | "Turn on outbound email and finish setting it up first (Settings → Email)" | `backend/src/utils/passwordless.js:61` | "Set up sending email first (Settings, Email)" |
| inbound / outbound | "Outbound email is off, so share this setup link with them directly instead:" | `AdminUserForm.jsx:281-282` | "The app can't send email yet, so send them this link yourself:" |
| webhook | "Webhook Username", "Webhook Password", "set the Inbound webhook URL to the address shown below... Postmark sends them as HTTP Basic Auth on every request" | `AdminSettingsEmail.jsx:219-244` | Cannot be made plain by wording alone. Mark the whole card "Advanced: ask whoever set up your email" and link the guide |
| Postmark | "Sending and receiving email through Postmark." | `AdminSettingsHome.jsx:60` | "Connect an email service so the app can send email." |
| Postmark / DNS | "verify a sending domain (adds SPF/DKIM records to your domain's DNS), then copy the Server API Token from your server's API Tokens tab" | `AdminSettingsEmail.jsx:143-147` | "Postmark will ask you to prove you own your church's web address. Whoever manages your website can do this. Then copy the key Postmark gives you and paste it here." |
| SPF/DKIM | "...or the sender couldn't be verified (SPF/DKIM)" | `AdminInboundEmailQueue.jsx:165` | "...or we couldn't confirm who really sent it" |
| API key | "API keys for AI request scanning and Joshua Project stats." | `AdminSettingsHome.jsx:84` | "Connect outside services (optional)." Keep "API key" as the field label, since that is the word on the other site |
| token | "1. Access Token... Get a personal access token at dev.groupme.com" | `AdminSettingsGroupMe.jsx:241-246` | "1. Connect your GroupMe account. GroupMe calls the code you need an 'access token'." |
| model | "Anthropic model id to use for scanning, e.g. claude-opus-5." | `AdminSettingsIntegrations.jsx:46` | Remove the field from the screen (owner's decision), or mark it "Advanced" |
| MFA | "Admin account missing MFA" (bell); "MFA" (column); "Reset MFA" (button) | `categories.js:550`, `AdminUsers.jsx:347,510` | "An admin has no sign-in code set up"; "Sign-in code"; "Reset sign-in code" |
| two-factor | "Two-factor sign-in" / "Two-Factor Authentication" / "Require two-factor authentication at first sign-in" | `AdminUsers.jsx:406`, `AccountSettings.jsx:594`, `AdminUserForm.jsx:240` | One phrase everywhere. "Two-step sign-in" with "sign-in code" for the six digits |
| passkey | "A passkey is your fingerprint, face or screen lock (or a security key) used as the second step at login." | `AccountSettings.jsx:437` | Already plain. Keep |
| passwordless | "Passwordless sign-in... On: no passwords" | `AdminUsers.jsx:453-458` | "Sign in without a password (fingerprint, face, or an emailed link)" |
| audit log | "Audit log" | `features.js:196`, `AdminSettingsHome.jsx:22` | "Activity history" |
| retention | "Retention... entries held now." | `AdminSettingsAudit.jsx:130-146` | "How long to keep history... entries kept now." |
| booklet | "Print Booklet"; "The printable prayer & support directory generator." | `AdminSidebar.jsx:179`, `features.js:87` | Understandable. Suggest "Printable prayer booklet" for the description |
| furlough | "Furlough", "On Furlough", "No furlough history on file." | `AdminPartnerDetail.jsx:755,1457,1479` | Known to missions people, not to every volunteer. "Home assignment (furlough)" on first use |
| sending party | Not found on screen. Shown as "Sending Church", "Sending Org", "Sending Church / Org" | `AdminPartnerDetail.jsx:1266-1267`, `AdminBooklet.jsx:135` | "Sending Org" becomes "Sending organization" |
| extraction | Not found on screen. Shown as "AI Features", "AI request scanning", "Scan for requests" | `features.js:203`, `AdminSettingsHome.jsx:84`, `AdminPartnerFiles.jsx:306` | Pick one: "Find requests in newsletters (AI)" |
| FIPS | "The Country Code (FIPS) field on Serving Location only appears once this is on..." | `features.js:216` | "Each partner needs a country code for this to work. Open the partner and re-enter the country to fill it in." |
| instance | "This is a fresh instance with no admin account yet."; "Configuration for this church's instance of the app." | `Setup.jsx:61`, `AdminSettingsHome.jsx:102` | "Nobody has set this up yet. Create the first account below."; "Settings for your church." |
| Postgres | "confirm your Postgres provider's backup/retention settings" | `BackupReminder.jsx:11` | "This app doesn't back itself up. Download a safety copy now, or ask whoever hosts it to confirm backups are on." |
| SESSION_SECRET | "if one is ever exposed, rotate SESSION_SECRET (see ADMIN_GUIDE.md)" | `AdminSystemInfo.jsx:144` | "If this file ever gets out, tell whoever hosts the app straight away." |
| Features | "Turn it back on at Church Settings › Features" | `RequireAdminFeature.jsx:19` | "Turn it on under Settings, Enabled Features" (the real menu names) |
| private-instance | "Turning this off shows a private-instance message there instead." | `features.js:21,28` | "When off, visitors see a short 'this isn't public' page." |
| (typo) | "add an My partners view" | `features.js:154` | "add a My partners view" |
| (stale) | "On its own, this already lets any admin/editor/viewer set up their own digest... -- no separate toggle for that." | `features.js:105` | "Lets the app send email. People choose their own update emails under My Account." |

## Reference A: every switch, with a recommendation

Recommendation is exactly one of: default on / default off / merge / hide until needed / remove. Every "remove" is a decision for the owner.

### A1. Registry switches (23). Source: `backend/src/utils/features.js:17-221`

"Group" is the card on Enabled Features: Public Site (3), Admin Features (13), Communications (5), Integrations (2), from `AdminSettingsFeatures.jsx:182-185`.

| # | Key | Label on screen | Default | Group | `requires` | `setupNeeds` | "Without email" note | Recommendation | Reason |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `publicDirectory` | Public directory | On | Public Site | | | | default off | Private until the church chooses (C3) |
| 2 | `publicMap` | Public map | On | Public Site | | | | merge | Same list, another view; one "Public site" switch |
| 3 | `publicTripDiscovery` | Public trip discovery | Off | Public Site | trips | | | merge | Fold into a per-trip "who can apply" choice with private links |
| 4 | `partnerFiles` | Newsletters & Docs | On | Admin | | | New newsletters wait on Pending Dispatches... | default on | Core |
| 5 | `prayerRequests` | Prayer requests | On | Admin | | | New requests wait on Pending Dispatches... | default on | Core |
| 6 | `oneTimeNeeds` | One-time needs | On | Admin | | | New needs wait on Pending Dispatches... | default on | Core |
| 7 | `monthlySupport` | Monthly support | On | Admin | | | | merge | A section of the partner page and Reports, not a feature (C15) |
| 8 | `trips` | Mission trips | Off | Admin | | | You are handed each link and its wording to copy... | default off | Large; only for churches that run trips |
| 9 | `booklet` | Print booklet | On | Admin | | | | default on | Core, no setup |
| 10 | `reports` | Reports | On | Admin | | | Scheduled report emails aren't sent... | default on | Core, no setup |
| 11 | `contactLog` | Contact log | Off | Admin | | | | merge | One "Partner care" switch with 12 and 13 |
| 12 | `keyDates` | Key-date reminders | Off | Admin | | | My partners shows what the daily email would have said... | merge | Same |
| 13 | `careTeam` | Care teams | Off | Admin | | | | merge | Same; assigning a team to a partner is the opt-in |
| 14 | `supportPreferences` | Support preferences | Off | Admin | | | | default off | Niche; fine as an extra |
| 15 | `surveys` | Partner surveys | Off | Admin | | | Sending a survey gives you each partner's link to copy | default off | Niche; fine as an extra |
| 16 | `auditTrail` | Audit log | On | Admin | | | | default on | Always on; take the switch off the page |
| 17 | `outboundEmail` | Email (Sending) | Off | Communications | | | | merge | On when a mail account is connected (C1, C6) |
| 18 | `inboundEmail` | Email (Receiving) | Off | Communications | | | | hide until needed | Advanced; only after sending works |
| 19 | `groupme` | GroupMe dispatch | Off | Communications | | | | hide until needed | On when connected |
| 20 | `whatsapp` | WhatsApp dispatch | Off | Communications | | | | remove (decision for the owner) | Unofficial link that can get a number banned, needs a spare phone number and the worker open all day |
| 21 | `publicPrayerDigest` | Public prayer digest | Off | Communications | publicDirectory | outboundEmail | Can't be turned on: it needs working email... | hide until needed | Show only when the public site is on and email works |
| 22 | `aiExtraction` | AI Features | Off | Integrations | partnerFiles | | | hide until needed | On when a key is saved |
| 23 | `joshuaProject` | Joshua Project stats | Off | Integrations | | | | hide until needed | On when a key is saved |

Result if adopted: about 9 visible choices (Public site, Trips, Partner care, Support preferences, Surveys, and connections for Email, GroupMe, AI, Joshua Project), with the core always on.

### A2. Church-wide switches outside the registry (22 shown, 1 internal). Source: `backend/prisma/schema.prisma`

| # | Field (line) | Where it is on screen, and the label | Default | Recommendation | Reason |
|---|---|---|---|---|---|
| 1 | `usePartnerTermInAdmin` (1235) | About & Branding, Partner Terminology | Off | merge | If a church sets its own word, use it everywhere |
| 2 | `backupReminderDisabled` (1340) | About App, "We have backups covered through another method — stop reminding us" | Off | default off | Keep; reword (C11) |
| 3 | `requireTwoFactor` (1350) | Manage Users, "Two-factor sign-in" | Off in the database, set **on** by setup | default on | Keep |
| 4 | `allowPasskeySignIn` (1367) | Manage Users, "Show 'Sign in with a passkey' on the sign-in page" | Off | merge | Show the button whenever any account has a passkey |
| 5 | `requirePasswordless` (1362) | Manage Users, "Passwordless sign-in" | Off | hide until needed | Advanced |
| 6 | `chatDispatchPrayerRequests` (1397) | Dispatches, chat schedule, "Prayer Requests" | On | merge | Picking a topic for a type already says "post these" |
| 7 | `chatDispatchOneTimeNeeds` (1398) | same, "One-Time Needs" | On | merge | Same |
| 8 | `chatDispatchNewsletters` (1399) | same, "Newsletters" | On | merge | Same |
| 9 | `chatDispatchKeyDates` (1403) | same, "Key dates coming up (needs Key-date reminders on)" | Off | merge | One "partner care reminders" choice, made by picking its topic |
| 10 | `chatDispatchQuietPartners` (1404) | same, "Partners nobody has heard from (needs Contact log on)" | Off | merge | Same |
| 11 | `chatDispatchUpdatesToPass` (1405) | same, "News to pass on to a partner (needs Contact log on)" | Off | merge | Same |
| 12 | `allowRestrictedPartnerDispatch` (1410) | Dispatches, Restricted Partners, tick-box labelled only "Restricted partners" | Off | default off | Keep; move to an always-visible page and relabel (C4) |
| 13 | `restrictedPartnerInitialsEnabled` (1416) | Dispatches, "Show initials for restricted partners" | On | default off | Safer default; owner's call (C4) |
| 14 | `cadenceBiweeklyEnabled` (1450) | Dispatches, Email Schedule, "Biweekly" | Off | merge | One church-wide "how often" |
| 15 | `cadenceMonthlyEnabled` (1451) | same, "Monthly" | On | merge | Same |
| 16 | `cadenceQuarterlyEnabled` (1452) | same, "Quarterly" | On | merge | Same |
| 17 | `collectDonorContactInfo` (1459) | Trips, Giving & Budget, "Collect donor email/phone when logging a contribution" | Off | default off | Keep |
| 18 | `enableTripBudgeting` (1476) | Trips, "Track a planned budget per trip" | Off | hide until needed | Offer on the trip's money page |
| 19 | `collectApplicantAddress` (1463) | Trips, Applicant Information Collected | On | default on | Keep |
| 20 | `collectEmergencyContact` (1467) | Trips, same card | On | default on | Keep |
| 21 | `allowPrivateApplicationLinks` (1471) | Trips, Access & Links, "Allow staff to generate private application links" | Off | merge | On with Trips; otherwise nobody can apply (C7) |
| 22 | `allowPublicSupportRaisingLinks` (1473) | Trips, "Allow participants to have public support-raising pages" | Off | default off | Keep; show the reason on the participant page |
| | `demoMode` (1355) | Not shown; written by the demo reset | Off | (internal) | |

Also met as second copies: "Enabled" on the Email page's Sending card and Receiving card, which write registry switches 17 and 18 (`settingsEmail.js:103-114`). Recommendation: merge.

### A3. Per-person switches and choices. Source: `schema.prisma:1506-1582`

| Field (line) | Where, and label | Default | Recommendation | Reason |
|---|---|---|---|---|
| `active` (1519) | Manage Users, Edit User | On | default on | Keep |
| `mfaEnabled` (1537) | My Account, "Two-Factor Authentication" | Off; forced on while the church requires it | default on | Keep |
| `mfaSetupRequired` (1544) | Add User, "Require two-factor authentication at first sign-in" | Off | hide until needed | Meaningless while required for everyone |
| `keyDateEmailOptOut` (1547) | My Account, "Email me about coming birthdays and anniversaries for my partners" | Emails on | default on | Keep |
| `onMissionsTeam` (1552) | Add/Edit User and Partner Care, "On the Missions team (looks after partners that have no care team)" | Off | hide until needed | Show only with partner care on; first admin should start on it |
| `cadence` (1560) | My Account, "Digest cadence": none / Biweekly / Monthly / Quarterly | None | merge | Follow the church's one "how often"; person chooses on or off |
| `digestScope` (1564) | My Account, "What the digest covers": partners I look after / all / only ones I pick | all | hide until needed | Offer after the person is getting the email |

Not counted above: about 25 yes/no fields on individual records that a person meets while entering data (for example a partner's "Show on public site", "Restricted-access location" and "Sent by our church"; a prayer request's public, booklet and urgent ticks; a trip's "public" tick). They are part of the 55 in the at-a-glance table. Only the first two matter for this review, and both are in C3 and the jargon list.

## Reference B: Settings pages and cards

Sources: Settings home cards `AdminSettingsHome.jsx:5-93`; menu `AdminSidebar.jsx:183-221`; routes `main.jsx:309-398`. "Inputs" are single values a person can change, counted from each page's form fields; treat them as close, not exact.

| # | Card (route under `/admin/settings`) | Shown when | Sections on the page | Inputs | Recommendation | Reason |
|---|---|---|---|---|---|---|
| 1 | About & Branding (`about`) | always | 4: Church Info, Public Site & Branding, Logo, Partner Terminology | 23 | default on | Ask the top three in first-run |
| 2 | Manage Users (`users`, `users/new`) | always | Users table; 3 sign-in cards; Add User (2 or 3 steps, 10 fields) | 3 church-wide + per person | default on | Simplify sign-in cards (C13) |
| 3 | Audit log (`audit`) | Audit log on | 2: Retention, Log | 1 | hide until needed | Link from About App |
| 4 | Enabled Features (`features`) | always | 4 cards, 23 switches | 23 | default on | Cut to about 9 (A1) |
| 5 | Trips (`trips`) | Trips on | 4 groups, 7 cards: Giving & Budget; Application Questions; Saved Question Library; Applicant Information Collected; Trip Requirements; Saved Requirement Library; Access & Links | 8 + 4 list editors | hide until needed | Already so; trim per A2 |
| 6 | Partner Care (`partner-care`) | Care teams, Key dates or Contact log on | 4: Who looks after partners; Email digest for new members; Timing; Key-date reminders (status only) | 6 | hide until needed | Already so; make it where the feature is turned on |
| 7 | Support Preferences (`support-preferences`, `/print`) | feature on | 1 menu editor | list editor | hide until needed | Already so |
| 8 | Surveys (`surveys`, `surveys/:id`) | feature on | List; per survey: Details, Questions, Send, Answers | list editor | merge | This is day-to-day work, not a setting; move to the main menu beside Survey Updates |
| 9 | Email (`email`) | either email switch on | 2: Sending, Receiving | 7 | merge | Into one "Email updates" page with schedule and look (C1) |
| 10 | GroupMe (`groupme`) | GroupMe on | 3: Access Token, Group, Topics | about 6 | merge | One "Connections" card |
| 11 | WhatsApp (`whatsapp`) | WhatsApp on | 3: Link the number, Community, Groups | about 6 | remove (decision for the owner) | With the feature |
| 12 | Dispatches (`dispatches`) | Email, GroupMe or WhatsApp on | up to 5: Email Dispatch Subscribers (counts); Restricted Partners; Email Dispatch Customization; Email Schedule; chat Schedule | 18 | merge | Split between "Email updates", the chat connection page, and an always-visible restricted-partners card |
| 13 | Integrations (`integrations`) | AI or Joshua Project on | 2: AI Features, Joshua Project | 3 | merge | One "Connections" card, always reachable (C6) |
| 14 | About App (`system-info`) | always | 4 info blocks; Back up now; Already Backed Up Another Way? | 1 | default on | Rename "Backups & version"; drop the library version list |

Totals: default install 5 cards, about 51 inputs (23 + 3 + 1 + 23 + 1). Everything on: 14 cards, about 105 inputs plus 6 list editors. My Account (`/admin/account`) adds up to 7 cards per person: Your details, Change Password, Two-Factor Authentication, Passkeys, Key-date email, Email Dispatch, Appearance.

If the recommendations were adopted: 7 cards at most (About your church, People, Features, Email updates, Connections, Partner care, Backups & version), with Trips settings reached from Trips.

## Reference C: bell alert types (20). Source: `backend/src/notifications/categories.js:374-588`

"Gate" is what must be on for the count to be above zero; where the code has no check I say so. An admin-only alert has `adminOnly: true`. "Guest" means a trip leader or care team guest can see it.

| # | Key | Label as shown | Who sees it | Gate | Recommendation | Reason |
|---|---|---|---|---|---|---|
| 1 | `dispatchesNeedingApproval` | Dispatches needing approval | admin, editor, viewer | No feature check; needs restricted-partner sending allowed, or a care team member's entry | default on | Rename; fix the dead link (C5). A viewer sees it but cannot approve |
| 2 | `unmatchedEmails` | Unmatched emails | admin, editor, viewer | Email (Receiving) (rows only exist then) | merge | With 5: "Emails to sort" |
| 3 | `surveyUpdatesPending` | Survey updates to review | admin, editor | Partner surveys | merge | With 4: "Survey answers" |
| 4 | `newSurveyResponses` | New survey answers | all, guest for own partners | Partner surveys | merge | With 3 |
| 5 | `inboundEmailFailures` | Inbound email errors | admin, editor, viewer | Email (Receiving) | merge | With 2 |
| 6 | `partnersNeedingContact` | Partners to reach out to | whoever looks after them, incl. guest | Contact log | merge | With 7 and 16: "Partner care to-dos" |
| 7 | `keyDatesComing` | Key dates coming up | same | Key-date reminders | merge | Same |
| 8 | `tripsDepartingSoon` | Trips departing soon | all, guest for own trips | Trips (rows only) | remove (decision for the owner) | Information, not a task; 11 covers the case that needs action |
| 9 | `tripsReadyToWrapUp` | Trips ready to wrap up | same | Trips | default on | A real task |
| 10 | `tripsWrappedUp` | Trips wrapped up | care team members of that partner | Trips and Care teams | merge | Into the partner care to-dos |
| 11 | `tripsDepartingSoonIncomplete` | Trips departing soon, incomplete | all, guest for own trips | Trips | merge | With 12: "Trip to-dos not done" |
| 12 | `overdueTripRequirements` | Overdue trip requirements | same | Trips | merge | With 11 |
| 13 | `tripApplicationsPending` | Trip applications pending review | same | Trips | default on | A real task; "Trip applications to review" |
| 14 | `newPrayerRequests` | New prayer requests | all, guest for own partners | none (always counts) | merge | With 15: "New from partners" |
| 15 | `newOneTimeNeeds` | New one-time needs | same | none | merge | With 14 |
| 16 | `updatesToPassOn` | Updates to pass on to partners | whoever looks after them | Contact log | merge | With 6 and 7 |
| 17 | `adminMfaDisabled` | Admin account missing MFA | admin | none; cannot fire while two-factor is required | hide until needed | Only when the requirement is off; plain name |
| 18 | `timeToCheckBackups` | Time to check your backups | admin | fires at once, then every 30 days, unless switched off | hide until needed | Not on day one (C11) |
| 19 | `dispatchSendFailures` | Dispatch send failures | admin | a channel on | merge | With 20: "Something didn't send" |
| 20 | `whatsappConnectionDrop` | WhatsApp connection dropped | admin | WhatsApp paired | merge | With 19 |

Result if adopted: 9 alert types.

## Reference D: scheduled jobs (8 timers). Source: `backend/src/worker.js:42-48`

`backend/src/server.js` starts none (`server.js:270`). All times are church-local and depend on the time zone setting and a restart after changing it (`worker.js:26-39`). None runs on a public demo.

| # | Timer (file:line) | When | What it does and sends | To whom | Controlled by | Recommendation | Reason |
|---|---|---|---|---|---|---|---|
| 1 | `email-dispatch` (`emailDispatchScheduler.js:176`) | Checks every minute; sends in the hour and on the day set on Dispatches. Three frequencies share it: biweekly, monthly, quarterly | The update email: new prayer requests, needs, newsletters, key-date heads-ups | Logins who chose a frequency; confirmed public subscribers (prayer requests only) | Email (Sending); day and hour (empty by default); each person's choice; Public prayer digest for the public half | default on | Give it a default day and time (C1) |
| 2 | `chat-dispatch` (`:180`) | Checks every minute; posts once a day at the chat hour. Also keeps the WhatsApp link alive | The same items to GroupMe topics and WhatsApp groups | Whoever is in those groups | GroupMe / WhatsApp; chat hour (empty by default); six content tick-boxes | default on | Default hour; fewer tick-boxes (A2) |
| 3 | `trip-meeting-reminders` (`tripReminderScheduler.js:129`) | Hourly | "Reminder: meeting tomorrow" email with a calendar file | Trip participants | Trips + Email (Sending) | default on | Fine |
| 4 | `trip-requirement-reminders` (`:133`) | Hourly | "Reminder: ... due soon" email | Participants who have not done the item | Trips + Email (Sending); per-item lead days | merge | With 3: one "trip reminders" job |
| 5 | `key-date-reminders` (`keyDateReminderScheduler.js:101`) | Daily 7:00 | One email on days a birthday, anniversary or milestone is near | Care team, else missions team; not people who opted out | Key-date reminders + Email (Sending); lead days | default on | Fine once someone is on the team (C7) |
| 6 | `care-chat-dispatch` (`careChatDispatch.js:161`) | Daily 5:00 | Queues chat posts: key dates, quiet partners (5 a day at most), news to pass on | Chat groups, via job 2 | GroupMe or WhatsApp; three tick-boxes; Key dates / Contact log | merge | Part of job 2 from the user's side |
| 7 | `report-emails` (`reportScheduler.js:117`) | Hourly check, acts at 7:00 | Saved reports with a CSV attached | People chosen on the saved report | Reports + Email (Sending); each saved schedule | default on | Fine |
| 8 | audit prune (`auditPruneScheduler.js:7`) | Daily 3:30 | Deletes history older than 30/60/90 days. Sends nothing | | Retention setting; runs even with the Audit log switch off | default on | Fine |
| | WhatsApp connection (`worker.js:51-57`) | Always open | Holds the linked phone session | | WhatsApp | remove (decision for the owner) | With the feature |

## Reference E: emails the app can send (19 kinds)

Sources: `utils/email.js` and its callers. All need Email (Sending) on and a Postmark account. Where email is off the app usually hands the admin a link to copy instead (`utils/emailSenders.js`).

| # | Email (subject or name) | Trigger | Recipient | Code | Recommendation | Reason |
|---|---|---|---|---|---|---|
| 1 | "Set up your ... missions tracker account" | Admin adds a user or re-sends | The new user | `welcomeEmails.js:77-99` | default on | Core |
| 2 | "Reset your ... password" | Forgot password | That user | `welcomeEmails.js:127-144` | default on | Core |
| 3 | "Your sign-in link for ..." | Sign-in while passwordless is on | That user | `passwordless.js:108-130` | hide until needed | With passwordless |
| 4 | "Test email from missions-partner-tracker" | Send Test Email button | The admin | `settingsEmail.js:132-140` | default on | Use the church's name in the subject |
| 5 | Team update email (the "digest") | Job 1 | Logins who opted in | `emailDispatchDelivery.js:189-248` | default on | The main reason to connect email |
| 6 | Public prayer update email | Job 1 | Confirmed public subscribers | same | hide until needed | With the public digest |
| 7 | Urgent update, sent at once | Someone ticks "urgent" on a request or need | Both audiences above | `dispatchOrchestrator.js` (`sendUrgentDispatch`) | default on | Keep |
| 8 | "Confirm your prayer update subscription" | Public sign-up | The subscriber | `publicSubscribeEmails.js:6-18` | hide until needed | With 6 |
| 9 | "Confirm this change to your prayer update subscription" | Subscriber changes choices | The subscriber | `:20-29` | merge | With 8 |
| 10 | "N key dates coming up for your partners" | Job 5 | Care team or missions team | `keyDateReminderScheduler.js:76-78` | default on | Keep |
| 11 | Saved report with CSV | Job 7 | People picked on the schedule | `reportScheduler.js:92-104` | default on | Keep |
| 12 | Survey link (and "Reminder: ...") | Staff press Send on a survey | The partner | `routes/surveys.js:423-433` | default on | Keep |
| 13 | "You're on the team: ..." | Application approved, or participant added | Participant | `routes/tripParticipants.js:153,232` | default on | Keep |
| 14 | "Your trip access link" | Admin re-sends, or participant asks for a lost link | Participant | `tripParticipants.js:368`; `tripAccessToken.js:79` | default on | Keep |
| 15 | "Meeting: ..." / "Meeting cancelled: ..." | Meeting created, changed or cancelled | All participants | `tripEmails.js:309-330` | default on | Keep |
| 16 | "Reminder: meeting tomorrow ..." | Job 3 | All participants | `tripReminderScheduler.js:39` | default on | Keep |
| 17 | "New item needed: ..." | A document or signature item is added | Participants | `tripEmails.js:212-227` | merge | With 19 into one "your to-do list changed" email |
| 18 | "Reminder: ... due soon ..." | Job 4 | Participants not yet done | `tripReminderScheduler.js:102` | default on | Keep |
| 19 | "Trip dates updated: ..." | Admin changes trip dates | Participants | `tripEmails.js:274-305` | merge | With 17 |

Trips account for 7 of the 19. Someone joining a trip late can receive 13, then one 15 per future meeting and one 17 per open item, in a row (`tripEmails.js:249-268`).

## Reference F: roles and role-like states

| State | Stored as | Words on screen | What it changes | Recommendation | Reason |
|---|---|---|---|---|---|
| Admin | `User.role = "admin"` (`schema.prisma:1516`) | "Admin" in the form; "admin" in the Users table | Everything, including Settings | default on | Keep |
| Editor | `role = "editor"` (the default for a new user) | "Editor" / "editor" | Add and change records; no Settings | default on | Keep; explain on the form (C12) |
| Viewer | `role = "viewer"` | "Viewer" / "viewer" | Read only; still sees approval alerts | remove (decision for the owner) | A team of two to five rarely needs it |
| Guest: trip leader | `role = "guest"` + a `TripAccess` row with optional end date (`:1604-1615`) | "Guest (only the trips you choose)"; "Give guest access"; "Trip leader access" | Sees only chosen trips and their partner | hide until needed | Offer only when Trips is on |
| Guest: care team | `role = "guest"` + a `CareTeamMember` row (`:1647-1662`) | "Member · Guest"; "Care team: (partner)" | Sees only chosen partners; what they enter waits for staff approval | hide until needed | Offer only with partner care on |
| Care team Lead | `CareTeamMember.isLead` (`:1653`) | "Lead" | One per partner; marker only | merge | "Everyone on the team is notified the same way" (`CareTeamPanel.jsx:287`), so Lead and Member differ in name only |
| Care team Member | a `CareTeamMember` row | "Member" | Gets that partner's reminders | default off | Keep with partner care |
| On the missions team | `User.onMissionsTeam` (`:1552`); the group's name is a church setting (`:1421`) | "On the Missions team (looks after partners that have no care team)" | Gets reminders for every partner without a care team | hide until needed | First admin on it by default (C7) |
| Account state | `active`, password not yet set, grant ended | "Yes" / "No" / "Awaiting setup" / an ended-access label | Whether they can sign in | default on | Keep |

People the app deals with who have no login: trip applicants and participants (their own link), public email subscribers, and partners answering a survey (their own link).

## Reference G: menu entries for an admin

Source: `AdminSidebar.jsx:133-181` (main), `:183-221` (Settings sub-menu), `:327-437` (footer). Default column seen in the running app.

| Entry | Default install | Everything on | Shown when | Recommendation | Reason |
|---|---|---|---|---|---|
| Home | yes | yes | always | default on | |
| Partners | yes | yes | always | default on | |
| Newsletters & Docs | yes | yes | feature on | default on | |
| Prayer Requests | yes | yes | feature on | default on | |
| One-Time Needs | yes | yes | feature on | default on | |
| Trips | | yes | Trips on | hide until needed | |
| Pending Dispatches | | yes | Email, GroupMe or WhatsApp on | default on | Always there, renamed (C5) |
| Unmatched Email | | yes | Email (Receiving) on | hide until needed | |
| Survey Updates | | yes | Surveys on | merge | With a "Surveys" entry (Reference B, row 8) |
| Print Booklet | yes | yes | feature on | merge | A button on Reports or Partners would do |
| Reports | yes | yes | feature on | default on | |
| Settings | yes | yes | admin only | default on | |
| Settings sub-menu | 5 links | 14 links | inside Settings | merge | To about 7 (Reference B) |
| View Public Site | yes | yes | directory or map on | hide until needed | Only when the public site is on |
| My Account | yes | yes | always | default on | |
| Log out; light/dark toggle | yes | yes | always | default on | |

Count: 8 main entries by default, 12 with everything on. Three working pages have no menu entry: Monthly Support (C15), Contact Log (reached from a partner's page), and My partners (a view inside Partners).

## What I couldn't check, and why

- **No real sending.** No mail account, GroupMe token or WhatsApp number exists locally, and the brief forbids sending or forcing a schedule. Everything about what happens at send time (C1, C2, the jobs table) is read from the code.
- **The worker was not started** (not permitted for this review), so "nothing warns you when it is down" rests on the absence of any heartbeat in the code, not on watching it fail.
- **Render's behaviour.** Whether the worker service receives Render's address variable (last row of the dependency map) is inferred from Render's documentation as I remember it; I did not deploy.
- **Guest and non-admin views.** I signed in only as the first admin. The Guest, Editor and Viewer rows in Reference F, and the stuck-alert case in C5, are from the code.
- **The pre-ticked "Show on public site" box** (C3) is read from the form's starting values; I did not click through to step 3 and save a partner.
- **Input counts** (51 and 105) are counted from form fields in each page's source and are close, not exact. GroupMe and WhatsApp pickers were counted from the schema fields they fill, since they only render once connected.
- **Per-trip, per-survey and per-report settings** were not inventoried; they are choices made while doing the work, not church setup.
- **The 21 reports** on the Reports page and which features each needs were not listed.
- **Mobile layout** and whether help text is readable on a phone were not checked.
- **Issue #477 itself** was not re-read; the brief quoted it and asked for independent counts.
- The local test site (database `mpt_complexity`, port 4110) was created for this review and its server is stopped. Scratch files are in the scratchpad under `complexity/`.
