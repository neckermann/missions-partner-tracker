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

New **WhatsApp notifications** option alongside GroupMe: new prayer
requests, one-time needs, and newsletters (plus a prayer request's
answer and a one-time need's decision) can post to their own groups
inside one WhatsApp community. It runs on the same daily send hour and
the same content-type mutes as GroupMe — a church can run either or both
— and several related items go out together in one message instead of
one post each. Off by default, behind a new **WhatsApp notifications**
feature toggle; set up entirely in the UI (Site Administration →
WhatsApp): link a dedicated phone number with a pairing code or QR code,
pick the community, then pick a group for each notification type.

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

## [1.3.0] - 2026-11-06

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
Schedule** section (Site Administration → Notifications) sets when
these three cadence tiers actually go out — independent of the
existing schedule, which still only governs GroupMe and the original
church-wide email batch. A new **Prayer Digest Subscribers** page
(Site Administration → Communications) shows how many admins and
public visitors are subscribed, counts only, no email addresses.

## [1.2.0] - 2026-11-05

A new **System Info** page (Site Administration, alongside Backups)
shows what's actually running on this instance — app version (plus
the same "update available" check the dashboard banner already does),
Node.js/React/React DOM versions, the Postgres version and database
size, and, when running on Render, the service name, git commit, and
external URL. Useful for confirming what you're on before filing a
bug against a fork, without needing shell access. Admin-only,
enforced server-side like every other admin-only route; never shows a
connection string or any credential.

## [1.1.1] - 2026-11-05

A restricted partner's photo tile in a Snapshot-layout digest email
showed a blank gap instead of the generic silhouette — most email
clients (Outlook chief among them) strip a `data:` URI out of an
`<img src>`, which is how the silhouette was embedded. It's now served
from a real, reachable URL instead; nothing changes on the public site
itself, where a `data:` URI renders fine.

## [1.1.0] - 2026-11-05

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

## [1.0.0] - 2026-11-05

First release.

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
