# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/): given a
version `MAJOR.MINOR.PATCH`, `MAJOR` marks breaking changes (a data
migration you must run, an env var that's now required, etc.), `MINOR`
marks new features that are safe to pull in without extra steps, and
`PATCH` marks fixes. Until 1.0 the project is on a beta track
(`0.1.0-beta.1`, `0.1.0-beta.2`, … toward each `0.MINOR.0`), described in
[CONTRIBUTING.md § Versioning](CONTRIBUTING.md#versioning-the-pre-10-beta-track).

If you maintain a fork, check this file when you pull in a new release —
see [UPGRADING.md](UPGRADING.md) for the actual update steps.

## [Unreleased]

### Changed

- **A survey's page follows what you are doing.** A draft shows Details, Questions, then Send. Once it is open it leads with Send and the Answers, with the long question list and details below; a closed survey leads with its Answers.
- **A public demo lets visitors try passkeys and an authenticator app ([#386](https://github.com/neckermann/missions-partner-tracker/issues/386)).** Adding or removing one works, but the demo never asks for a second factor at sign-in and doesn't end other visitors' sessions, so the shared logins keep working.

### Added

- **The demo shows the support-menu survey.** It seeds **How can we support you?** as an open survey with one partner's picks waiting on Survey Updates, and the admin guide gets a table of what each optional feature needs and what is lost when it is off.
- **Partners can answer the support menu themselves.** A **Support preferences** survey question shows your support menu (without staff-only or retired options) to the partner, on their link or when staff fill the survey in for them. Their picks wait on Survey Updates as one line per option that differs from what is on file; approving fills in just those options and keeps any staff note. Includes an example pack, **How can we support you?**.
- **A survey can ask for a mailing address.** A **Mailing address** question shows street, city, region, postal code and country boxes, and can be linked to the partner's record like a phone number: the answer waits on Survey Updates (you can edit the boxes before approving) and, once approved, becomes their mailing address.
- **Get a survey link without emailing it.** Each partner row in a survey's Send section has a **Get link** button that makes their personal link (replacing any earlier one) and shows it to copy or open, so you can text it to them, try the survey yourself, or test on a demo that never emails. Restricted and no-direct-contact partners get none.
- **The Contact Log no longer grows down a partner's page.** The card shows the latest three entries with **View all N logged contacts →**, which opens a new **Contact Log** page filtered to that partner (and filterable by type, direction and topic, paged). Guests only see partners on their care team.
- **Template packs: import and export instead of built-in defaults.** Starting points are now plain JSON files a church imports (and exports to share): survey questions, the support menu, trip requirement documents, trip application questions and email update wording. Examples live in `examples/template-packs/` (the app ships no church wording in code); import is additive and previews first. **A new install starts empty** in these areas with a prompt to import (existing installs keep what they have), and the demo imports the examples on reset. This replaces the built-in survey templates, the "Add an example set" button, and the default trip requirement documents applied at first-run setup.
- **Country, language and group suggestions work on phones.** The type-ahead fields use a suggestion list of their own instead of the browser's, which many phones don't show.
- **The partner page is grouped more clearly.** **Location & Contact** holds the addresses and links; a new **Care & Follow-up** group holds Support Preferences, Surveys, the Contact Log, Church Visits and Furlough; Communication keeps prayer requests, newsletters and "last prayed for". The Support Preferences card opens when you click its line (no separate View all), and a survey's recipient list has a search and **Select all who can be emailed**.
- **A "Getting to know you" survey example pack** (`examples/template-packs/survey-getting-to-know-you.json`) for restarting a relationship with partners: their story and work, how they keep in touch, challenges, highlights, hopes and how we can help. Import it from Settings → Surveys and edit it freely.
- **Staff-only support options.** An option can be marked **Staff only**: its answers are hidden from care team guests and can't be recorded by them (the example "what can and cannot be shared" starts this way).
- **Contacts can name a support option.** A logged contact can say which option it was about; the label is kept if the option is later retired or deleted.
- **Commissioning is a key date, and Supporting Since is now "Partnering Since".** Both sit together on the partner's page under Our History With Them (someone may have been commissioned long before we knew them); the anniversary of each appears on the bell, in the daily key-date email and on My partners. On the partner page, a card title links to the full page (no "View all" button), and rows, the Contact card, the Contact Log and the Care team open on click; Delete lives inside the edit popup.
- **Send a greeting.** A key date on My partners has a **Send greeting** button that opens a prefilled email draft (only where we may email); you send it yourself, and the app offers to log it as a Key date contact.
- **Survey Updates are grouped by partner** with Approve all / Reject all; a new **New survey answers** bell item tells staff and care teams when a partner answers, and **Survey updates to review** is shown only to admins and editors.
- **First columns are real links.** Lists whose rows open a page (Partners, Monthly Support, Trips, the trip team and applications, My partners, Surveys) now make the first cell a real link; the Trips list links to the trip, not the partner.
- **Survey templates and updating a partner's record from their answers.** Surveys can be imported from example packs (Care check-in, Annual update, Getting to know you, Furlough and visit planning). A question can be linked to a part of the partner's record (phone, email, preferred contact method, emergency contact, a one-line overview) or be a **Photo** question; when an answer differs from what is on file it waits on the new **Survey Updates** page (sidebar count and bell) for an admin or editor to **Approve**, **Edit** then approve, or **Reject**. Nothing is applied automatically, an approval is credited to the approver in "last edited by" and the audit log, and a partner's photo is held until approved.
- **Printable support menu.** Settings → Support Preferences has a **Print menu** button that opens a clean, branded copy of the current menu (retired options left out) to print or save as a PDF.
- **Last heard from counts prayer requests.** A prayer request received from a partner now counts as hearing from them, like a newsletter, a visit or a logged contact.
- **Partner surveys** (#419, off by default; needs Care teams). Build short surveys under Settings → Surveys, send each partner a personal link (a person starts every send, and the app never emails a restricted partner or one marked not to be contacted directly), or fill one in for them from their page. Answers show on the partner's page for staff and the care team only. Adds a Survey responses report. Profile refresh, bell alerts and scheduled reminders are not part of this first release.
- **Admin list pages open the same way.** Partners, Prayer Requests, One-Time Needs, Monthly Support, Newsletters & Docs, Pending Dispatches, Unmatched Emails and Trips now share one heading block (title, count line, main buttons on the right, short description); Monthly Support's total uses the same stat tile as Trips; the Users page spacing was fixed; and " -- " in page copy became a dash.
- **Support preferences take less room.** The card on a partner's page is one line (how many are recorded, and which groups) with **View all →** opening everything in a popup; it now looks and works like the Monthly Support and One-Time Needs cards.
- **No more silent key-date reminders.** Care Team Settings warns when no default lead is set, and a partner's care team line tells every staff member where reminders go until a team is set.
- **The top of a partner's page is shorter.** The care team is now one line on the Contact card ("Care team: Pat (lead), Casey", with Edit team or + Assign team), and Support preferences now sits at the bottom of the **Contact & Care** section (formerly Location & Contact), which has its own jump-bar button.
- **Visitors can choose Light or Dark on the public site** with a small switch in the header; it follows their device unless they pick one.
- **More records carry a created date ([#383](https://github.com/neckermann/missions-partner-tracker/issues/383)).** A partner's addresses and sending party, a trip's budget lines and flight segments, and application questions now record when they were added (trips and applications already did).
- **"Forgot your password?" on the sign-in page.** When the site can send email, anyone can ask for a link to choose a new password. The link works once and lasts an hour, a reset signs the account out everywhere else, and the reply is the same whether or not the address has an account (at most one email a minute per account). It reuses the setup-link machinery, so no database change. Not offered while email is off, on a demo, or with passwordless sign-in on.
- **The Contact card is where you edit how to reach a partner.** **Edit** on the card picks who to reach first (a list of the adults, or an organization's named contact) and how each person likes to be reached: a phone call, text, email, WhatsApp, Signal, Messenger or another way, shown highlighted as "Prefers Email". The card is shown even when the contact log is off.
- **Contacting a partner has three settings, not two.** The old safe / not-safe switch is now **Normal**, **Use caution** (their details stay under a warning with your guidelines, and you can limit the ways it is ok to reach them, so only those buttons show) and **Don't contact directly** (their number, email and buttons are hidden, replaced by who to go through, with that person's call and email buttons, and the guidelines). The printed booklet withholds details for **Don't contact directly**.

### Fixed

- **Linking a survey question to a part of the record from the builder now saves.** Saving a survey's questions kept the link only for questions that already had one (an imported pack), so a link chosen in the builder was dropped.
- **A demo no longer emails its seeded accounts on a schedule.** The daily key-date email (and any other scheduled email) was still going out from the demo, because the worker that runs the schedules never had the variable that marks a demo, so it bounced and spent the email plan. The demo reset now records that it is a demo in the database, every process reads it, and sending email is skipped on a demo as a whole.
- **A partner page no longer fails when a feature is switched off.** With Prayer Requests, Newsletters & Docs, Monthly support or One-time needs off, every partner page showed "This partner wasn't found", because it still asked for those lists. It now asks only for what is on. The Contact Log's "Updates to pass on" and newsletter lines also respect those switches, and a survey's Send section says so up front (and points to **Get link**) when Email (Sending) is off. A new test runs the app with every optional feature off.
- **A row that opens a record is clickable on its own, and looks it.** The duplicate Open (Partners), View (Trips) and View details (trip team) buttons are gone; clickable rows show a pointer, a link-coloured first cell, and a focus ring, and open with Enter or Space.
- **Dark mode is readable on every page ([#418](https://github.com/neckermann/missions-partner-tracker/issues/418)).** Many pages used hardcoded greys and whites that ignored the theme, so headings, help text, table cells and tabs were nearly invisible in dark mode. They now use the theme colours, and a new check (`frontend/e2e/contrast.spec.js`) fails the build if text on a public or admin page drops below a readable contrast in either theme.
- **Text no longer turns unreadable after you visit Print Booklet.** The booklet's stylesheet set a dark text colour on the whole page and stayed loaded when you moved on, so the next page was dark-on-dark until a refresh. It is now scoped to the booklet itself.
- **Action buttons in tables no longer wrap onto two lines** and come out different sizes; Delete, Retire and the like stay the same height as their neighbours.
- **One tab bar for Trips, a trip's own pages and Partners**, with the same look in both themes. The active Trips tab was nearly invisible in dark mode.
- **Cards placed one after another on a page (Reports, Care Team Settings, GroupMe, WhatsApp, the top of a partner page) now have space between them.**
- **Counts look the same everywhere.** The Trips list and the email subscriber summary now use the same count tiles as the reports.
- **The Audit log uses the same filter bar as the other lists** (search, plus What / From / To under "+ Add filter"), and its filters stay in the address.
- **Enabled Features lists what is in each group**, with each feature's on or off state, instead of only "All on".
- **Log Contributions is a popup**, like other forms, with **Save** and **Save and add another** (which keeps the trip, team member, method and date for the next check).
- **Support Preferences:** Delete is red, and every group's table lines up. **WhatsApp's warning is a proper box.**

### Upgrading

- **A database that ran `0.1.0-beta.2` must be reset again (pre-1.0).** The single baseline migration (`20261122092854_init`) gained a `createdAt` column on `Address`, `SendingParty`, `TripBudgetLine`, `TripFlightSegment` and `ApplicationQuestion`, and the contact changes: `Partner.contactSafe` and `Partner.preferredContactMethod` are gone, replaced by `Partner.contactLevel`, `contactChannels`, `contactViaName`/`Role`/`Phone`/`Email` and (for an organization) `contactMethod`/`contactMethodNote`, with `contactMethod`/`contactMethodNote` on each `Adult`. There is nothing to carry across before 1.0, and `npx prisma migrate deploy` against a database that already ran the baseline will not apply it. Reset the database (`npx prisma migrate reset`), or reset a demo through its reset job.

## [0.1.0-beta.2] - 2026-11-25

### Security

- **Smaller hardening items from the security review ([#412](https://github.com/neckermann/missions-partner-tracker/issues/412)).** Ids in a trip's child records must belong to that trip (a guest on one trip could attach, overwrite or read another trip's people and requirements through document uploads, flight segments and contributions). The emailed sign-in link is sent at most once a minute per account, so nobody can mail-bomb a person or keep replacing their live link, and only real accounts are audited. A prayer request or need's source file must be the same partner's file. Only staff can log a contact as someone else; a care team guest's entry is always their own. A passkey challenge is accepted once through the database (`SpentPasskeyChallenge`), so that holds across restarts and more than one instance. In production, passkeys need `APP_BASE_URL` (or Render's own URL) and refuse to run without it, rather than trusting the request's Host header.

- **A guest can no longer subscribe to the church-wide email digest, and no longer receives it ([#407](https://github.com/neckermann/missions-partner-tracker/issues/407)).** `PUT /api/auth/dispatch-by-email` now refuses a guest, and both the scheduled digest and the urgent dispatch go only to admins, editors and viewers (they carry every partner's prayer requests, needs and amounts). A care team guest still gets the key-date email, which is built from their own partners.
- **Passkey enrolment ([#408](https://github.com/neckermann/missions-partner-tracker/issues/408)):** a forced-enrolment setup token is refused once the account has enrolled, the first passkey ends sessions opened before it (the tab that added it stays signed in), and removing a passkey, which asks for the password, is rate limited.
- **A care team seat sees a trip's names and dates only ([#409](https://github.com/neckermann/missions-partner-tracker/issues/409)).** A guest who can read a trip only because they sit on its partner's care team now gets the trip's name, type, status, dates and who is on the team, and no longer its private apply-link and share tokens, participants' contact details and dates of birth, applications (declined ones included), documents, contributions, budget, flights, requirements or meetings. The applications list and document downloads are refused to them. A trip leader with a grant and the full roles are unchanged.
- **The printed booklet withholds more for a partner who isn't safe to contact ([#411](https://github.com/neckermann/missions-partner-tracker/issues/411)):** their serving and mailing addresses, and their sending church or organization's contact person and phone, no longer print (the names still do). The restricted-access toggle is unchanged: including restricted partners remains a deliberate staff choice.

### Upgrading

- **A database that ran `0.1.0-beta.1` must be reset again (pre-1.0).** The single baseline migration (`20261122092854_init`) gained the `SpentPasskeyChallenge` table, so `npx prisma migrate deploy` against a beta.1 database reads the baseline as already applied and does not add it. Reset with the same steps and data-loss warning as before: `npx prisma migrate reset --force` from `backend/` (**erases all data**; back up first and re-create the admin with `node prisma/createAdmin.js`), or `npm run demo:reset:remote` / `npm run dev:reset:remote` for the demo and dev-test sites.

## [0.1.0-beta.1] - 2026-11-25

### Added

- **One church-wide two-factor requirement ([#385](https://github.com/neckermann/missions-partner-tracker/issues/385)).** Manage Users has a **Two-factor sign-in** panel: **Require it for everyone** makes every account, whatever its role, set up two-factor. It shows how many active accounts haven't yet. While it's on, an account that hasn't set it up is sent to enrolment at sign-in and gets no session until it does; a session open when you turn it on stops working at the next request (the person is taken back to sign-in, where they enrol); and nobody can switch it off for themselves. Turning it on needs the admin doing it to have enrolled first (so it can't lock them out) and is refused on the public demo, and a demo ignores it entirely (its reset switches it off, so a first-run `/setup` can't leave visitors locked out). A fresh install (first-run `/setup`) starts with it **on**: the first admin creates the account, signs in once and sets up an authenticator app. It is off on an install that predates it, and `createAdmin.js` leaves it off. Changes are in the Audit log. A 401 on an admin page now sends the person to sign in (their place remembered) instead of leaving the page showing errors, which also covers an expired session.
- **A trip shows when it was added ([#383](https://github.com/neckermann/missions-partner-tracker/issues/383)).** `Trip` gains `createdAt`: the trip page reads "Added 11/10/2026 · Last edited by …", the Trips list has a sortable **Added** column (staff), and the demo seed gives each trip a realistic added date. A trip application's `submittedAt` is renamed `createdAt` to match every other record (nothing changes on screen: it is still "Submitted" on the team page). It is not an audit event; the Audit log is unchanged.
- **Support preferences ([#374](https://github.com/neckermann/missions-partner-tracker/issues/374)).** A new feature (Settings → Enabled Features → Support preferences, **off by default**, needs Care teams): a menu of ways your church and a partner's care team can support them, and each partner's choices from it. The menu is yours to edit under **Settings → Support Preferences** (groups, and options that are something you offer, pick one, pick any, or free text; **Add an example set** gives a starting list, and an option can be retired to keep its answers). A **Support preferences** card on the partner page records what a partner has asked for, by staff or their care team after a conversation; a **Support preferences** report lists who wants what, or who has nothing recorded. Never shown publicly, in the booklet or in dispatches, and a trip leader doesn't see it. Stored in real columns (`SupportOption`, `PartnerSupportPreference`), not a JSON blob.
- **Care follow-ups ([#364](https://github.com/neckermann/missions-partner-tracker/issues/364), [#365](https://github.com/neckermann/missions-partner-tracker/issues/365)).** A partner's **Contact Log** now shows **church visits and newsletters filed** among its entries, read from their own records (so editing or deleting one can't leave a stale copy) and read-only; and an **Updates to pass on** box with a **Log a thank-you** button that opens the log prefilled (we reached out, right topic) for a decided need or an answered prayer. A church visit now counts as hearing from a partner in **Last heard from**. **Settings → Care Teams → Timing** sets how many days ahead a key date is raised (default 7) and how many days without a contact make a partner "quiet" (default 90); everyone reads the same numbers. **My account → Key-date email** lets anyone on a care team (a guest included) turn off their own daily key-date email while keeping the bell alert. The **default lead** now also sees partners with no care team under "Partners to reach out to" (staff only; a Guest default lead is not widened). Not done, as decided: a cross-partner contact log page, adoption and commissioning dates, and a "send a greeting" button.
- **Wrap up trip ([#358](https://github.com/neckermann/missions-partner-tracker/issues/358)).** A **Wrap up trip** button on a trip (admins, editors and the trip's own leaders) walks through finishing it: confirm the actual dates, a four-prompt debrief (what the team did, what went well, what was hard, what the partner needs next), an optional visit in the partner's contact log with a follow-up date, loose ends, the photo album, and when leader access ends. It marks the trip Completed and the debrief shows on the trip's Overview (editable later). New bell items: **Trips ready to wrap up** (end date passed, not completed) and **Trips wrapped up** for the partner's care team. It is "wrap up", not "close", because the status Closed already means applications are closed.

- **Passkeys as a second sign-in factor ([#386](https://github.com/neckermann/missions-partner-tracker/issues/386)).** **My account → Passkeys** adds your device's fingerprint, face or screen lock (or a security key) as the second step at sign-in, instead of or as well as an authenticator app: up to five per person, named, with when each was added and last used, removed with your password. Sign-in after the password offers **Use a passkey** and/or the code, according to what the account has; a person sent to enrolment by the church-wide requirement can finish with a passkey. You can't remove your last way in while two-factor is required, and an admin's **Reset MFA** clears passkeys too. Only public keys are stored (`UserPasskey`); a replayed or wrong-site response is refused. Passwordless sign-in is not part of this.

- **Trip application questions, answers and the requirement checklist are real database rows, not JSON ([#394](https://github.com/neckermann/missions-partner-tracker/issues/394)).** A trip's own questions, the church-wide application questions and their library, and the requirement checklist and its library (Settings → Mission Trips) now live in `ApplicationQuestion` and `RequirementTemplateItem`, and each application's answers in `TripApplicationAnswer`, one row per answer. Nothing changes on screen. What is new: an answer keeps the question's wording as it was asked, so renaming or deleting a question later no longer leaves old answers unlabelled (an answer to a removed question still shows on the application, under its original wording), and answers can now be reported on. The four columns that stay JSON each have a written reason in the schema and in CONTRIBUTING.md's data-model section: `AuditLog.details`, `SavedReport.params`, `NotifiableEvent.payload` and `ChurchSettings.enabledFeatures`.

- **Passwordless sign-in, a church-wide option ([#386](https://github.com/neckermann/missions-partner-tracker/issues/386), Layer 2).** **Settings → Manage Users → Passwordless sign-in** removes passwords for the whole church. A person with a passkey signs in with it alone (it is both factors); anyone without one gets a one-time emailed link (15 minutes, single use), which signs them in and walks them through adding a passkey. It needs outbound email working and a passkey on the admin turning it on (the button says which is missing), implies the two-factor requirement, shows how many accounts have no passkey yet, can't be turned on for the public demo, and stops outbound email being switched off while it is on. No automatic fallback to passwords: if email breaks or a passkey is lost, an admin uses **Reset MFA** and hands over a setup link. Passwords are kept, so turning it off restores them. New welcome emails send a sign-in link instead of a password link while it is on.

### Changed

- **No two-factor rule is specific to a guest any more.** A guest used to be forced to enrol in four separate places (when created, when promoted, after an admin reset, and could never switch it off). They are now treated like every other role: the church-wide setting above is the one way to require it of everyone, and an admin can still require it of one account. Add User's "Require two-factor" box is no longer locked on for a guest, and My account no longer has guest-only wording.

- **The demo seeds "last edited by" data.** Most demo partners, trips, prayer requests and needs now carry a demo editor's name and a date within the last ten weeks, so the **Last updated** column on Partners and Trips isn't blank on a fresh demo; about one in seven is left blank, as on a real install.
- **The version restarts at `0.1.0-beta.1`, on a beta track ([#378](https://github.com/neckermann/missions-partner-tracker/issues/378)).** The number had climbed from 0.5.0 to 0.7.0 in a day, faster than the product was approaching 1.0. Releases toward each minor are now betas (`0.1.0-beta.1`, `beta.2`, …), the minor moves once per batch that is ready for forks, and `1.0.0` is the point where upgrades stop needing a database reset. The update banner understands pre-releases (a beta is older than its own final release), and the tag and GitHub Release are now created automatically when `main` changes, so they can't be skipped again (`0.6.0` and `0.7.0` had none). The 0.2.0 to 0.7.0 entries below are kept as history.
- **The public demo shows the key-date alert on the bell.** Key-date reminders are on for the demo again; its daily email still can't go out, because the job returns early on any deployment where `DEMO_RESET_TOKEN` is set.

### Documentation

- **The guides are reorganized ([#380](https://github.com/neckermann/missions-partner-tracker/issues/380)).** The user guide has a **Caring for partners** group (care teams and the Guest role, My partners, the contact log, key-date reminders, passing updates on); the Audit log is under **Settings**; and "Who last edited a record" sits with the partner page, with a duplicated sentence fixed. The architecture, agent, contributor, upgrading and runbook docs now cover care teams, the audit log (on by default, records sign-in IP addresses, pruned nightly by the worker), last-edited stamping and the sending church filter. The admin guide's "Who can see what" no longer says every account reads every partner (a Guest does not), and the README no longer describes two-factor as per account.
- **`npm run check:docs`** checks every internal link and `#anchor` in the markdown and the guide anchors the app links to, and runs in CI. It found a dead anchor and a wrong path.

### Fixed

- **On a phone the admin menu no longer fills the first screen ([#384](https://github.com/neckermann/missions-partner-tracker/issues/384)).** At 800px wide and below the sidebar was about 720px of menu above every page, so the page you opened started below the fold. It is now a slim bar (church name, the bell and a **Menu** button) that stays at the top; the menu opens beneath it and closes once you choose a page. Wider screens are unchanged.
- **A partner's Newsletters & Docs card showed "undefined"** where the file kind belongs (and a custom kind never showed its own text) (#369).
- **Three more layout bugs found by walking the app at phone width.** The public site's header nav (Directory, Map, Pray for our Missionaries, Trip Opportunities) ran off the right edge of a phone on every public page; it now wraps under the title. A long unbreakable value on a partner page (a link's URL, a long contact email) pushed the page wider than the screen and shoved a row's Edit and Delete buttons off it; values now wrap. A trip's Financial tab widened the whole page with its contributions table; the table now scrolls inside its section. A phone-width Playwright check (`mobile-layout`, `mobile-public-nav`) now fails if a main page scrolls sideways or runs off the screen. Part of [#375](https://github.com/neckermann/missions-partner-tracker/issues/375).
- **The notification bell's dropdown opened off the screen on a phone** (about 250px past the right edge at 360 to 768px wide). It is now kept fully on screen, never wider than the screen, and closes when the page scrolls or the window resizes instead of floating away from its bell. The first fix from the mobile sweep ([#375](https://github.com/neckermann/missions-partner-tracker/issues/375)).
- **The Audit log export downloaded as `activity-log-….csv`**, a leftover from before the page was renamed; it is now `audit-log-….csv`. A link in the Admin Guide to the Audit log section was also dead.
- **A link to a deleted record left the page on "Loading..." forever.** The partner, trip, participant and application pages now say the record wasn't found (or that you don't have access to it) and link back to the list. An old bookmark, or a tab left open across a demo reset, is the usual way to hit this.
- **A guest's trip page never showed the Financial tab**, even with trip budgeting on, because the page asked for the church-wide trip settings, which are closed to guests. Whether budgeting is on now comes with the trip itself, and the trip pages no longer request the closed settings for a guest (#370).
- **"Email me a new link" no longer promises a link that won't come ([#345](https://github.com/neckermann/missions-partner-tracker/issues/345)).** While outbound email is off, the expired-link page now says this site can't send email and to ask the church administrator for a new setup link, instead of "a new link is on its way". It is the same message for every address, so it still reveals nothing about which accounts exist.

### Upgrading

- **The version number went back to `0.1.0-beta.1`.** A fork that synced from an earlier release will see its version drop, and its **"update available" banner stays quiet until a release numbered above the one it runs** (the banner only compares numbers). Pull updates with Sync fork as usual; see [UPGRADING.md](UPGRADING.md). `0.1.0` onward is the sequence to follow.
- **Database baseline changed again: a database that already ran 0.7.0 must be reset too (pre-1.0).** `ChurchSettings.requireTwoFactor`, `Trip.createdAt`, the rename of `TripApplication.submittedAt` to `createdAt`, the new `SupportOption` and `PartnerSupportPreference` tables, `ChurchSettings.keyDateLeadDays` and `contactStaleDays`, and `User.keyDateEmailOptOut`, the trip debrief columns and `Trip.wrappedUpAt`, the `UserPasskey` table, the `ApplicationQuestion`, `TripApplicationAnswer` and `RequirementTemplateItem` tables, the `SignInLinkToken` and `SpentPasskeyChallenge` tables and `ChurchSettings.requirePasswordless`, and the removal of the `Json` columns they replace (`Trip.applicationQuestions`, `TripApplication.responses` and four on `ChurchSettings`) are folded into the single baseline `20261122092854_init` (SPEC §8.3), so `npx prisma migrate deploy` against a 0.7.0 database reads the baseline as already applied and adds nothing. Reset with the same steps and data-loss warning as before: `npx prisma migrate reset --force` from `backend/` (**erases all data**; back up first and re-create the admin with `node prisma/createAdmin.js`), or `npm run demo:reset:remote` / `npm run dev:reset:remote` for the demo and dev-test sites. The new baseline was regenerated from the schema and differs from the old one only by those changes.
- **Passkeys need `APP_BASE_URL` set to your site's address**, and keep it stable: the host name is the passkey's identity, so changing domain means people add their passkeys again. (The new `UserPasskey` table is folded into the baseline, so the database reset above covers it.)
- **Guests are no longer forced to set up two-factor by default on an existing install.** Turn on the church-wide **Two-factor sign-in** switch in Manage Users (after the admins have enrolled) to require it of everyone, guests included. A new install has it on from the first-run setup.

## Earlier releases (old numbering)

The version restarted at `0.1.0-beta.1` in November 2026 (see
[CONTRIBUTING.md § Versioning](CONTRIBUTING.md#versioning-the-pre-10-beta-track)).
The entries below were numbered before that restart and are kept as history.

## [0.7.0] - 2026-11-24

### Added

- **Audit log (#341).** New feature (Settings → Enabled Features → Audit log, **on by default**: it records nothing before it is on, so a church turning it on after something goes wrong would have nothing to look at; turn it off there if you'd rather not keep sign-in IP addresses) that records who did what and when for sensitive actions: sign-ins and failed sign-ins (with the reason and IP address), password and two-factor changes, accounts created/changed/deleted, guest trip-access changes, care team changes, every change to church settings (secrets noted as changed, never stored), partner and trip deletes, backup downloads, a partner's restricted status changing, and each person's first look at a restricted partner each day. Admins get **Settings → Audit log** with search, filters and CSV export. Entries are kept 30, 60 or 90 days (default 90) and pruned nightly. Actor and target are stored as ids plus an email/name snapshot with no foreign keys, so entries stay readable after an account is deleted.
- **Last edited by (#341).** 32 editable models gain `lastEditedById`, `lastEditedByName` and `lastEditedAt`, stamped centrally by a Prisma client extension for every write made by a signed-in person (not by background jobs, the seed or public forms). Shown on partner, trip, trip-participant and trip-application pages (a partner's or trip's line covers its sections too: family, addresses, links, visits, support; team, meetings, requirements, money) and in the prayer request and one-time need dialogs; the **Partners** and **Trips** lists get a sortable **Last updated** column (not to guests, never on the public site), and as **Last edited by** / **Last edited** columns in the Data completeness report. Kept indefinitely, unlike the log.
- The demo seeds example Audit log entries. Existing installs get the Audit log on at their next upgrade, since it is on unless switched off.

### Changed

- **"Assigned to me" is now "My partners"**, matching the key-date email's "Open my partners" button. Staff on a care team land on All and switch to it with the tab; a guest, whether on a care team or given a trip, sees one plain list of every partner they can reach, with no tabs.
- **Filter by sending church, everywhere it applies.** A **Sending church** filter (our own church first as "Sent by us", then each other church with its partner count, matched case-insensitively) is on the Partners, Newsletters & Docs, Trips, Prayer Requests, One-Time Needs and Monthly Support lists and on every report that lists partners. New `GET /api/partners/sending-churches` (staff) for the options, and a `sendingChurch` parameter on the list routes and reports. The Partners list's **Flags** column is not sortable (a row can carry several flags); use the filter.
- **Cleaner lists.** The Trips list drops its Type and Trip Type columns (the partner name and the filters identify a trip); Partners shows the photo beside the name instead of in a blank column and merges Public, Restricted and Sent By Us into one **Flags** column showing only exceptions; Monthly support drops Type; Manage Users drops Auth (always "local"); the Support summary report drops its Annualized column (the total stays in the summary) and the Partner roster drops Years (Partnering since stays, and the roster still sorts by it). The partner page header shows pills only for what is out of the ordinary (Not safe to contact, Not public, Restricted-access, Sent by us, On furlough, Archived), since the usual state is in the Status & Visibility card.
- **Settings navigation order.** About App (version, system info, backups) moves to the end of Settings, after the per-feature settings, so Enabled Features is followed directly by the settings it controls; the Settings home tiles follow the same order. A test keeps the sidebar, the tiles and the route table in agreement.
- The lapsed demo guest `sam.okafor` now uses the demo admin's email domain, like the other demo logins.

### Fixed

- The pinned Back/Cancel/Next/Save bar ran off the right edge on a phone, leaving its last buttons unreachable, on every wizard and form that uses it.
- Add User's Care team step now appears only when the Guest role is chosen.

### Upgrading

- **Database baseline squashed again: a database that already ran 0.6.0 must be reset too (pre-1.0).** The audit log's `AuditLog` table, `ChurchSettings.auditRetentionDays` and the `lastEditedBy*` columns on 32 models are folded into the single baseline `20261122092854_init` (SPEC §8.3), so `npx prisma migrate deploy` against a 0.6.0 database reads the baseline as already applied and adds nothing. Reset instead, with the same steps and data-loss warning as 0.6.0 below: `npx prisma migrate reset --force` from `backend/` (**erases all data**; back up first and re-create the admin with `node prisma/createAdmin.js`), or `npm run demo:reset:remote` / `npm run dev:reset:remote` for the demo and dev-test sites. The new baseline was verified identical (columns, indexes, constraints, enums) to the incremental chain it replaces.

## [0.6.0] - 2026-11-24

### Added

- **Trip access grants for guests (#356).** A guest login (see Changed) reaches the trips an admin gives it through a new `TripAccess` table, so one guest can lead more than one trip and a trip can have more than one guest. Access ends **30 days after the trip's end date**, worked out when the guest signs in rather than stored, so changing a trip's dates moves the expiry too (a trip with no end date never lapses on its own). An admin can extend a grant to a date, end it now, go back to the automatic date, or remove it, from the guest's row in Manage Users, from a trip's **Team → Guest access** section, or with **Give guest access** on a team member's page. **Add User** has a trip step for guests (and opens preset when you come from a trip).
- Guests get a **My account** page for their own password and two-factor authentication.
- Manage Users flags guest accounts that can't sign in (deactivated, all access expired, or no trips left) and has an **Inactive accounts only** filter (`GET /api/users?inactive=true`) so an admin can reach out and clean up.
- `backend/src/utils/guestAccess.js` is the one place that answers which partners and trips a guest may read (`canReadPartner`, `canReadTrip`); `utils/tripAccessRules.js` holds the pure expiry rules.
- **Care teams** (new feature, off by default: Settings → Enabled Features → Care teams). Each partner can have one **Lead** plus any number of **Members**, all logins, set from the partner's page, a trip's Team tab, or the Add User wizard (new **Care team** step, also reachable from a partner's "Invite a new guest" link). Terms are fixed ("Care team", "Lead", "Member", "Guest"). A guest can be given a partner through a seat instead of a trip; a seat never expires, and removing a guest's last trip or seat deactivates the account. Adds a _Care team coverage_ report ("which partners have no team or no lead"). Turning the feature off hides it and ignores seats for access; nothing is deleted.
- **A care team member has what an editor has on their own partner**: edit the profile, family, contact details, links, languages, trip hosting info and photos; archive; add and edit prayer requests and one-time needs and record answers; upload, edit and AI-scan documents; and view (read-only) the partner's trips. Three exceptions: their dispatches are held (next item), they can't record a decision on a one-time need, and they never see or change monthly support. They can't create a partner or delete anything. Staff keep every power whether or not they're on a team. A trip leader's smaller scope (a trip grant) is unchanged and never includes needs or the care-team list pages.
- **Their dispatches are held for review.** New `DispatchRecord.reviewRequired`: a prayer request, answer, need or uploaded newsletter entered by a care team member is saved at once, but its dispatch is held in Pending Dispatches on **every** channel (admin email, public email, GroupMe, WhatsApp, urgent) until an admin or editor approves it, whether or not the partner is restricted. Staff-made records are unchanged. (Until now the review hold covered only restricted partners; every other record was sent on schedule with no approval.) `isUrgent` and `approveNow` from such a login are ignored.
- Guests use **the same app as everyone** — same sidebar shell (bell, collapse, My Account, Log out, theme toggle), same nav entries, same partner page — instead of a separate minimal one. The server limits every list (Partners, Trips, Prayer Requests, One-Time Needs, Newsletters & Docs) to what they reach; a care team member's nav has all five, a trip leader's just Trips and Partners. One-time needs are readable by a care team member in full, notes included, never by a trip leader.
- New `GET /api/partners/reachable` (the partners a login may read, for pickers) and `careTeamSeats` on `/api/auth/me` for every role.

- **Care team updates (#292, Phase 1).** The app never contacts a partner; the team does. A care team guest now gets bell notifications for new one-time needs and prayer requests on _their own_ partners (the existing "New one-time needs" / "New prayer requests" categories, scoped), and a new **Updates to pass on to partners** alert counts a need the committee decided, or a prayer answered, in the last 30 days that nobody has relayed; it clears when an _outbound_ contact is logged with the topic Need / support (a decision) or Encouragement / Prayer (an answer). A care team member marking a prayer answered is now auto-logged as an inbound contact, like a new request already was. Needs Care teams and Contact log. No schema change.
- **A public demo never sends the key-date email.** Its team members are fake seeded addresses, so the mail would only bounce and spend the email plan. The demo reset and the seed now keep `keyDates` off (the list lives in `backend/src/utils/demoMode.js`), and the daily job skips entirely on a demo (anywhere `DEMO_RESET_TOKEN` is set), so a visitor switching the flag on with the published admin login can't start it either. The bell alert is off on the demo with the flag.
- **Key-date reminders (#291)** (new feature, off by default: Settings → Enabled Features → Key-date reminders; needs Care teams). A care team is reminded a week ahead about birthdays (adults and children), wedding anniversaries and supported-since milestones (the first year, then every fifth): on the bell ("Key dates coming up") and in **one grouped email per person, daily at 7am church time, only on days something is due** (needs Email (Sending); sent by the worker). Goes to the whole team, else the new **default lead** (Settings → Care Teams, `ChurchSettings.defaultCareLeadUserId`). Logging a contact with the new **Key date** topic clears a reminder. Restricted partners are named by initials only and family names are left out of the email. New `KeyDateReminder` table (what was emailed, so nothing repeats) and a `ChurchSettings.defaultCareLeadUserId` column.
- **Contact log (#288)** (new feature, off by default: Settings → Enabled Features → Contact log). Record every call, text, email, visit, card, video or prayer with a partner (`ContactLog`: type, direction, topics, who, date, note, optional follow-up date) from quick-select chips. Anyone who can see the partner can log one; admin/editor fix or delete. A **contact card** on every partner page shows the primary contact (new `Adult.isPrimaryContact`, one per partner), preferred method and tap-to-call/text/email/WhatsApp. **Assigned to me** on the Partners page lists a care team member's partners with days since contact, due follow-ups, next key date and open prayers/needs. A **Partners to reach out to** notification (bell and Home) counts the quiet ones (90 days, one shared number). _Last heard from_ now counts a logged contact. A care team member's new prayer request also logs the contact. Migration: new `ContactLog` table, `Adult.isPrimaryContact` (with a partial unique index), `Partner.contactInstructions`.
- **Demo sites show care teams.** The demo seed (`seedCareTeamsDemo`, demo extras only) puts care teams on the first six partners by name (covered, members-but-no-lead) and leaves four with none, so the coverage report has gaps, and adds three guests: a published **care team member** login and **trip leader** login (the only two accounts with two-factor off, so visitors can sign in) and a lapsed guest for the Inactive accounts filter. It also queues a care-team prayer request, an answered prayer and a one-time need as held dispatches, so Pending Dispatches shows the review flow. See `demo/README.md`.
- **The demo banner lists every published login**, not just the admin's: the care team member and the trip leader too, each with a line on what they get. The two guest accounts are defined once in `backend/src/utils/demoLogins.js`, which the seed and the banner (via `GET /api/public/settings`, demo only) both read, so the banner can't drift from what the seed creates. Every published login looks alike for simplicity: the guests' emails use the demo admin's email domain, and they share one password: the guests use `DEMO_ADMIN_PASSWORD`, and the optional `DEMO_GUEST_PASSWORD` (documented in `backend/.env.example`) overrides it.

### Changed

- **The printed booklet now honors "safe to contact".** A partner marked not safe to contact no longer has their phone, email or preferred contact method printed (it printed them before); their names still print and the staff-only special instructions never do.
- **Database baseline squashed: an existing database must be reset (pre-1.0).** Every schema change since 0.5.0, and every earlier incremental migration, is folded into the single baseline `20261122092854_init`, per this project's pre-1.0 convention (SPEC §8.3). `npx prisma migrate deploy` against a database provisioned from an earlier version will **not** apply it — it reads the baseline as already applied, so the new tables never appear. Reset instead: `npx prisma migrate reset --force` from `backend/` (this **erases all data**: back up first, then re-create the admin with `node prisma/createAdmin.js`), or for the demo and dev-test sites `npm run demo:reset:remote` / `npm run dev:reset:remote` ([demo/README.md](demo/README.md#recovering-after-a-migration-squash)). Because the baseline is generated from the schema, the earlier migrations' one-time data conversions are gone: a Trip Leader login from 0.5.0 is **not** carried over to a guest with a `TripAccess` row.
- The `tripLeader` role is renamed **`guest`** (the user-facing term is now "Guest"). A guest's reach is now one `TripAccess` row per trip, with an optional expiry override, instead of `User.scopedTripId`/`User.expiresAt` (both dropped); a guest who hasn't enrolled is made to set up two-factor authentication at next sign-in. A fork that referenced either, or the `"tripLeader"` role string, needs updating.
- Two-factor authentication is **required for guests** and can't be switched off by them (an admin MFA reset makes them enrol again at next sign-in). Reverses #329 Finding 2, which had made guest passwords and MFA admin-only; the backend self-service routes are open to guests again and "My account" is how they use them.
- The partner name shown in a guest's sidebar now prefers the partner's display name over its field display name, matching the partner page it links to.
- The "Users & access" report derives a guest's status and expiry from their trip grants instead of the removed `User.expiresAt` column, and gains a "No access" status.
- The welcome email for a guest now says "guest access" and links a "Guest guide".

### Removed

- The roster **Team Leader** checkbox on a trip participant (add-participant form and participant detail page), the leader names under the Trips list's Team column, and the `TripParticipant.isLeader` column behind it (dropped by the same `prisma migrate deploy`; any flags already recorded on past rosters are discarded). Who leads a trip is now whoever holds a guest grant for it.

### Security

- A Trip Leader scoped guest account could still read the full Pending Dispatches queue (`GET /api/dispatches/pending`) — the exact text about to go out for every partner/trip/prayer request/one-time need churchwide, unfiltered and not attached to any one trip. Excluded entirely, same `requireRole("admin", "editor", "viewer")` pattern as #329's inbound-email-queue fix (there's no sensible trip-scoped version of this queue). No database migration. (#350)
- A Trip Leader could re-point their own trip's `partnerId` at any partner via `PUT /api/trips/:id` (the full field set was written straight through with no per-role filtering), then use that attacker-controlled `partnerId` to pass the partner-scope check on every partner-scoped read — the full record of a partner they were never meant to see, restricted partners included. Blocked: a Trip Leader's update is now rejected outright if it includes `partnerId`. (#327 Finding 2)
- `GET /api/trips?partnerId=` returned every trip belonging to that partner, full participant rosters (dates of birth, guardian/emergency contacts) included, when a Trip Leader's own partner had more than one trip on file — not just their own. Now scoped to exactly their own trip, regardless of the `partnerId` query. (#327 Finding 2)
- `GET /api/settings/trips` and `GET /api/scoped-digest/summary` were reachable by a Trip Leader with no role check beyond being logged in — neither has a legitimate use for that role (church-wide trip configuration and a cross-church subscriber-count summary). Excluded. (#327 Finding 2)
- `PUT /api/trips/requirements/:id/participants/:participantId/complete` never checked that `:participantId` actually belonged to the requirement's own trip — a Trip Leader scoped to one trip could mark a different trip's participant complete against one of their own trip's requirements, given a leaked participant id. Fixed by validating the participant belongs to the requirement's trip before proceeding. (#327 Finding 3; the IDOR's other instance, `POST /:tripId/participants/:id/request-documents`, no longer exists — removed along with the trip document-request feature.)
- An unauthenticated caller could fill the database and exhaust memory on several public routes: the global JSON body limit was 15mb for every route (for the sake of one webhook), every string on the public trip-application schema was unbounded with no cap on how many custom-question `responses` a submission could carry, and the public document-upload route buffered up to 15mb into memory before even checking whether the caller had a valid access token. Fixed: the global body limit is now 100kb, with scoped 15mb/7mb exceptions for the three routes that genuinely carry a large payload (the Postmark webhook, and the two base64-image routes); every public application field now has a `.max()`; the two apply routes got a dedicated 10-per-15-minutes-per-IP limiter and a honeypot field; the upload route's access token moved from the request body to the query string so it's verified before the file upload middleware ever runs; a bad-credentials request to the inbound-email webhook no longer writes a database row. (#327 Finding 4)
- A session token kept working for its full 8-hour lifespan regardless of what happened to the account afterward — logging out only cleared the cookie, never the token itself, so a password change, an admin-set password reset, an MFA change, or a role change left every previously-issued session still valid. Added `User.sessionVersion`, embedded in the session token and checked against the row on every request; bumped on password change (self-service and admin reset), MFA enable/disable (self-service and admin-forced), and role change — deliberately **not** on logout, which stays scoped to the one cookie/browser it represents rather than silently signing a user out of every other device. The self-service routes (password change, MFA disable) re-issue a fresh cookie in the same response, so the tab making the change keeps working; only sessions opened elsewhere are the ones actually invalidated. Requires `npx prisma migrate deploy` (new `sessionVersion` column, default 0 — no other migration steps needed). (#327 Finding 7)
- Several fixes from the same pass: production access logs no longer write a usable `token` query-string value in plain text (Postmark/subscribe-link/trip-participant tokens all redacted to `[REDACTED]`); the trip-participant self-service access token (opens a minor's record, donor contact info, flights, and documents) had no expiry at all before this — now expires at the trip's own end date + 90 days (falling back to a flat 1 year when trip dates aren't available, never infinite), re-issuable through the existing lost-link recovery flow if it's ever actually needed again; `password-setup/validate` moved from GET with the token in the query string to POST with it in the body. Three links that changed state the moment they were _fetched_ (a real risk — mail security scanners pre-fetch inbox links) now only act on a follow-up POST: the admin digest unsubscribe link, the public subscriber unsubscribe link, and the meeting-RSVP links each render a plain-HTML confirm button first (still works with no JavaScript, the same constraint that made them GET in the first place); the two unsubscribe flows' outgoing digest emails also carry `List-Unsubscribe`/`List-Unsubscribe-Post` headers (RFC 8058), so a supporting mail client's own native "Unsubscribe" button can act with no page shown at all. (#327 Finding 6, now complete)
- A matching partner's email address alone used to be enough to auto-file an inbound email as that partner's newsletter and broadcast it to GroupMe/WhatsApp/the digest — `From` is trivially forgeable, so anyone who knew a church's inbound address and one partner's email could put a forged document under that partner's name and have it announced unreviewed. Now also checks Postmark's own SPF/DKIM signals (`Received-SPF`, and `X-Spam-Tests`'s `DKIM_VALID` token as a secondary signal) before auto-filing; a single match whose sender doesn't verify is queued for review instead, labeled "Sender not verified" in the Unmatched Emails queue rather than silently guessed. Requires `npx prisma migrate deploy` (new `InboundEmail.queueReason` column, nullable — no other migration steps needed). (#327 Finding 5)
- Three upload paths stored a file's client-declared type without ever checking the actual bytes against it, even though `utils/fileResponse.js` serves a file inline specifically on the premise that this was already checked: the trip-document-requirement upload, the participant self-service photo, and a `.eml`-named partner file (the filename-based `.eml` exemption meant a file named `x.eml` declaring `application/pdf` was stored and later served inline as that type, completely unverified). Added one shared `verifyUpload()` every upload route now calls; a `.eml` is always stored as the canonical `message/rfc822` regardless of what the client declared, never signature-checked (there's nothing reliable to check), and every other declared type is verified against its real magic bytes. (#327 Finding 8)
- `GET /api/settings` used a denylist (`omit` 6 secret columns), so every other column went to any signed-in role, Trip Leader included — `inboundEmailWebhookUsername` (half of the webhook credential), `inboundEmailAddress`, every GroupMe/WhatsApp internal id/name/connection-state field, and anything added to the model in the future by default. Switched to an explicit `select`: a field now has to be deliberately added to ever reach this response. GroupMe/WhatsApp integration detail is already served by their own dedicated admin-gated routes and wasn't read by this endpoint's actual consumers anyway. (#327 Finding 9)
- Re-subscribing an already-confirmed email address used to apply the new cadence/scope immediately with nothing proving the caller actually owns that address — anyone who knew (or guessed) a real subscriber's email could silently re-scope their subscription. Now a change to an already-confirmed subscriber is only proposed: it's emailed to that address as a confirm-change link (distinct copy from the first-time confirmation, so an existing subscriber doesn't read it as "you weren't subscribed before"), and only written to the database if that link is clicked. Still-unconfirmed and brand-new subscribers are unaffected — nothing about their row is "live" yet either way. No database migration; the proposed values travel inside the confirm-change link's own signed token. (#327 Finding 11.2)

## [0.5.0] - 2026-11-23

### Security

- A Trip Leader scoped guest account could still read the full Pending Dispatches queue (`GET /api/dispatches/pending`) — the exact text about to go out for every partner/trip/prayer request/one-time need churchwide, unfiltered and not attached to any one trip. Excluded entirely, same `requireRole("admin", "editor", "viewer")` pattern as #329's inbound-email-queue fix (there's no sensible trip-scoped version of this queue). No database migration. (#350)
- A Trip Leader could re-point their own trip's `partnerId` at any partner via `PUT /api/trips/:id` (the full field set was written straight through with no per-role filtering), then use that attacker-controlled `partnerId` to pass the partner-scope check on every partner-scoped read — the full record of a partner they were never meant to see, restricted partners included. Blocked: a Trip Leader's update is now rejected outright if it includes `partnerId`. (#327 Finding 2)
- `GET /api/trips?partnerId=` returned every trip belonging to that partner, full participant rosters (dates of birth, guardian/emergency contacts) included, when a Trip Leader's own partner had more than one trip on file — not just their own. Now scoped to exactly their own trip, regardless of the `partnerId` query. (#327 Finding 2)
- `GET /api/settings/trips` and `GET /api/scoped-digest/summary` were reachable by a Trip Leader with no role check beyond being logged in — neither has a legitimate use for that role (church-wide trip configuration and a cross-church subscriber-count summary). Excluded. (#327 Finding 2)
- `PUT /api/trips/requirements/:id/participants/:participantId/complete` never checked that `:participantId` actually belonged to the requirement's own trip — a Trip Leader scoped to one trip could mark a different trip's participant complete against one of their own trip's requirements, given a leaked participant id. Fixed by validating the participant belongs to the requirement's trip before proceeding. (#327 Finding 3; the IDOR's other instance, `POST /:tripId/participants/:id/request-documents`, no longer exists — removed along with the trip document-request feature.)
- An unauthenticated caller could fill the database and exhaust memory on several public routes: the global JSON body limit was 15mb for every route (for the sake of one webhook), every string on the public trip-application schema was unbounded with no cap on how many custom-question `responses` a submission could carry, and the public document-upload route buffered up to 15mb into memory before even checking whether the caller had a valid access token. Fixed: the global body limit is now 100kb, with scoped 15mb/7mb exceptions for the three routes that genuinely carry a large payload (the Postmark webhook, and the two base64-image routes); every public application field now has a `.max()`; the two apply routes got a dedicated 10-per-15-minutes-per-IP limiter and a honeypot field; the upload route's access token moved from the request body to the query string so it's verified before the file upload middleware ever runs; a bad-credentials request to the inbound-email webhook no longer writes a database row. (#327 Finding 4)
- A session token kept working for its full 8-hour lifespan regardless of what happened to the account afterward — logging out only cleared the cookie, never the token itself, so a password change, an admin-set password reset, an MFA change, or a role change left every previously-issued session still valid. Added `User.sessionVersion`, embedded in the session token and checked against the row on every request; bumped on password change (self-service and admin reset), MFA enable/disable (self-service and admin-forced), and role change — deliberately **not** on logout, which stays scoped to the one cookie/browser it represents rather than silently signing a user out of every other device. The self-service routes (password change, MFA disable) re-issue a fresh cookie in the same response, so the tab making the change keeps working; only sessions opened elsewhere are the ones actually invalidated. Requires `npx prisma migrate deploy` (new `sessionVersion` column, default 0 — no other migration steps needed). (#327 Finding 7)
- Several fixes from the same pass: production access logs no longer write a usable `token` query-string value in plain text (Postmark/subscribe-link/trip-participant tokens all redacted to `[REDACTED]`); the trip-participant self-service access token (opens a minor's record, donor contact info, flights, and documents) had no expiry at all before this — now expires at the trip's own end date + 90 days (falling back to a flat 1 year when trip dates aren't available, never infinite), re-issuable through the existing lost-link recovery flow if it's ever actually needed again; `password-setup/validate` moved from GET with the token in the query string to POST with it in the body. Three links that changed state the moment they were _fetched_ (a real risk — mail security scanners pre-fetch inbox links) now only act on a follow-up POST: the admin digest unsubscribe link, the public subscriber unsubscribe link, and the meeting-RSVP links each render a plain-HTML confirm button first (still works with no JavaScript, the same constraint that made them GET in the first place); the two unsubscribe flows' outgoing digest emails also carry `List-Unsubscribe`/`List-Unsubscribe-Post` headers (RFC 8058), so a supporting mail client's own native "Unsubscribe" button can act with no page shown at all. (#327 Finding 6, now complete)
- A matching partner's email address alone used to be enough to auto-file an inbound email as that partner's newsletter and broadcast it to GroupMe/WhatsApp/the digest — `From` is trivially forgeable, so anyone who knew a church's inbound address and one partner's email could put a forged document under that partner's name and have it announced unreviewed. Now also checks Postmark's own SPF/DKIM signals (`Received-SPF`, and `X-Spam-Tests`'s `DKIM_VALID` token as a secondary signal) before auto-filing; a single match whose sender doesn't verify is queued for review instead, labeled "Sender not verified" in the Unmatched Emails queue rather than silently guessed. Requires `npx prisma migrate deploy` (new `InboundEmail.queueReason` column, nullable — no other migration steps needed). (#327 Finding 5)
- Three upload paths stored a file's client-declared type without ever checking the actual bytes against it, even though `utils/fileResponse.js` serves a file inline specifically on the premise that this was already checked: the trip-document-requirement upload, the participant self-service photo, and a `.eml`-named partner file (the filename-based `.eml` exemption meant a file named `x.eml` declaring `application/pdf` was stored and later served inline as that type, completely unverified). Added one shared `verifyUpload()` every upload route now calls; a `.eml` is always stored as the canonical `message/rfc822` regardless of what the client declared, never signature-checked (there's nothing reliable to check), and every other declared type is verified against its real magic bytes. (#327 Finding 8)
- `GET /api/settings` used a denylist (`omit` 6 secret columns), so every other column went to any signed-in role, Trip Leader included — `inboundEmailWebhookUsername` (half of the webhook credential), `inboundEmailAddress`, every GroupMe/WhatsApp internal id/name/connection-state field, and anything added to the model in the future by default. Switched to an explicit `select`: a field now has to be deliberately added to ever reach this response. GroupMe/WhatsApp integration detail is already served by their own dedicated admin-gated routes and wasn't read by this endpoint's actual consumers anyway. (#327 Finding 9)
- Re-subscribing an already-confirmed email address used to apply the new cadence/scope immediately with nothing proving the caller actually owns that address — anyone who knew (or guessed) a real subscriber's email could silently re-scope their subscription. Now a change to an already-confirmed subscriber is only proposed: it's emailed to that address as a confirm-change link (distinct copy from the first-time confirmation, so an existing subscriber doesn't read it as "you weren't subscribed before"), and only written to the database if that link is clicked. Still-unconfirmed and brand-new subscribers are unaffected — nothing about their row is "live" yet either way. No database migration; the proposed values travel inside the confirm-change link's own signed token. (#327 Finding 11.2)
- A shape-valid but nonexistent Joshua Project country code (a typo on a partner record, say) re-hit the upstream API on every single page load that rendered it, with nothing ever cached for a lookup that came back empty — only a real hit was cached. Now cached too, with a shorter TTL (1h vs. 24h for a real hit) so a since-corrected code isn't masked for a full day. A misconfigured/expired API key's 200-with-error-body response is still never cached, same as before. (#327 Finding 11.3)
- `primaryColor`/`headerColor`/`highlightColor`/`brandFont` accepted any string at all and were stored verbatim, later dropped straight into a `style="..."` HTML attribute in every rendered digest email, transactional email, and confirm/unsubscribe page — an admin account (or a compromised one) could break out of the attribute into arbitrary HTML/CSS sent to every recipient. Colors are now validated against `#rrggbb` (the only shape the native color-picker inputs ever produce); `brandFont` against an explicit allowlist matching the dropdown's own options (there's no native input to constrain free text the way the color pickers do). Separately — and present even on a fully default, never-touched install — the font-family fallback itself (`"Segoe UI"`) was being interpolated into that same attribute unescaped, breaking it open on every email/page that didn't have a custom font configured; fixed by escaping it the same way every other interpolated value in these templates already is. (#327 Finding 11.4)
- Four different routes that set a password (self-service change-password, first-run `/setup`, the welcome-link completion, and an admin create/reset via `users.js`) each enforced their own length check independently — two of them (`/setup`, `/change-password`) only checked a minimum, with no upper bound at all, and the admin-set path in `users.js` had no bound either (only `/password-setup/complete` had both). Unified into one shared `utils/password.js` schema (8-128 characters, matching the one path that already had it right) used by all four. (#327 Finding 11.5)
- Added a boot-time warning (non-fatal, same tier as the existing `FIELD_ENCRYPTION_KEY` one) when `NODE_ENV` isn't exactly `"production"` — the session cookie is only marked secure/HTTPS-only in that exact case, so a self-hoster running their own server/container (rather than a PaaS like Render that sets this automatically) could deploy for real with the session cookie sent over plain HTTP and never know. (#327 Finding 11.6)
- Documentation drift fixes: `FIELD_ENCRYPTION_KEY`'s own description (`.env.example`, `config/env.js`'s boot warning, ADMIN_GUIDE.md in three places) said it only protects TOTP/MFA secrets — it actually protects every stored integration credential too (Postmark, GroupMe, Joshua Project, WhatsApp), which an admin rotating the key on the strength of the old description would've had silently break with no warning. Also fixed a stale webhook path (`/api/inbound-email/webhook`, which has never existed — the real route is `/postmark`) in `.env.example` and `scripts/reset-demo-data.js`'s own comments. (#327 Finding 11.8)
- Added `SECURITY.md`, pointing reporters at GitHub's Private Vulnerability Reporting (already enabled on this repo) instead of a published email address or a public issue. (#327 Finding 11.9)
- A restricted partner's masked public identity carried a re-identification fingerprint everywhere it could surface outside the signed-in app — the public site/API, GroupMe/WhatsApp dispatch messages, email digests, trip pages, and shared report exports: `supportingSince` was still returned unmasked, and the generic silhouette varied by the partner's _real_ household shape (single/couple/family), itself identifying info. For a small country, initials plus country plus household shape can be enough to re-identify who that is to someone who knows the local mission community. Fixed: `supportingSince` is now dropped for a restricted record everywhere it was exposed, and the silhouette is always the plain single-person shape (orgs already always got a building icon, unaffected). Separately, whether to show initials at all is now a per-church setting (`ChurchSettings.restrictedPartnerInitialsEnabled`, Site Administration → Dispatches → Restricted Partners) — default on (today's behavior, unchanged unless a church turns it off), falling back to the partner's own `fieldDisplayName` (e.g. "Northern Uganda") if set, else a fixed generic label, when off. One shared `maskedDisplayName()` helper now backs every one of these surfaces instead of each reimplementing its own `toInitials()` call. Requires `npx prisma migrate deploy` (new `ChurchSettings.restrictedPartnerInitialsEnabled` column, default `true` — no other migration steps needed). (#327 Finding 10)

## [0.4.0] - 2026-11-23

### Added

- A **Log Contributions** tab on the Trips page lets an admin/editor log a trip contribution for any trip and any team member from one place, instead of navigating into each trip's own Financial tab one at a time — built for working through a stack of checks for several trips/people in one sitting. Same backend endpoint and data shape as the existing per-trip form; the Trip selector stays sticky after each save, and a running "Logged this session" list shows what's been entered so far. Reachable whenever Trips is enabled — unlike the per-trip Financial tab, it does _not_ require Trip budgeting to be turned on, since logging a gift that came in doesn't depend on having set a planned budget. (Originally a standalone sidebar item gated on Trip budgeting; moved under Trips as a tab and regated to just the Trips feature.) (#272)
- Admin light/dark/system appearance toggle — a System/Light/Dark segmented control on My Account (and a compact copy in the sidebar footer) that persists per-browser via `localStorage`, with no backend/`ChurchSettings` change. System follows the OS via `prefers-color-scheme`; Light/Dark pin it with a `data-theme` attribute on `<html>`. A church's configured brand colors (`primaryColor`/`headerColor`/`highlightColor`) are respected in both modes — dark mode uses a lightened, contrast-safe derived variant for brand color used as text/foreground, not the raw configured color unchanged. Covers the admin shell/sidebar, shared primitives (buttons, modals, tables, forms, `StatusPill`, filter bar, wizard), and the Home/Partners/Partner Detail/Account Settings pages. Known incomplete: the public-facing site (directory/map/partner detail/subscribe) and the print-oriented Reports/Booklet screens weren't audited for dark mode. (#283)

### Security

- A Trip Leader scoped guest account (`User.role === "tripLeader"`) could read the entire church's unmatched-inbound-email queue (`GET /api/inbound-email`, `GET /api/inbound-email/:id/raw`) — not scoped to their own trip at all, since that queue holds mail nobody could match to any partner or trip yet. Excluded entirely rather than scoped: there's no sensible "my trip's unmatched mail" view. No database migration. (#329)
- A Trip Leader could also self-service their own password and MFA (`POST /api/auth/change-password`, `/mfa/setup`, `/mfa/verify-setup`, `/mfa/disable`) even though the admin UI already treats that account as fully admin-managed (no "My Account" nav link, no route to it). The backend now matches that existing policy — forced MFA enrollment at first sign-in (set by an admin) still works, since that's not self-service. No database migration. (#329)

### Removed

- The trip "document request" feature (an admin emailing a participant asking for a file, with their reply routed back via Reply-To and filed as a `TripDocument`) is removed. This is a deliberate simplification, not a bug fix: it duplicated something better that already existed — adding a document-kind `TripRequirement` already emails the participant proactively, and their own self-service trip page already has a real upload control for it. Self-service upload via the participant's own trip page remains the way to collect trip documents; an admin can still log one manually on a participant's detail page for a document that arrived some other way.

### Changed

- `/admin/booklet` reorganized into a two-pane layout — the same controls (template picker, who's included, what shows on each page, cover text, Print Booklet) on the left, the live print preview pinned on the right so it's visible without scrolling past every control first, instead of three stacked cards above a full-width preview further down the page. The template picker now shows a small visual swatch per template (not just text), and "What Shows on Each Page" is a grid of click-to-toggle pill chips instead of a plain checkbox list. Every control's own behavior is unchanged. (#346)
- Inbound email matching is simplified now that document request is gone: the Postmark webhook no longer checks the sender against `TripParticipant.email` at all — it's Partner-only. Exactly one matching partner files the email as a Newsletter automatically; zero or more than one lands in the Unmatched Emails queue, same as before. (An admin can still manually assign an already-queued, unmatched email to a trip participant from that queue — that manual action is unchanged.)
- `backend/.env.example`'s `FROM_EMAIL_ADDRESS` example is now `no-reply@yourchurch.org` instead of `updates@yourchurch.org`, matching the fact that this app never expects a reply to its own outbound sends now that document request is gone. `ADMIN_GUIDE.md`'s Email (Postmark) section is updated to match — the Receiving side is now described as single-purpose ("lets partners send their newsletters/updates directly"), and the Sending-vs-Receiving decision table no longer has a "needs both" row.

### Fixed

- The booklet's decorative corner shapes (Classic template) could bleed past their own page's edges and visually overlap the next page's content/page number in the on-screen preview — `.booklet-page`/`.booklet-cover`/`.booklet-index` now clip their own content (`overflow: hidden`), and the shapes themselves now anchor to a page corner instead of one of them floating mid-edge. (#346)
- `POST /api/auth/password-setup/request` ("send me a new setup link") now explicitly checks `outboundEmail` before attempting to send, matching every other `sendWelcomeEmail` call site (`users.js`). Previously it relied on `sendWelcomeEmail` throwing its own "not configured" error when the feature was off, silently caught by this route's deliberate catch-all — same end-user-visible behavior (the generic response never changes either way), but fragile, not explicit. (#345 email review follow-up)
- Adding a user whose email already belongs to another account showed the generic "That value is already in use" — reads as a form-validation complaint, not as "this account already exists." `POST /api/users` now says "A user with this email already exists. To change their permissions, edit their existing account instead."

## [0.3.0] - 2026-11-23

### Added

- Admin-configurable email-digest cadence tiers (biweekly/monthly/quarterly) — Settings → Notifications lets an admin choose which tiers are offered to admin and public subscribers. Disabling a tier someone's already subscribed to automatically moves them to the first still-enabled tier (preference order monthly → quarterly → biweekly); at least one tier must always stay enabled. **Requires a database migration** (three new `ChurchSettings` columns). (#209)
- A partner's detail page now has a **Last Prayed For in a Service** field, recording the last time the whole congregation prayed for that partner together during a worship service or special church event — distinct from any individual prayer request's own answer. **Mark Prayed Today** sets it to today in one click; the field can also be edited directly to backdate it. A caption on the field spells out the distinction from an individual prayer request. **Requires a database migration** (`Partner.lastPrayedWithCongregationAt`). (#228)
- The **Last heard from** report now has a **Last prayed w/ congregation** column alongside last newsletter, last photo, last prayer request, and last church visit — one more connectedness signal. The seed script also now populates the field for a realistic fraction of seeded partners, rather than leaving it always empty. (#228 follow-up)
- AI scan now warns when a file has already been scanned, showing how many prayer requests/needs were previously added from it — informational only, doesn't block adding more. (#323)
- The AI extraction model is now configurable per church (Settings → AI Features), with a clear error message if the configured model becomes unavailable instead of a generic failure. The built-in default is unchanged. **Requires a database migration** (`ChurchSettings.extractionModel`). (#324)

### Changed

- Booklet templates rebuilt as a small, data-driven catalog (`frontend/src/booklet/templates.js`), mirroring the registry/definitions split the Reports rebuild established — a template is now a token set consumed by one shared `booklet.css`, not a hand-duplicated ~150-line CSS block per template. The picker now offers exactly two templates, Classic and Modern (ported onto the new system, unchanged in look); Traditional, Keepsake, Portfolio and Friendly are removed. Their CSS can be re-added onto the new token system in a follow-up if wanted.
- The booklet's accent color now defaults to `ChurchSettings.primaryColor` (your church's own brand color) instead of a hardcoded four-color rotation; the old rotation is kept only as the fallback for an instance that hasn't set a brand color. No database migration.
- The roster "Trip Leader" checkbox on a trip participant's detail page is now labeled **Team Leader** and shown as a status pill — it was colliding in name with the separate "Trip Leader" scoped-guest login role, which is an unrelated concept. Display-only; the underlying field is unchanged. (#309)
- Documentation and screenshots refreshed across SPEC.md, ARCHITECTURE.md, ADMIN_GUIDE.md, USER_GUIDE.md and the public docs site to reflect this session's changes (the Reports rebuild, the Add User and trip-application-review wizard pages, the settings-page consolidation). No functional changes.
- `ADMIN_GUIDE.md`'s Postmark setup section now includes a decision table for which features need Email (Sending), Email (Receiving), or both, so a church can tell upfront what their chosen setup will and won't support.

### Fixed

- **Security:** a digest email's unsubscribe link could be replayed as a permanent, never-expiring admin session — it bypassed password and MFA entirely and survived a password change. The unsubscribe token is now rejected everywhere a real session is checked, and now expires after 90 days. If you've sent digest emails from an affected instance, rotate `SESSION_SECRET` as a precaution.
- The booklet preview's "Restricted-access" checkbox only hid restricted missionaries, not restricted organizations — a restricted organization's full unmasked details printed regardless of the checkbox. Organizations are now filtered the same way.
- Backup/restore was silently dropping 25 of 44 models on export/import — the model list is now derived from the live Prisma schema at module load, with an assertion that catches future drift instead of a hand-maintained list quietly falling out of sync again.

## [0.2.0] - 2026-11-23

Still pre-1.0: this is the first version number this project has
actually tagged and released (see `package.json` history — earlier
`1.x` entries in this file were never tagged or published, and the
version was dropped back below `1.0` to stop implying otherwise).
Everything below is the project's full feature set to date, not just
what changed since some prior release.

### Changed

- Reports rebuilt from scratch: a hub organized by question (Money, Partner care, Partners & relationships, Upcoming, Trips, Coverage, Communication, Contacts, System) and sixteen reports — support summary, support changes, prayer requests, one-time needs, data completeness, partner roster & tenure, last heard from, families & key dates, trip fundraising, trip readiness, application funnel, language coverage, where we serve, dispatch health, mailing list, users & access (admin only). Each has URL-backed filters, summary tiles, charts, click-through summary tiles, CSV download and print / save as PDF. No database migration.
- Saved report views (private or shared) and scheduled report emails (weekly/monthly/quarterly, sent to existing users, masked for restricted partners). **Requires a database migration** (`ReportSchedule`, `SavedReport`).
- **Removed** the previous reports (birthdays, furlough, trip history, and the earlier support, needs and prayer exports). Bookmarked `/api/reports/<old-id>` URLs now return 404.

**Welcome emails with secure password setup.** Adding a user (including a
Trip Leader) now emails them a one-time "Choose your password" link instead
of an admin typing a password. The link is single-use, expires (72 hours;
7 days for Trip Leaders), and only a hash of it is stored. Add User has a
"Send a welcome email" toggle (on by default) and a "Require two-factor
authentication at first sign-in" option; turning the email off leaves the
account pending until a password is set or "Send setup link" is used on its
row. The sign-in-time two-factor setup screen and Account Settings now walk
first-timers through installing and using an authenticator app. Trip
participant emails (meeting invites with Yes/No/Maybe buttons, reminders,
checklist and date-change notices, team welcome) and the new welcome email
share one branded, reusable template (`backend/src/utils/emailTemplate.js`).
**Needs a migration** (new `PasswordSetupToken` table) -- run
`npx prisma migrate dev`. Guide/support links in the welcome email point
at this project's own docs and aren't configurable per fork (no new env
vars).

The notification system is now called **Dispatch** throughout the app
and its database schema, so it can't collide with a future in-app
notifications feature. Nothing about how it behaves changed — "Pending
Notifications" is now "Pending Dispatches," "GroupMe notifications" is
"GroupMe dispatch," the Notification Settings page is now Dispatch
Settings, and so on, across every admin screen and both guides. Under
the hood, every notification-related table/column/file was renamed to
match (see `backend/prisma/schema.prisma` and
`backend/src/utils/dispatch*.js`) — a fork with its own customizations
touching that vocabulary will need to update those references when
pulling this release in.

New **WhatsApp dispatch** option alongside GroupMe: new prayer
requests, one-time needs, and newsletters (plus a prayer request's
answer and a one-time need's decision) can post to their own groups
inside one WhatsApp community. It runs on the same daily send hour and
the same content-type mutes as GroupMe — a church can run either or both
— and several related items go out together in one message instead of
one post each. Off by default, behind a new **WhatsApp dispatch**
feature toggle; set up entirely in the UI (Settings →
WhatsApp): link a dedicated phone number with a pairing code or QR code,
pick the community, then pick a group for each dispatch type.

Worth knowing before turning it on: this is an unofficial connection
(the number is linked the way WhatsApp Web is), so WhatsApp can ban
numbers used this way — use a dedicated number, never a personal one.
The linked session is stored encrypted in the database (it isn't included
in backups, so restoring onto a new instance means linking again), and
sends go through ban-risk protection that spaces messages out and pauses
them if the number looks flagged. Needs one new schema migration
(additive only) and runs inside the existing web service — no new Render
service.

Assigning an email from the **Unmatched Emails** queue to a partner now
lets you pick what kind of file it actually is — Newsletter, Survey
Response, Signed Policy, Email Communication, Office Document, or Other
with your own label — the same choices as uploading any file directly,
instead of always filing it as a Newsletter. Newsletter stays the
default, since that's still what most inbound mail turns out to be.

**Trips** (#252) is a major rework of mission trip tracking into full
recruiting/roster/support-raising support, built on the existing
`Trip`/`TripParticipant` models rather than a second, separate concept.
A trip now has a lifecycle (`planning` → `accepting_applications` →
`closed`/`completed`), public or private application links, a per-trip
roster with meeting invites (real calendar `.ics` attachments) and
document requirements, and per-participant support-raising pages with a
manual donor-contribution ledger. Because this reaches well beyond the
old admin-only Trip History/Trip Opportunities pages into public
application forms and outbound email, the existing **Mission trips**
feature flag now defaults **off** (previously on) — a fork relying on
it staying on for its existing trip-logging needs to flip it back on
once after upgrading. Two new settings gate the feature's public-facing
pieces independently: **Public trip discovery** (the public Trip
Opportunities listing/plain application links — a church can run trips
entirely by private link with this off) and two per-church toggles,
_allow private application links_ and _allow public support-raising
links_, each off by default. A restricted partner's trip is excluded
outright from the public discovery page, but a private application
link or support-raising link for one still works — masked, not blocked —
since reaching either already requires a secret only staff chose to
share. Needs one new schema migration (five new tables, several
renamed/added columns on `Trip`/`TripParticipant`/`ChurchSettings`,
including `Trip.tripType` → `Trip.type`).

Anyone can now opt in to email updates on prayer requests, with no
account needed — either for every partner, several at once, or just
one, from a new public **Subscribe** page, or for a single partner
from that partner's own public page (which also points to the
Subscribe page for anyone who wants more than just that one). Each
subscriber picks weekly, biweekly, or monthly, confirms by
email first (a plain double opt-in, no account), and can unsubscribe
anytime from a link in every email — no admin-managed list. Public
digests are prayer-requests only: never a one-time need, never a
newsletter or a link back to one, and a restricted partner's content
stays masked exactly as it already is everywhere else. Off by default,
behind a new **Public prayer digest** feature toggle; also needs
Public Directory and Email (Sending) turned on.

Admins get the same cadence-and-scope choice for the existing
notification digest, replacing the old all-or-nothing "email me the
digest" checkbox — pick weekly/biweekly/monthly and either every
partner or just the ones you follow, from your own Account Settings.
Unlike the public digest, an admin's digest still includes one-time
needs and newsletters, same as before. A new **Prayer Digest
Schedule** section (Settings → Notifications) sets when
these three cadence tiers actually go out — independent of the
existing schedule, which still only governs GroupMe and the original
church-wide email batch. A new **Prayer Digest Subscribers** page
(Settings → Communications) shows how many admins and
public visitors are subscribed, counts only, no email addresses.

A new **System Info** page (Settings, alongside Backups)
shows what's actually running on this instance — app version (plus
the same "update available" check the dashboard banner already does),
Node.js/React/React DOM versions, the Postgres version and database
size, and, when running on Render, the service name, git commit, and
external URL. Useful for confirming what you're on before filing a
bug against a fork, without needing shell access. Admin-only,
enforced server-side like every other admin-only route; never shows a
connection string or any credential.

A restricted partner's photo tile in a Snapshot-layout digest email
showed a blank gap instead of the generic silhouette — most email
clients (Outlook chief among them) strip a `data:` URI out of an
`<img src>`, which is how the silhouette was embedded. It's now served
from a real, reachable URL instead; nothing changes on the public site
itself, where a `data:` URI renders fine.

A restricted partner's prayer request or one-time need notification now
needs an admin's manual review before it's eligible to send at all —
held back from both the manual "Send Pending Notifications Now" button
and the automatic digest schedule until someone confirms it. Structural
masking (name → initials, photo → silhouette, no link back to the
source file) stays exactly as it already was either way; this is
scoped to the body text itself, which previously always sent as a
generic "details are withheld" placeholder with no way to include the
real wording even after a human had checked it for anything
identifying.

Reviewing is also just editing — any queued notification, not only a
held restricted one, can have its text tidied up before it sends, with
no effect on send-eligibility for anything that wasn't held in the
first place. A new **Approve** button clears a held row in one click
without opening the editor, showing the real text in a confirmation
prompt first; the editor's own Save does the same when it's the row
that's being held. A church that would rather automate everything with
nobody reviewing a queue can turn off queuing restricted partners'
events entirely, from a new toggle next to the existing per-type queue
switches — removing what the review requirement would otherwise apply
to.

A missions partner tracker for a single church: who you support, where
they are, what they need prayer for, and what you've given — with a
public-facing directory and map that deliberately shows less than the
admin side does.

What's in it:

- **Partners.** Missionaries and organizations are one record type
  distinguished by `kind`, so everything downstream — trips, support,
  prayer requests, newsletters & docs — attaches the same way for both.
  A partner's page is also its editor: each section saves only its own
  fields, so changing one thing can't quietly overwrite another.
- **A public site that protects people.** Partners marked
  restricted-access appear with their name masked to initials, a
  silhouette instead of a photograph, and a map pin coarsened to a country
  centroid. Every public response goes through one masking serializer that
  no public route can bypass, tested in isolation — and the same masking
  carries through to GroupMe posts and digest emails, not just the public
  site.
- **Prayer requests, monthly support, one-time needs, and trip
  history/opportunities**, each with its own page and its own section on
  a partner's page.
- **Newsletters & Docs.** Upload a newsletter, survey response, signed
  policy, email record, or other office document against a partner,
  picking its kind from one list — reclassify a mis-filed upload the same
  way you'd edit anything else, no delete-and-re-upload required.
- **Optional AI Request Scanning.** Point it at an uploaded file and it
  suggests prayer requests and one-time needs for review — nothing is
  added without an explicit accept. Off by default, and only available at
  all once `ANTHROPIC_API_KEY` is set, since it's the one feature that
  sends file content to a third party.
- **A printable booklet** with six selectable Look & Feel templates
  (Classic, Modern, Traditional, Keepsake, Portfolio, Friendly), an
  optional facing Notes & Prayer page, and a configurable cover/back
  cover — built for handing round on paper.
- **Reports.** Read-only views — birthdays, monthly support, one-time
  needs, prayer requests, trip history, furlough — each filterable, with
  CSV export and a clean print layout.
- **Optional GroupMe notifications.** New prayer requests, one-time
  needs, and newsletters post to their own configured GroupMe Topics,
  along with answered-prayer/decided-need outcomes — queued and sent as a
  batch rather than posting the instant they happen.
- **Optional email**, via Postmark — outbound digests of what's queued,
  and inbound email that auto-files a reply as a newsletter when it
  matches a known partner (anything else lands in an Unmatched Emails
  queue for a quick manual assign). Sending and receiving toggle
  independently.
- **Notification batching**, shared by GroupMe and email: review what's
  queued and send it on a schedule or on demand, with an email digest
  customizable between a plain Classic layout and a Snapshot layout
  (partner photo, "supporting since," short overview) plus your own
  subject-line template and signature.
- **Optional unreached-people-group data.** A partner's public page can
  pull live country statistics from the
  [Joshua Project](https://joshuaproject.net/) — population, primary
  religion, percent evangelical, how reached the country is. Off by
  default; add a free API key and turn it on, no code changes.
- **White-labeling.** Three independently-pickable brand colors plus a
  font choice, and a custom term for "partners" (e.g. "Go Team Partners"
  instead of "Missionaries") used everywhere in the app that would
  otherwise say the hardcoded default.
- **Per-church feature toggles.** Turn off anything a church doesn't use;
  the toggle is enforced on the server, not just hidden in the UI.
- **Accounts with optional two-factor.** Email and password, with TOTP
  that an admin can require per account.
- **One-click deployment on [Render](https://render.com)** with a
  browser-based first-run setup, so standing up an instance needs no shell
  or database access. The blueprint asks for your service name and region
  rather than guessing; `npm run name-instance -- <name> <region>` sets
  both before you deploy. Pick the region deliberately — Render cannot
  change it afterwards without rebuilding the service.

If you're working on a fork, `npm run test:db up` builds a throwaway
Postgres in Docker, migrates and seeds it, so the test suite never touches
a database you care about. See [CONTRIBUTING.md](CONTRIBUTING.md).

Two things worth knowing before you run it:

- **The app refuses to start without a real `SESSION_SECRET`** (32+
  characters, not the example value). Anyone who knows that value can forge
  an admin session, and `.env.example` ships it empty so a fresh copy fails
  loudly rather than looking configured. `npm run generate-secrets` prints
  one.
- **Any account can read every partner's full record**, including
  restricted partners' exact locations and contact details. Roles control
  what someone can _change_, not what they can see. See
  [ADMIN_GUIDE.md § Who can see what](ADMIN_GUIDE.md#who-can-see-what)
  before handing out accounts.
