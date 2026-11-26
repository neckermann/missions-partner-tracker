# 0. Fresh eyes: the blank-page sketch versus the built app
**Status: Draft, not yet verified by the lead reviewer.**
**Reviewed:** branch `dev` at e713437 (0.1.0-beta.3), 2026-11-26.

## Summary

Two agents that had never seen this repo were asked to design a product from the idea alone. Both drew the same thing: a page per person, a short "this week" list that is also emailed, a way to turn a forwarded newsletter into a prayer point, something to hand over on Sunday, and privacy that is safe by default. The built app contains most of the raw material for that product, and in several places it is more careful than the sketch (masking of sensitive workers, contact rules, a review gate before anything is sent). But the care loop the sketch puts at the centre is switched off on a new install, split across three optional features and a settings page, and the home screen is a search box and a menu. Meanwhile about a quarter of the code is a short-term trips product the sketch deliberately left out. The one place the app is less safe than the sketch is the first thing a new church does: the "New Partner" form ticks "Show on public site" for them, and the public directory and map are on by default. My answer to the review question from this angle: not ready to invite churches until new partners start private and the "who needs me this week" view works without setup; the rest is ordering and trimming, not rebuilding.

How to read the findings: each is tagged **Gap** (the sketch asks, the app doesn't answer or answers poorly), **Excess** (the app has it, the sketch never asked) or **Shape** (organised around features rather than people and care). They are ordered most serious first. "The sketch" means the blind sketch (Appendix A) unless I say "first attempt" (Appendix B).

## What the app has today (the facts the findings rest on)

- **Feature switches**: 23 in the registry (`backend/src/utils/features.js`). **On** by default (9): Public directory, Public map, Newsletters & Docs, Prayer requests, One-time needs, Monthly support, Print booklet, Reports, Audit log. **Off** by default (14): Mission trips, Public trip discovery, Email (Sending), Email (Receiving), GroupMe, WhatsApp, Public prayer digest, Contact log, Key-date reminders, Care teams, Support preferences, Partner surveys, AI Features, Joshua Project.
- **Sidebar on a new install** (`frontend/src/components/admin/AdminSidebar.jsx:133-182`): Home, Partners, Newsletters & Docs, Prayer Requests, One-Time Needs, Print Booklet, Reports, Settings. With everything on it grows to 11 items plus Settings, and Settings grows from 5 sub-pages to 14 (`:184-221`).
- **Size** (non-test files, counted with `wc -l`): 58 route files / 11,459 lines in `backend/src/routes/`; 59 pages / 21,179 lines in `frontend/src/pages/`; 66 models in `backend/prisma/schema.prisma`.

## Findings

### F1. Gap: a new partner is public unless the volunteer unticks a box
- **What is wrong**: The sketch says new profiles start private ("New profiles default to church-only"; the first attempt: "Nothing becomes visible by accident"). The database agrees: a partner is not public unless told so. But the "New Partner" form starts with "Show on public site" ticked and "Restricted-access location" unticked, and the public directory and public map are both on by default. A volunteer who clicks Next, Next, Finish has published that person's name, overview, photo (once added) and map pin to anyone on the internet.
- **Where**: `frontend/src/pages/AdminPartnerForm.jsx:32-33` (`isPublic: true`, `isRestricted: false`), step 3 at `:152-188`; `backend/prisma/schema.prisma:20-21` (`isPublic @default(false)`); `backend/src/utils/features.js:18-31` (both public features `defaultEnabled: true`).
- **Who it affects**: missionaries in sensitive places first; then the volunteer, who carries the blame.
- **Evidence**: the form sends `isPublic: values.isPublic` (`:52`); the public list returns every partner `where { isPublic: true, archived: false }` with no login (`backend/src/routes/publicPartners.js:40-42`). There is also no middle setting: a partner is either on the open internet (optionally masked to initials) or staff-only. The sketch's "church-only, behind a shared link" tier does not exist.
- **Severity**: blocks adoption or is unsafe
- **Recommendation**: Start the form with "Show on public site" unticked, and say in one line what ticking it does. Consider (a decision for the owner) shipping Public directory and Public map off, so a church turns the public site on deliberately once it has reviewed who is listed. A "people at our church only" tier (one shared link or passcode) is the sketch's answer to the most common case and is worth an issue of its own.
- **How I know**: read in the code

### F2. Gap/Shape: there is no "this week", and the nearest thing to it is off and takes four setup steps
- **What is wrong**: The sketch's home screen is "who is due for contact, upcoming birthdays, new updates, open needs, this week's prayer focus. A short list, not a dashboard." The app's Home is a greeting, a search box, "Recently viewed", a "Needs attention" block that only appears when something has a count, and a "Browse" grid that repeats the sidebar. On a new install "who do I need to contact" cannot appear there at all, because the feature that computes it (Contact log) is off, birthdays (Key-date reminders) are off, and even once both are on, nothing is counted for a person until an admin has also opened Settings → Partner Care and put that person on the missions team. The first admin created at setup is not on it.
- **Where**: `frontend/src/pages/AdminHome.jsx:201-241`; `backend/src/utils/features.js:151-168` (`contactLog`, `keyDates` both `defaultEnabled: false`); `backend/src/notifications/categories.js:52-63` (counts nothing while the contact log is off or the user owns no partners); `backend/src/utils/ownership.js:23-29`; `backend/src/routes/auth.js:133-140` (first admin created without `onMissionsTeam`); `backend/prisma/schema.prisma:1552` (`onMissionsTeam @default(false)`).
- **Who it affects**: the solo coordinator, every week.
- **Evidence**: Path from sign-in to "who do I contact this week" on a new install: Settings → Enabled Features → turn on Contact log → Settings → Partner Care (a page that only appears after that switch, `AdminSidebar.jsx:191-195`) → add yourself to the missions team → Home. After that it is one click: a "Partners to reach out to" card on Home leads to Partners → "My partners" tab, which is a good list (last contact, follow-up date, next key date, open prayers, open needs: `frontend/src/components/admin/AssignedPartnersTable.jsx:37-107`). So the right view exists; it is a tab on another page, hidden behind setup, and staff "land on All" by design (`frontend/src/utils/partnersTabs.js`). Without the contact log the only answer is Reports → "Last heard from" → run it (`backend/src/reporting/reports/partners.js:287`).
- **Severity**: blocks adoption or is unsafe (it is the product's central promise, "so nobody is forgotten", and a new church cannot see it)
- **Recommendation**: Make the My partners content the Home screen: people to contact, dates coming up, new newsletters, open needs, in that order, each with its action. Turn Contact log and Key-date reminders on by default (both work without email), and treat the first admin, or everyone when no missions team has been chosen, as looking after all partners. Move search to the top bar and drop the "Browse" grid.
- **How I know**: read in the code

### F3. Gap: no weekly email to the coordinator; nothing is emailed at all without a Postmark account
- **What is wrong**: The sketch's weekly rhythm starts with one Monday email ("Two people to contact, Ana's birthday is Thursday, one new newsletter"). The app has no weekly email. The staff digest comes every two weeks at the most frequent (and that tier is off by default), monthly or quarterly; it carries new prayer requests, needs, newsletters and key-date heads-ups, but not the list of people to contact. Key dates have their own daily email. All of it needs Email (Sending), which is off and requires the church to open a Postmark account and add records to its domain's DNS.
- **Where**: `backend/prisma/schema.prisma:1450-1452` (biweekly off, monthly and quarterly on); `backend/src/utils/emailDispatchScheduler.js:39-57`; `backend/src/utils/adminEmailDispatchContent.js:170-180` (content: key dates plus partner updates); `backend/src/utils/features.js:102-109`; `ADMIN_GUIDE.md:721-724`.
- **Who it affects**: the coordinator who will not remember to log in.
- **Evidence**: no code path builds a "people to contact" section for email; the only places the quiet-partner list goes out are the bell/Home card and an optional chat post (`chatDispatchQuietPartners`, default false, `schema.prisma:1404`).
- **Severity**: causes real confusion
- **Recommendation**: One weekly "this week" email per person who looks after partners, with the same content as the Home screen in F2, sent only when there is something in it. This depends on email working without a DNS project, which is the installing/hosting review's subject; a hosted or shared sending address would remove the barrier.
- **How I know**: read in the code

### F4. Excess: short-term trips are about a quarter of the product, for a job the sketch left out
- **What is wrong**: The sketch excludes "short-term trip management, applications and vetting. These are different jobs that would double the product." The app has it all: recruiting, a public application form, teams, meetings and RSVPs, requirements, documents, flights, budgets, contributions, a public support-raising page, wrap-up and debrief. It is off by default, which is right, but it is still carried by every church: in upgrades, in the schema, in the backup, in settings fields, and in the review surface.
- **Where** (files counted): routes `trips.js`, `tripParticipants.js`, `tripMeetings.js`, `tripRequirements.js`, `tripTypes.js`, `settingsTrips.js`, `publicTrips.js`, `publicTripApplications.js`, `publicTripParticipants.js` = 9 of 58 route files, 2,834 of 11,459 lines (25%). Pages matching `*Trip*.jsx` = 16 of 59, 6,216 of 21,179 lines (29%). Schema: 18 of 66 models (the 16 named `Trip*` plus `ApplicationQuestion` and `RequirementTemplateItem`). Plus 8 `backend/src/utils/*rip*` files and 7 trip components.
- **Who it affects**: the owner (maintenance and risk), and any admin who opens Enabled Features and has to work out what "Mission trips" and "Public trip discovery" do.
- **Evidence**: for comparison, the code for the sketch's central job (contact log, care teams, key dates, church visits, furloughs: `contactLog.js`, `careTeams.js`, `keyDates.js`, `partnerCare.js`, `churchVisits.js`, `furloughs.js`) is 756 route lines, and its screens (`AdminContactLog.jsx`, `AdminSettingsPartnerCare.jsx` and six components) 1,866 lines. Trips also reach the partner page of a church that never turned them on: the "Mission Trips" heading and the "Trip Capacity" section are drawn without checking the switch (only the trip list card inside is conditional), `AdminPartnerDetail.jsx:1618-1651`.
- **Severity**: causes real confusion (indirectly: it is where the effort has gone instead of F2 and F3)
- **Recommendation**: A decision for the owner. Options, boldest first: (a) split trips into a separate product or optional module that a church adds; (b) keep it but freeze it, and group it with the other optional areas behind an "Advanced" section of Enabled Features (F8); (c) leave as is. I would not invite churches on the strength of trips until the care loop is the default experience.
- **How I know**: read in the code

### F5. Gap: the congregation gets faces and places, but nothing to pray and nothing to do
- **What is wrong**: The sketch's congregation member wants "a face, a place and one sentence", "something specific to pray this week" and "one concrete thing to do". The public site delivers the first: directory, map, a page per partner with photo, overview, links and a button to the partner's own newsletter. It shows no prayer requests and no needs, has no "I can help" or "send a note" (first attempt), and no link to the church's giving page for a partner (the only giving link in settings is for trip support-raising). The one way for a member to receive prayer points is the Public prayer digest, which is off, needs Postmark, and arrives every two weeks at best.
- **Where**: `backend/src/routes/publicPartners.js:17-26` (what the public pages may load: no prayer requests, no needs); `frontend/src/pages/PublicPartnerDetail.jsx:140-165`; `backend/src/utils/features.js:134-146`; `backend/src/routes/publicSubscribe.js:13` (`biweekly`, `monthly`, `quarterly`); `backend/prisma/schema.prisma:1454-1455`.
- **Who it affects**: the congregation, and so the coordinator's motivation ("nothing to show on Sunday, so the effort stays invisible").
- **Evidence**: prayer requests already carry a "show publicly" flag that is only honoured for "strategic" ones (`schema.prisma:996-1004`), so the safety rule exists; the public page simply doesn't use it. Open needs have no public form at all.
- **Severity**: causes real confusion
- **Recommendation**: Show a partner's public prayer requests on their public page and a "pray this week" block at the top of the directory. Add one church-wide "how to give" link. Treat "I can help" as a later step; it brings spam and follow-up work.
- **How I know**: read in the code

### F6. Gap: "something for Sunday" is a whole booklet, and the copy-and-paste path is hidden
- **What is wrong**: The sketch wants a printable sheet or slide and ready-to-copy text for this week, generated from what is already entered. The app has a Print Booklet (on by default): a full prayer and support directory with templates, printed from the browser. That is a yearly artefact, not a weekly one. There is no single-partner prayer sheet, no slide, and no "this week's prayer focus". The app does have a "copy the updates that are ready" button for churches with no sending channel, but it lives on the Pending Dispatches page, and the sidebar and the Home grid only link to that page when Email, GroupMe or WhatsApp is on, which is exactly when the button is not shown.
- **Where**: `frontend/src/pages/AdminBooklet.jsx:553-568`; `frontend/src/pages/AdminPendingDispatches.jsx:128,232-237`; `frontend/src/components/admin/AdminSidebar.jsx:161-166`; `frontend/src/pages/AdminHome.jsx:136-141`; the feature descriptions that promise it, `backend/src/utils/features.js:36,44,52`.
- **Who it affects**: the coordinator on a default install, and whoever runs the bulletin and the screen.
- **Evidence**: Enabled Features tells the admin "New requests wait on Pending Dispatches, where you can copy what is ready to share", but with all three channels off I found no link to that page in the sidebar or on Home.
- **Severity**: causes real confusion
- **Recommendation**: Show the Pending Dispatches link (under a plainer name such as "Ready to share") whenever there is something waiting, whatever channels are on. Add a one-page "This week's prayer" print view for one partner, reusing the booklet's rendering. A slide image can wait.
- **How I know**: read in the code (the missing link is from reading the two nav builders; I did not click through a running app)

### F7. Gap: forwarding a newsletter by email does not work out of the box, and the excerpt step needs an AI key
- **What is wrong**: The sketch's main way in is "forward the newsletter to a private address and it attaches to the right person, then highlight a sentence as the prayer point". The app can do the first half (Email (Receiving) matches mail to partners and queues the rest under Unmatched Email) but it is off, and turning it on means a Postmark account, an MX record on a subdomain of the church's domain and a webhook URL containing a username and password. The second half is done by AI Features (off; needs the church's own Anthropic API key) or by typing the prayer request by hand. What works on day one is uploading the file on the partner's page.
- **Where**: `backend/src/utils/features.js:110-116,202-210`; `backend/src/routes/inboundEmail.js:86`; `ADMIN_GUIDE.md:735-772`; `backend/src/utils/extraction.js:65-72`.
- **Who it affects**: the coordinator; this is the "double entry" the sketch names as a reason volunteers give up.
- **Evidence**: setup steps as listed in the admin guide; none can be done by someone who does not control the church's DNS.
- **Severity**: causes real confusion
- **Recommendation**: Keep upload as the default and make it fast (drop a file on the partner, type or paste the prayer point in the same dialog). Offer forwarding only where it can work without DNS (a hosted inbound address per church); otherwise keep it in the advanced area. The sketch itself says paste-in is enough for a first version.
- **How I know**: read in the code

### F8. Shape: the app is organised by record type and by switch, not by person and by week
- **What is wrong**: The people in the sketch think "the Okoros: what's new, what do they need, when did we last talk". The sidebar is a list of record types (Partners, Newsletters & Docs, Prayer Requests, One-Time Needs, then Trips, Pending Dispatches, Unmatched Email, Survey Updates, Print Booklet, Reports), and most of what the sketch considers core is presented as 23 optional switches on a settings page, in two groups and three blocks, 14 of them off. A partner's story does live on one page, which is right, but that page is a very long form: Status & Visibility, Photo, Ministry Overview, Our History With Them, Family & Personal, Location & Contact, Sending Church, Links, Care & Follow-up, Communication, Financial, Mission Trips, Trip Capacity. The running timeline the sketch puts first (contact log) sits two-thirds down, and only if switched on.
- **Where**: `AdminSidebar.jsx:133-221`; `backend/src/utils/features.js` (whole file); `frontend/src/pages/AdminPartnerDetail.jsx` (2,334 lines; group headings at `:947, 1101, 1413, 1488, 1580, 1619`); `frontend/src/pages/AdminSettingsFeatures.jsx`.
- **Who it affects**: every non-technical admin; the "jargon, settings pages, or needing the tech person" give-up reason in the sketch.
- **Evidence**: words on screen that are the app's, not the church's: "Pending Dispatches", "Unmatched Email", "Survey Updates", "Enabled Features", "Integrations", "Restricted-access location", "Country Code (FIPS)", "strategic / situational", "cadence", "Guest", "missions team" versus "care team". The Joshua Project switch's description is a paragraph of upgrade instructions (`features.js:215-216`). To the app's credit the church can rename "partners" (`partnerTermSingular/Plural`) and the owner group.
- **Severity**: causes real confusion
- **Recommendation**: (1) Sidebar: Home (this week), People, Share (public site, booklet, ready-to-share), Reports, Settings; put prayer requests, needs and newsletters inside People and Home rather than beside them. (2) Partner page: lead with a summary and the timeline (contacts, newsletters, prayer requests, needs in date order), and fold the record-keeping sections below. (3) Enabled Features: three plain groups, "Caring for partners" (on), "Sharing with the congregation", and "Advanced" (trips, surveys, support preferences, care teams, chat channels, AI, Joshua Project), each switch described in one sentence.
- **How I know**: read in the code

### F9. Gap: no way to start from a spreadsheet, and the way out is not a file a volunteer can open
- **What is wrong**: The sketch promises "paste a list of names to create stubs" or a spreadsheet import, and "a full spreadsheet export is always available" for handover. I found no import of any kind: partners are created one at a time through a three-step form. On the way out there are two things: Reports (on by default) has a "Partner roster" and a "Mailing list" with CSV download, which covers the pastor's question; and the admin-only backup, which is a compressed technical file (`.ndjson.gz`) containing password hashes, restorable only by running a script from a command line.
- **Where**: no import route in `backend/src/routes/` (searched for csv/import/bulk); `frontend/src/pages/AdminPartnerForm.jsx`; `backend/src/reporting/reports/partners.js:226`, `people.js:8`; `backend/src/routes/backups.js:10-22`; `backend/src/utils/backup.js:16`.
- **Who it affects**: a church arriving with 30 partners in a spreadsheet; and the next coordinator.
- **Evidence**: as above. The new-partner form itself is short and sensible (name, country, one line), so entering five partners is fine; entering forty is an evening.
- **Severity**: causes real confusion
- **Recommendation**: Add "paste a list of names" on the Partners page (one name per line, creates private stubs). Add one "Download everything as a spreadsheet" button (partners, family, contacts, support, prayer requests, needs) separate from the backup. Handover of the role itself is already handled well by Manage Users.
- **How I know**: read in the code (absence of import is from searching, so treat as "not found" rather than proven)

### F10. Gap: overdue contact has no "not this season"
- **What is wrong**: The sketch warns against "a guilt machine: an ever-growing red overdue list with no snooze". In the app a partner is "quiet" after a church-wide number of days (default 90, adjustable 7 to 365) with no logged contact, and a partner nobody has ever logged contact for counts as overdue as soon as the feature is on. There is no per-partner rhythm and no way to say "leave them until spring". The closest thing is the optional "reach out again by" date on a contact entry, which adds a second reason to be overdue rather than deferring the first.
- **Where**: `backend/src/utils/contactLogQueries.js:74-98,121` (`quiet: daysSinceContact === null || ...`); `backend/src/utils/careSettings.js:24`; `backend/prisma/schema.prisma:714-715`.
- **Who it affects**: the coordinator in the first week after turning Contact log on: every partner is overdue at once.
- **Evidence**: no snooze, pause or per-partner interval field exists on `Partner` or `ContactLog` (searched the schema).
- **Severity**: causes real confusion
- **Recommendation**: Let a follow-up date in the future postpone the quiet flag, add a per-partner "contact about every…" choice, and on first switch-on start the clock from that day instead of marking everyone overdue.
- **How I know**: read in the code

### F11. Gap: needs record a money decision, not whether someone picked it up
- **What is wrong**: The sketch tracks a need as "open / someone's on it / met". The app's One-Time Need is a requested amount, an approved amount, a date and a decision note: a committee's budget decision. There is no owner and no "met". A non-money need (a laptop, a lift from the airport, a host for a home visit) has to be given a dollar amount, since the requested amount is required.
- **Where**: `backend/prisma/schema.prisma:953-980` (`requestedAmount Int`, `approvedAmount Int?`, `decisionNote`).
- **Who it affects**: coordinator and congregation.
- **Evidence**: model fields as cited; "open" is computed as "no approved amount yet" (`contactLogQueries.js:50`).
- **Severity**: minor
- **Recommendation**: Make the amount optional and add a simple status with a "who is on it" name. Support preferences (off) covers the standing, non-money kind of help and could be folded into the same idea.
- **How I know**: read in the code

### F12. Excess: the rest of the registry, sorted
These are the things the app has that neither sketch asked for. "Earns its place" means it answers a need the sketch has even if it didn't name the feature.

| Feature (default) | Verdict | Reason from the volunteer's side |
|---|---|---|
| Restricted partners: masked names, coarse map pin, review gate before any send | **Earns its place** | This is the sketch's "not be exposed", done more thoroughly than the sketch. |
| Contact rules per missionary (normal / caution / don't contact directly) | **Earns its place** | A real safety need the sketch missed. |
| Contact log, Key-date reminders (both off) | **Earns its place, should be on** | They are the sketch's core loop (F2). |
| Monthly support entries and report (on) | **Earns its place** | "Record commitments, not transactions", exactly as sketched. |
| Print booklet (on) | **Earns its place** | The one Sunday artefact that exists; needs a weekly sibling (F6). |
| Public directory (on) | **Earns its place** | The sketch's congregation page; default should be reconsidered (F1). |
| Public map (on) | **Belongs in an advanced area** | Appealing, but the first attempt left it out because it invites precise locations; the app's coarse pins reduce that risk. Off by default would be safer. |
| Reports hub: 19 reports, saved views, charts, scheduled emails (on) | **Trim** | The sketch wants "one printable annual summary". Roster, Last heard from, Support summary and Key dates earn their place; saved views and scheduled report emails are complexity nobody asked for at this scale. |
| Audit log (on) | **Belongs in an advanced area** | Useful to the owner and for sensitive partners; a solo volunteer never opens it. Keep recording, hide the page. |
| Roles: admin / editor / viewer / guest | **Mostly earns its place** | The sketch wants "coordinator, helper, viewer"; three roles match. Guest is tied to care teams and trips. |
| Care teams and guests (off) | **Belongs in an advanced area** | Fits the sketch's "a missionary their group can adopt", but it asks church members to hold logins, which the sketch says they won't. For a solo coordinator it is pure overhead, and it is why F2 needs a "missions team" step. |
| GroupMe dispatch (off) | **Belongs in an advanced area** | Posting to the church's group chat is the first thing the first attempt would add after copy-and-paste; fine as an option. |
| WhatsApp dispatch (off) | **Complexity nobody asked for** (a decision for the owner) | The app's own description calls it "an unofficial connection"; a dedicated phone number, a session that drops, and a risk of the number being banned are not things a volunteer can manage. |
| Email digests to staff and Public prayer digest (off) | **Earns its place, wrong rhythm** | The sketch's weekly email; here fortnightly at best and gated on Postmark (F3, F5). |
| Email (Receiving) (off) | **Earns its place if it can be made to work without DNS**; otherwise advanced (F7). |
| AI Features: scan newsletters for requests and needs (off) | **Belongs in an advanced area** | Both sketches left AI out for now over sensitive text and wrong words; the app's version only suggests and a person approves, which is the careful form. Needing the church's own API key keeps it advanced. |
| Joshua Project stats (off) | **Complexity nobody asked for** | A second API key and a "Country Code (FIPS)" field to show statistics no job in the sketch needs. |
| Partner surveys (off) | **Belongs in an advanced area** | The sketch says the product "must work with zero effort" from missionaries. A personal link is the gentlest form, but it is a form builder (`surveys.js`, `publicSurveys.js`, `surveyUpdates.js`, 7 schema models, about 1,600 backend lines). |
| Support preferences (off) | **Belongs in an advanced area** | A thoughtful idea (how each partner wants to be helped) that overlaps with needs (F11); a church-edited menu is a settings burden. |
| Template packs | **Belongs in an advanced area** | Sharing settings between forks helps the owner, not the volunteer. |
| Passkeys and passwordless sign-in links, forced two-factor on a new install | **Mixed** | Sign-in links reduce "login trouble", which the sketch fears. But a fresh install requires an authenticator app before the first admin can do anything (`auth.js:142-149`), which is a first-ten-minutes cost for someone who has not used one. Three sign-in methods plus two-factor is about 2,000 lines in `auth.js`, `passkeys.js`, `users.js`. |
| Furloughs, church visits, languages, sending church, emergency contact, links, photo history on the partner page | **Earns its place, lower on the page** | These are the "human details" the sketch asks for; the issue is order, not existence (F8). |
| Mission trips, Public trip discovery (off) | See F4. |

- **Severity** (for the table as a whole): causes real confusion
- **Recommendation**: every removal above is a decision for the owner. The cheap version is F8's regrouping, which needs no removal.
- **How I know**: read in the code (the registry, sidebar and the route/model lists; I did not open every feature's screens)

## Where the built app is right and the sketch is not

- **Sensitive workers.** The sketch offers "hidden with an alias". The app goes further and is right to: masked initials, a region name that is safe to show, coarse map pins, no family data ever loaded on a public request (`publicPartners.js:13-17`), restricted partners held for human review before any send, and a rule against emailing people who must not be contacted directly (`contactReach.js`). The sketch underestimates how many places a name can leak.
- **"A hosted website, one account per church."** The sketch assumes someone runs a service. Nobody does; the owner has chosen fork-and-self-host so each church owns its data. The first attempt admits "who hosts and who pays is something I don't know, and it shapes everything else". The sketch's sign-up-in-one-minute is still the right bar for the installing review to measure against, but it is not a gap in the app's features.
- **Email forwarding as the main way in.** The sketch doubts it itself. Upload on the partner's page is the dependable path and the app has it.
- **Automatic prayer rotation.** The sketch is unsure whether a rotation "feels mechanical". The app instead records when the congregation last prayed for each partner and reports on it (`lastPrayedWithCongregationAt`, the "Last heard from" report). That is a more honest tool; it only needs surfacing on Home.
- **Sending on the church's behalf.** The first attempt would not send to the congregation at all for fear of one wrong send. The app's answer (every channel off by default, a pending queue, review for restricted partners, a person starts every survey send) is a better position than either "never send" or "one click".
- **Roles.** "Viewer by link" is too loose for data that includes children's birthdays and contact details for people in sensitive places. Named logins with three roles is right.
- **Prayer requests kept as a record** (ongoing / answered, with an answer note) and "updates to pass on to partners" (telling a missionary their prayer was answered or need approved) are better than anything in the sketch, and answer the first attempt's "let me know somebody read it and prayed".
- **The new-partner form** asks only for name, country and one line, which is the sketch's two-minute test, apart from the visibility default (F1).

## How the sketches were produced

Two sketches were written before this review by agents given only this idea statement: "A church supports missionaries and mission organizations. It wants to care for them and stay in touch so nobody is forgotten, pray for them, meet their needs and support them financially, and help the whole congregation know them and get involved. The people running this are church volunteers and staff, not technical people, and one person may be doing it alone."

- **Appendix A, the blind sketch (primary).** Written with no repository attached. Its own closing section reports that it used no tools, opened no files, and that nothing in its context described an existing product, codebase or project; it lists the generic session scaffolding it could see and says none of it informed the sketch. This is the one the findings are measured against.
- **Appendix B, the first attempt (contaminated).** This agent did not open the repository, but the project's `CLAUDE.md` was loaded into its context automatically, including the one-paragraph description of the product (public directory and map, admin, prayer requests, one-time needs, newsletters, GroupMe/WhatsApp/email, fork and self-host). It was therefore not blind, despite its opening line. I used it only where it adds a need the blind sketch lacks, and said so: "I can help" and "send a note" on the congregation page (F5), copy-and-paste as the first sharing mechanism (F6), leaving the map out (F12), the self-hosting doubt and the caution about sending (previous section). The two sketches agree on almost everything, which is some evidence that the contamination did not change the shape; note that the contaminated one still left out trips, maps and bulk sending.

A sketch is one opinion written in an hour. Where the two disagree with the app I have tried to say which is right rather than assume the sketch is.

## What I couldn't check, and why

- **Nothing was run.** Every finding is from reading code at e713437. In particular I did not click through a fresh install, so F2's step count, F6's missing link to Pending Dispatches and F1's wizard behaviour should be confirmed in the running app by whoever has one up. For F1, the thing to confirm is that finishing the wizard without touching step 3 creates a partner that appears at `/` while signed out.
- **Trip sections on the partner page with Mission trips off** (F4). From the code the heading and "Trip Capacity" are not conditional, but I did not see the rendered page; an outer condition I missed is possible.
- **Absence claims** (no import, no snooze, no public prayer requests, no per-partner giving link) come from searching the routes, schema and pages for the obvious words. Something under an unexpected name could exist.
- **Installing and hosting.** I read only the README's deploy section (fork on GitHub, Render blueprint, about $13 a month). How that compares to the sketch's "sign up with an email" is for the installing review; I have not judged it here beyond noting the mismatch.
- **Line counts** are raw `wc -l` over non-test files and include comments; they are a size signal, not a measure of effort. The "18 trip models" count includes `TripType`, which describes what kinds of team a partner can host and is arguably partner data.
- **The user guides** (USER_GUIDE.md, ADMIN_GUIDE.md) were used only as a map for email setup; I did not check them against the code.
- **How real churches work.** Both sketches and this report reason from the idea statement. No church has used the app, so which "excess" features a real missions team would miss is unknown.

---

## Appendix A: the blind sketch (complete and unedited)

# Missions care for a church: a blank-page sketch

## 1. The jobs

**Missions coordinator (often alone, a volunteer)**
- "Don't let me forget anyone." Know who we support, when we last had real contact, and who is overdue.
- Remember the human details: kids' names, birthdays, home-visit dates, what they asked prayer for last time.
- Turn the newsletters landing in their inbox into something the congregation actually sees.
- Know what each person needs right now and whether anyone picked it up.
- Answer the pastor or elders in two minutes: who do we support, for how much, since when, and how are they doing.
- Hand it all over when they step down, without it living in their head and inbox.

**Missionary or organisation contact**
- Be known and remembered without extra work. They already write to many churches and will not adopt another login.
- Have a need heard and answered, not lost.
- Not be exposed: some serve where a public name and photo is dangerous.

**Congregation member**
- "Who are these people?" A face, a place and one sentence.
- Something specific to pray this week.
- One concrete thing to do: write a card, meet a need, host them on a home visit.

**Pastor, elders, small-group and children's leaders**
- Something ready for Sunday: a slide, a bulletin paragraph, a prayer point.
- A yearly overview for budget decisions.
- A missionary their group can "adopt".

## 2. The smallest product

A hosted website, one account per church, with four things:

1. **People**: one page per missionary or organisation, holding photo, location, a one-sentence summary, family, key dates, the support commitment (amount, start date, review date), a sensitivity setting and a running timeline.
2. **This Week** (the home screen): who is due for contact, upcoming birthdays, new updates, open needs and this week's prayer focus. It is a short list, not a dashboard.
3. **Updates and needs**: each church gets a private email address. The coordinator forwards a newsletter to it and it attaches to the right person. They highlight a sentence or two as the prayer point, and can add needs with an "open / someone's on it / met" status.
4. **Share**: a congregation page that needs no login, a weekly prayer email people can subscribe to, and a printable sheet or slide. All are generated from what is already entered.

**Money.** I would record commitments, not transactions. Each profile gets a "how to give" link to wherever giving already happens.

**Sensitive workers.** Each profile is set to public, church-only (behind a shared link), or hidden with an alias and no photo or location. New profiles default to church-only.

**First ten minutes**
1. Sign up with an email address and the church name. There is nothing to install.
2. Add the first missionary with name, photo, location and one sentence, or paste a list of names to create stubs.
3. Choose a contact rhythm; the default is quarterly.
4. See This Week populated.
5. Print or share the first prayer sheet.

The test is whether they leave with something usable this Sunday.

**A normal week (about 15 minutes)**
- A Monday email arrives: "Two people to contact, Ana's birthday is Thursday, one new newsletter, prayer focus is the Okoros."
- The coordinator writes to them from their own email or WhatsApp, then taps "I was in touch" and adds a line.
- They forward any newsletters and approve the weekly prayer email, which is pre-drafted and sent with one click.

**Getting it.** The church signs up on a website. I would price it free for small churches or at a flat low rate, never per user, because volunteers cannot get per-seat costs approved. A full spreadsheet export is always available.

**Where I'm unsure**
- Whether churches would rather have this inside their existing church management system.
- Whether email forwarding works for people whose missionaries mostly use WhatsApp.
- Whether rotating the prayer focus automatically is welcome or feels mechanical.

## 3. Left out of version one, on purpose

- **Donation processing and accounting.** It is regulated, the church's finance tools and the agencies already do it, and one error destroys trust.
- **Missionary logins or a portal.** They will not use it, and the product must work with zero effort from them.
- **In-app messaging.** Relationships live in email and WhatsApp, so the product logs contact rather than hosting it.
- **Native mobile app.** A phone-friendly website is enough and avoids app-store friction.
- **Integrations with church management systems.** There are too many, and a spreadsheet import covers the start.
- **Fine-grained roles.** Coordinator, helper and viewer by link is enough.
- **Short-term trip management, applications and vetting.** These are different jobs that would double the product.
- **Custom fields and report builders.** A notes box and one printable annual summary cover it.
- **AI-written updates or prayers.** There is a risk of putting words in a missionary's mouth or leaking sensitive detail, though I would revisit suggested excerpts later.

## 4. What makes a volunteer give up

- Setup that demands complete data before anything useful appears.
- Double entry: retyping what is already in a newsletter or spreadsheet.
- A guilt machine: an ever-growing red "overdue" list with no "snooze" or "not this season" option.
- Anything that requires the missionaries or the congregation to create accounts.
- Nothing to show on Sunday, so the effort stays invisible and feels pointless.
- A privacy scare: a sensitive worker's name appearing somewhere public.
- Jargon, settings pages, or needing "the tech person".
- A per-user price or anything that needs committee approval to start.
- No way to hand it over, or a fear that the data is trapped.

## What I could see

**(a) Tools and files.** I used no tools and opened, listed, searched or read no file, directory, repository or web page.

**(b) Other context.** Nothing in my context described an existing product, codebase or project. There were no project instructions, no memory and no repository name. Beyond this message, I could see only generic session scaffolding:
- A working directory of `/home/user`, marked as not a git repository, and a scratchpad path.
- The account email address.
- A session link for commit attribution.
- Lists of generic tools, skills and agent types, including a documents connector.
- A note that `api.render.com` (a hosting service) is a connected host.

None of that informed the sketch.

---

## Appendix B: the first-attempt sketch (complete and unedited; this agent had the project CLAUDE.md in its context, so it was not blind)

# Fresh-eyes sketch: caring for a church's mission partners

Written from the idea alone, with no knowledge of anything that has been built.

**The thing it must beat:** a spreadsheet, the missions lead's inbox, and a paragraph in the bulletin. That costs nothing and needs no setup. Any product has to be less work than that in week one, not only better in month six.

## 1. The jobs

**The missions lead** (volunteer or staff, often alone, often on a phone in spare evenings)
- "Tell me who we support, in one place, so it isn't only in my head and my inbox."
- "Don't let me forget anyone." The quiet partner who never writes is the one who gets dropped.
- "When a newsletter arrives, let me do something with it in two minutes": pull out what to pray for and what they need, and pass it on.
- "Give me something to hand over on Sunday": a prayer point, a slide, a bulletin paragraph, without rewriting it each week.
- "When someone needs something, let me find a person to meet it and know it was met."
- "Let me answer the elders": who do we support, how much have we committed, when did we last hear from them.
- "Let me hand this to the next person without losing everything."

**The missionary or organisation**
- "Don't give me another job." They already write one newsletter to thirty churches. They will not log in to a portal for each one.
- "Let me know somebody read it and prayed." Silence from supporting churches is the normal experience.
- "Let me ask for something specific without it being awkward."
- "Don't put me in danger." Some work where a name, photo or town on a public web page is a real risk. I think this is the most important constraint in the whole idea.

**The congregation member**
- "Who are these people?" Faces, where they are, what they do, in thirty seconds.
- "What do I pray for this week?" One or two things, not a wall of text.
- "Is there something I can actually do?" A specific need, a card to write, a visit to host.
- All of it without an account or an app, through whatever the church already uses (email, group chat, bulletin, Sunday screen).

**Pastor and elders**
- Something ready to pray from the front.
- Confidence that the church's commitments are being kept and nobody has been dropped.

**Small-group or prayer-team leaders**
- "Give my group a partner to adopt and this week's prayer points for them."

**Treasurer**
- Already sends the money through the church's own books. Wants nothing from this tool except not to be asked to enter things twice.

## 2. The smallest product that does those jobs

A hosted website the church signs up for with an email address. It has three parts.

### A. A page per partner (private to the missions team)
- Photo, names, where (as vague as they need), one sentence on what they do, how to reach them, what the church has committed (a plain text field such as "$200/month since 2021", not a ledger).
- A simple timeline: updates received, prayer requests, needs, and "I contacted them" notes.
- Two dates shown prominently: **last heard from** and **last contacted by us**.
- A **who can see this** setting with three choices: missions team only, our congregation, anyone. It defaults to team only. Nothing becomes visible by accident.

### B. "This week" (the lead's home screen, also sent as one email)
A short list, not a dashboard:
- Partners overdue for contact (default: every three months, changeable per partner), with a "mark as contacted" button and a note field.
- New updates waiting to be read and turned into a prayer point.
- Open needs and who has offered to help.
- **This week's prayer focus**: one partner, rotated automatically so every partner is prayed for across the year. It comes with ready-to-copy text, a printable sheet, and a slide image for Sunday.

The rotation matters as much as the reminders. "Nobody is forgotten" covers both contact and prayer, and a rotation removes the weekly decision of whom to feature.

### C. The congregation page (one link, no login)
- Faces and one-line descriptions of the partners marked visible.
- This week's prayer focus at the top.
- Open needs, each with an "I can help" button that asks for a name and contact and tells the lead. No payment happens here.
- "Send a note of encouragement", which goes to the lead to pass on (or straight to the partner if they agreed).
- A link to the church's existing giving page.

### Getting information in
This is the part I'm least sure of and the part that decides whether the tool stays alive.
- **First choice:** the lead forwards a partner's newsletter to a private address and it lands on that partner's timeline. Forwarding email is something everyone already knows how to do.
- **Fallback:** paste the text in.
- **For partners:** a personal link (no account, no password) where they can post a prayer request or a need in one box.

If email forwarding proves too hard to build reliably, paste-in is enough for a first version.

### Getting information out
The product makes the content. The church's existing channels deliver it. Every prayer focus and need has "copy text", "copy link", "print" and "download slide". The lead pastes it into the church email, group chat or bulletin. I would not build direct sending to the congregation at first (see section 3).

### First ten minutes
1. Sign up with an email and the church's name. No other questions.
2. "Add your first partner": name, photo (optional), country, one sentence, email. Under two minutes. Or paste a list of names and fill in the rest later.
3. Choose who can see them. The screen explains the three choices in one line each, with a plain warning about sensitive locations.
4. Add two more.
5. The product shows the congregation page with those partners on it and a link to share, plus a first prayer slide.

At ten minutes the lead has something they could show the pastor. No settings screen has appeared.

### A normal week (target: fifteen minutes)
- Monday email: "Two partners you haven't contacted since August. One new update from the Garcias. One open need. This Sunday's prayer focus is the Okafors."
- The lead reads the update, picks or edits two prayer points, approves them.
- Sends one overdue partner a short message from their own email or phone, then taps "contacted".
- Copies the prayer focus into the bulletin and sends the slide to whoever runs the screen.

### How a church gets it
For this audience it has to be a hosted service: sign up, use it. Someone who has never heard of an environment variable cannot install or run software, and should not be asked to. If the only way to offer it is "run it yourself", then honestly the first version needs a technical friend for each church, and the real product becomes a one-click setup with someone to call. Who runs and pays for hosting is something I don't know, and it shapes everything else.

## 3. Left out of a first version, on purpose

| Left out | Why |
|---|---|
| Taking donations or payments | The church already has a giving system and a treasurer. Handling money adds legal, tax and trust burdens that would dwarf the rest. Link to the giving page instead. |
| A giving ledger or budget reports | It means double entry with the church's books. One text field for the commitment is enough for the elders' question. |
| Accounts for congregation members | Every login is a barrier, and password resets land on a solo volunteer. One link, plus an optional shared passcode. |
| Logins or a portal for partners | They won't use one more portal. Personal links and forwarded email cover it. |
| Sending email or texts to the whole congregation | The church already has a mailing tool and a group chat. Sending in bulk on their behalf risks one wrong send that ends trust in the tool. Copy and paste first. I'm unsure here: if pasting proves to be the step people skip, posting straight to one group chat would be the first thing I'd add. |
| A world map | Appealing, but it invites precise locations for people who may need to stay vague. Country names are enough. |
| Short-term trips, events, home-visit scheduling | A different job with its own complexity. |
| Roles and permissions beyond "team member" | One or two people run this. Invite a helper by email; that is all. |
| Custom fields, tags, categories | A settings burden on someone who wants a list of people. |
| Automatic summarising of newsletters | Tempting, since it is the tedious step. But it puts sensitive text through another system and can put wrong words in a partner's mouth. Worth revisiting once the basics work, always with the lead approving. |
| A phone app | The website must work well on a phone. An app store adds nothing. |
| Multiple languages, multiple campuses, denominational roll-ups | Unknown demand; none of it helps the solo lead. |

## 4. What would make a volunteer give up

- **Setup that needs a technical person**, or any screen with words they have never seen.
- **An empty screen and a long form.** If the first partner takes more than two minutes, or twenty partners must be entered before anything useful appears, they stop.
- **Double entry.** If they still need the spreadsheet as well, the spreadsheet wins.
- **Reminders that turn into guilt.** A growing red "overdue" list gets avoided. Reminders need to be few, forgiving, and easy to snooze.
- **Accidentally exposing a partner.** One incident of a sensitive name appearing publicly and the tool is finished at that church, rightly.
- **Anything sending to people unexpectedly.** Fear of "did that just go to the whole church?" makes people stop clicking.
- **No visible response.** If they post prayer points for two months and cannot tell whether anyone looked or helped, the effort feels pointless. Showing "12 people opened this, 2 offered to help" may matter more than any feature. Equally, partners need to hear back that they were prayed for.
- **Words that aren't theirs.** Churches say "missionaries", "global workers", "partners". Being unable to change the word makes it feel like someone else's tool.
- **Login trouble**, their own or anyone else's.
- **Nobody to ask when something breaks**, and no way to get their information out as a simple file.
- **It can't be handed over.** If the knowledge lives in one person's account and they step down, the church starts again from nothing.
- **Cost that needs committee approval** before they have seen it work.

## Where I'm unsure

- **Size.** Five partners and forty partners are different problems. This sketch aims at roughly five to thirty.
- **How many partners are in sensitive places.** If most are, the congregation page needs a passcode by default and the "anyone" setting may not be worth offering.
- **Whether the congregation will visit a page at all.** My bet is no, which is why the outputs are things to paste elsewhere. If I'm wrong, the page deserves more investment.
- **Whether the church already has a member database.** If so, some will ask for a connection. I'd still leave it out at first.
- **Who hosts and who pays.** Unknown, and it decides whether "sign up and use it" is achievable.
