# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/): given a
version `MAJOR.MINOR.PATCH`, `MAJOR` marks breaking changes (a data
migration you must run, an env var that's now required, etc.), `MINOR`
marks new features that are safe to pull in without extra steps, and
`PATCH` marks fixes.

If you maintain a fork, check this file when you pull in a new release —
see [UPGRADING.md](UPGRADING.md) for the actual update steps.

## [Unreleased]

### Security
- A Trip Leader scoped guest account could still read the full Pending Dispatches queue (`GET /api/dispatches/pending`) — the exact text about to go out for every partner/trip/prayer request/one-time need churchwide, unfiltered and not attached to any one trip. Excluded entirely, same `requireRole("admin", "editor", "viewer")` pattern as #329's inbound-email-queue fix (there's no sensible trip-scoped version of this queue). No database migration. (#350)
- A Trip Leader could re-point their own trip's `partnerId` at any partner via `PUT /api/trips/:id` (the full field set was written straight through with no per-role filtering), then use that attacker-controlled `partnerId` to pass the partner-scope check on every partner-scoped read — the full record of a partner they were never meant to see, restricted partners included. Blocked: a Trip Leader's update is now rejected outright if it includes `partnerId`. (#327 Finding 2)
- `GET /api/trips?partnerId=` returned every trip belonging to that partner, full participant rosters (dates of birth, guardian/emergency contacts) included, when a Trip Leader's own partner had more than one trip on file — not just their own. Now scoped to exactly their own trip, regardless of the `partnerId` query. (#327 Finding 2)
- `GET /api/settings/trips` and `GET /api/scoped-digest/summary` were reachable by a Trip Leader with no role check beyond being logged in — neither has a legitimate use for that role (church-wide trip configuration and a cross-church subscriber-count summary). Excluded. (#327 Finding 2)
- `PUT /api/trips/requirements/:id/participants/:participantId/complete` never checked that `:participantId` actually belonged to the requirement's own trip — a Trip Leader scoped to one trip could mark a different trip's participant complete against one of their own trip's requirements, given a leaked participant id. Fixed by validating the participant belongs to the requirement's trip before proceeding. (#327 Finding 3; the IDOR's other instance, `POST /:tripId/participants/:id/request-documents`, no longer exists — removed along with the trip document-request feature.)
- An unauthenticated caller could fill the database and exhaust memory on several public routes: the global JSON body limit was 15mb for every route (for the sake of one webhook), every string on the public trip-application schema was unbounded with no cap on how many custom-question `responses` a submission could carry, and the public document-upload route buffered up to 15mb into memory before even checking whether the caller had a valid access token. Fixed: the global body limit is now 100kb, with scoped 15mb/7mb exceptions for the three routes that genuinely carry a large payload (the Postmark webhook, and the two base64-image routes); every public application field now has a `.max()`; the two apply routes got a dedicated 10-per-15-minutes-per-IP limiter and a honeypot field; the upload route's access token moved from the request body to the query string so it's verified before the file upload middleware ever runs; a bad-credentials request to the inbound-email webhook no longer writes a database row. (#327 Finding 4)
- A session token kept working for its full 8-hour lifespan regardless of what happened to the account afterward — logging out only cleared the cookie, never the token itself, so a password change, an admin-set password reset, an MFA change, or a role change left every previously-issued session still valid. Added `User.sessionVersion`, embedded in the session token and checked against the row on every request; bumped on password change (self-service and admin reset), MFA enable/disable (self-service and admin-forced), and role change — deliberately **not** on logout, which stays scoped to the one cookie/browser it represents rather than silently signing a user out of every other device. The self-service routes (password change, MFA disable) re-issue a fresh cookie in the same response, so the tab making the change keeps working; only sessions opened elsewhere are the ones actually invalidated. Requires `npx prisma migrate deploy` (new `sessionVersion` column, default 0 — no other migration steps needed). (#327 Finding 7)
- Two smaller fixes from the same pass: production access logs no longer write a usable `token` query-string value in plain text (Postmark/subscribe-link/trip-participant tokens all redacted to `[REDACTED]`); the trip-participant self-service access token (opens a minor's record, donor contact info, flights, and documents) had no expiry at all before this — now expires at the trip's own end date + 90 days (falling back to a flat 1 year when trip dates aren't available, never infinite), re-issuable through the existing lost-link recovery flow if it's ever actually needed again. (#327 Finding 6, partial — the remaining items, converting a few state-changing GET links to a click-to-confirm POST flow and moving `password-setup/validate`'s token off the query string, are still open.)
- A matching partner's email address alone used to be enough to auto-file an inbound email as that partner's newsletter and broadcast it to GroupMe/WhatsApp/the digest — `From` is trivially forgeable, so anyone who knew a church's inbound address and one partner's email could put a forged document under that partner's name and have it announced unreviewed. Now also checks Postmark's own SPF/DKIM signals (`Received-SPF`, and `X-Spam-Tests`'s `DKIM_VALID` token as a secondary signal) before auto-filing; a single match whose sender doesn't verify is queued for review instead, labeled "Sender not verified" in the Unmatched Emails queue rather than silently guessed. Requires `npx prisma migrate deploy` (new `InboundEmail.queueReason` column, nullable — no other migration steps needed). (#327 Finding 5)

## [0.4.0] - 2026-11-23

### Added
- A **Log Contributions** tab on the Trips page lets an admin/editor log a trip contribution for any trip and any team member from one place, instead of navigating into each trip's own Financial tab one at a time — built for working through a stack of checks for several trips/people in one sitting. Same backend endpoint and data shape as the existing per-trip form; the Trip selector stays sticky after each save, and a running "Logged this session" list shows what's been entered so far. Reachable whenever Trips is enabled — unlike the per-trip Financial tab, it does *not* require Trip budgeting to be turned on, since logging a gift that came in doesn't depend on having set a planned budget. (Originally a standalone sidebar item gated on Trip budgeting; moved under Trips as a tab and regated to just the Trips feature.) (#272)
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
*allow private application links* and *allow public support-raising
links*, each off by default. A restricted partner's trip is excluded
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
  what someone can *change*, not what they can see. See
  [ADMIN_GUIDE.md § Who can see what](ADMIN_GUIDE.md#who-can-see-what)
  before handing out accounts.
