# SPEC.md

**Last verified**: 2026-11-23 · **Owner**: @neckermann

As-built specification of missions-partner-tracker, derived directly from
the current code (not from design docs, plans, or memory of intent). This
is an audit baseline for evaluating a future rewrite/redesign — precise
enough to diff against a later version when deciding what to keep,
change, or replace.

This document does not duplicate [CONTRIBUTING.md](CONTRIBUTING.md) (dev
workflow, testing, shipping pipeline, screenshot discipline),
[ADMIN_GUIDE.md](ADMIN_GUIDE.md) (operator-facing feature docs), or
[USER_GUIDE.md](USER_GUIDE.md) (end-user docs). It describes what exists
and how the pieces fit together, not how to work on it or how to use it.

## 1. Data model

One Postgres database (`backend/prisma/schema.prisma`), accessed only
through Prisma. Pre-1.0: every schema change is squashed into a single
baseline migration (`backend/prisma/migrations/20261122092854_init/`)
rather than accumulating a migration history.

### 1.1 Core entity: Partner

`Partner` is the one record type for both missionaries and local/national
partner organizations, distinguished by `kind` ("missionary" |
"organization"). It was two separate models (`Missionary`/`Organization`)
through v1.7.0; they shared 36 fields and ~160 call sites branched on
which one they held. Merging made `partnerId` a single non-nullable FK
everywhere, turning "exactly one parent" from an application rule into a
database guarantee.

Key fields beyond the obvious:

| Field                         | Purpose                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isPublic`                    | Shows on the public site at all.                                                                                                                                                                                                                                                                                                                                      |
| `isRestricted`                | When combined with `isPublic`: masked to a generic, anonymized view on the public site and in every dispatch (see §7).                                                                                                                                                                                                                                                |
| `archived` / `archivedAt`     | Soft delete — hides from admin lists, forces `isPublic` off, zeros monthly support via a new `$0` `SupportEntry` (history is never edited). Hard delete is only permitted once archived.                                                                                                                                                                              |
| `sentByOurChurch`             | Missionary-only: true when _this_ church (`ChurchSettings`) is the sending church. Distinct from the `SendingParty` relation, which records whichever church actually sends them.                                                                                                                                                                                     |
| `contactLevel`                | Missionary-only: how careful to be when reaching them. `normal`; `caution` (reachable, follow `contactInstructions`, and only the `contactChannels` ticked when any are); `no_direct` (their number, email and actions are hidden, replaced by who to go through, `contactViaName`/`Role`/`Phone`/`Email`, and the instructions). An organization is always `normal`. |
| `overview` vs `overviewShort` | Long-form narrative vs. a one/two-line summary for list/card contexts.                                                                                                                                                                                                                                                                                                |
| `fieldDisplayName`            | A public-safe location label ("Northern Uganda") independent of the precise address — safe to show even when restricted.                                                                                                                                                                                                                                              |

Collections are independent resources with their own CRUD endpoints, never
written as a nested array on a `Partner` update — doing so would delete
and recreate every child row on each save, churning ids and destroying
rows added concurrently through their own endpoint.

### 1.2 Entity relationship summary

```
Partner (missionary | organization)
├── Adult[] / Child[]                  missionary-only household members
├── Address[]                          at most one per type: "physical" | "mailing"
├── Trip[] (via TripParticipant)       trips (planning → accepting_applications →
│                                       closed/completed) this partner's team visits —
│                                       see "Trips" below, not just a historical log
├── Furlough[]                         missionary-only, time off-field
├── ChurchVisit[]                      partner visiting this church (reverse of Trip)
├── ContactLog[]                       every touchpoint with the partner: call, text, visit, card… (#288, §5.3)
├── SendingParty[]                     missionary-only, "church" | "org", who sent them
├── PartnerLink[]                      external links (website, social, support page, ...)
├── PartnerLanguage[]                  languages spoken on the field
├── SupportEntry[]                     monthly-support ledger (append-only history)
├── SupportNeed[]                      one-time financial need + decision
├── PrayerRequest[]                    ongoing/answered prayer content
├── PartnerFile[]                      newsletters/documents, bytes stored in-row
├── Photo[]                            full upload history, bytes stored in-row
├── DispatchRecord[]                   recorded dispatch-system events
├── UserFollowedPartner[]              admin digest scoping (join row)
└── PublicSubscriberPartner[]          public digest scoping (join row)
```

**Trips** (#252 rework) is its own cluster of models, not just a child of
`Partner`: `TripType` (per-church customizable trip categories) →
`Trip` (lifecycle `planning`/`accepting_applications`/`closed`/
`completed`; public or private application links; `type` — renamed from
`tripType` to avoid stuttering against `SendingParty.type`/
`PartnerLink.type`/`TripType.type`) → `TripApplication` (public
applications awaiting review) and `TripParticipant` (the roster, with
`TripParticipantPhoto[]`) → `TripMeeting`/`TripMeetingRsvp` (meeting
invites with calendar `.ics` attachments and Yes/No/Maybe responses),
`TripRequirement`/`TripRequirementStatus` (per-participant document/task
tracking), `TripDocument`/`TripDocumentBytes` (uploaded documents, bytes
stored in-row like `PartnerFile`), `TripContribution`/`TripBudgetLine`
(the donor-contribution ledger and budget), `TripFlightSegment`
(multi-segment itineraries per participant).

**Reports** adds two of its own tables, independent of `Partner`:
`SavedReport` (a saved set of filters for one report, private or shared)
and `ReportSchedule` (recurring report emails — weekly/monthly/quarterly
— off one `SavedReport`).

**Users/auth** adds `PasswordSetupToken` (the welcome-email "choose your
password" link — single-use, only a hash stored, 72h/7-day expiry) and
`NotificationSeen` (per-user read/unread state for in-app notices,
unrelated to the dispatch system's `DispatchRecord` despite the similar
name), `TripAccess` (a guest login's grant on one trip, §5.1) and
`CareTeamMember` (a login's seat on one partner's care team — at most one
lead per partner, enforced by a hand-added partial unique index as well as
in `routes/careTeams.js`; §5.1) and `ContactLog` (one touchpoint with a partner,
§5.3) and `KeyDateReminder` (one key-date email sent to one person, §5.4) and
`SupportOption` (one entry in the church's editable menu of ways to support a partner) and
`PartnerSupportPreference` (one partner's response to one option — real columns:
`selected`, `choice`, `choices`, `other`, `text`, `note` — §5.7).

**WhatsApp dispatch** adds `WhatsAppAuthEntry` (the encrypted linked-
session store — see §6.2a).

`InboundEmail` has no relation to `Partner` at all — it exists
specifically to hold mail that couldn't be auto-matched, and either
outcome (assign, discard) deletes the row.

### 1.3 Notable modeling decisions

- **File bytes live in Postgres**, not an object store (`PartnerFile.bytes`,
  `Photo.bytes`, `InboundEmail.bytes`, `ChurchSettings.logoBytes`).
  Justified in-schema as fine at this app's scale (one church's files, not
  a multi-tenant media library) and relying on TOAST to keep large values
  out-of-line. Every list/detail query explicitly omits `bytes`; the real
  bytes are reachable only through a dedicated download/raw route.
- **No native Postgres enums.** Every "enum-like" field (`Partner.kind`,
  `User.role`, `PartnerFile.kind`, `Trip.albumProvider`,
  `SendingParty.type`, `DispatchRecord.type`, `PrayerRequest.status`/
  `category`) is a plain validated `String`. Deliberate: a fork can add
  its own value without a migration.
- **No "current" column for history that's really a ledger.** "Current
  monthly support" is the latest `SupportEntry` by `effectiveDate`;
  "current photo" is the latest `Photo` by `receivedDate` (not upload
  time); "last visit" is the latest `ChurchVisit`. Corrections are new
  rows, not edits to old ones.
- **One nullable field instead of two that could disagree.** `User.cadence`
  (null = not subscribed, else which tier), `DispatchRecord.dispatchReviewedAt`
  (null = never reviewed), `PublicSubscriber.confirmedAt` (null = never
  confirmed) — each replaces what used to be (or could have been) a
  boolean + a value that might contradict each other.
- **"Last edited by" is stamped centrally, not per route (#341).** The
  old `createdById`/`updatedById` pair existed only on `Partner` because
  per-route stamping was inconsistently populated, and half-populated
  provenance was judged worse than none. It is now one Prisma client
  extension (§5.6), so it cannot be half-populated. `Partner.createdById`/
  `updatedById` remain for their existing uses.

## 2. Backend architecture

Express app (`backend/src/server.js`), one process, serving both the API
and the built frontend (see §8). No horizontal scaling today — the
in-process cron scheduler (§6) is written with that assumption explicit.

### 2.1 Middleware stack (in order)

1. `helmet()` — CSP widened only for map tile hosts (`img-src`); custom
   `Referrer-Policy: strict-origin-when-cross-origin` (required by
   OpenStreetMap's tile usage policy).
2. `morgan` request logging.
3. `express.json({ limit: "15mb" })` — raised globally because Postmark's
   inbound-email webhook body is the whole email, base64, attachments
   included.
4. `cookieParser()`.
5. Path-scoped `express-rate-limit` instances: login, MFA verify/disable/
   change-password, `/api/public/*` (120/min, generic abuse-blunting),
   `/api/backups` (5/15min), AI-extraction (`30/15min`, real billable
   cost), the inbound-email webhook (60/15min, Basic-Auth brute-force
   surface).
6. Route mounts (§2.2).
7. `/api/*` catch-all → 404 JSON (prevents an unmatched API path from
   falling through to the SPA's `index.html` with a 200).
8. Static frontend build + SPA catch-all.
9. `errorHandler` (middleware/errors.js) — single place every thrown
   error becomes an HTTP response; see §2.4.

### 2.2 Route inventory

| Mount                      | File                                                                                                                                               | Gating                                                                                                                       | Owns                                                                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth`                | `auth.js`                                                                                                                                          | mixed (see §5)                                                                                                               | setup, login, MFA, password change, digest-email self-service, unsubscribe link, logout                                                                                                                                               |
| `/api/partners`            | `partners.js`                                                                                                                                      | session (any role)                                                                                                           | Partner CRUD, photo upload, archive/unarchive/delete, sync-sending-church                                                                                                                                                             |
| `/api/public/partners`     | `publicPartners.js`                                                                                                                                | open                                                                                                                         | masked public partner list/detail                                                                                                                                                                                                     |
| `/api/users`               | `users.js`                                                                                                                                         | admin only                                                                                                                   | user management, plus a guest's trip access grants (`/:id/trip-access`, `/by-trip/:tripId`) and the `?inactive=true` filter (§5.1)                                                                                                    |
| `/api/public/country-info` | `countryInfo.js`                                                                                                                                   | `joshuaProject` feature                                                                                                      | Joshua Project proxy                                                                                                                                                                                                                  |
| `/api/support-needs`       | `supportNeeds.js`                                                                                                                                  | session                                                                                                                      | one-time need CRUD                                                                                                                                                                                                                    |
| `/api/support-entries`     | `supportEntries.js`                                                                                                                                | session                                                                                                                      | monthly-support ledger                                                                                                                                                                                                                |
| `/api/prayer-requests`     | `prayerRequests.js`                                                                                                                                | session                                                                                                                      | prayer request CRUD                                                                                                                                                                                                                   |
| `/api/adults`              | `adults.js`                                                                                                                                        | session                                                                                                                      | missionary household adult CRUD                                                                                                                                                                                                       |
| `/api/children`            | `children.js`                                                                                                                                      | session                                                                                                                      | missionary household child CRUD                                                                                                                                                                                                       |
| `/api/furloughs`           | `furloughs.js`                                                                                                                                     | session                                                                                                                      | furlough CRUD                                                                                                                                                                                                                         |
| `/api/church-visits`       | `churchVisits.js`                                                                                                                                  | session                                                                                                                      | church-visit CRUD                                                                                                                                                                                                                     |
| `/api/partner-links`       | `partnerLinks.js`                                                                                                                                  | session                                                                                                                      | partner external-link CRUD                                                                                                                                                                                                            |
| `/api/partner-languages`   | `partnerLanguages.js`                                                                                                                              | session                                                                                                                      | partner language CRUD                                                                                                                                                                                                                 |
| `/api/trip-types`          | `tripTypes.js`                                                                                                                                     | session                                                                                                                      | per-church trip category CRUD                                                                                                                                                                                                         |
| `/api/trips`               | `trips.js`, `tripMeetings.js`, `tripRequirements.js`, `tripParticipants.js`                                                                        | session, `requireTripScope`/`requirePartnerQueryScope` for `guest` (§5.1)                                                    | trip CRUD + lifecycle, roster/participants, meeting invites + RSVPs, document requirements, budget lines, flight segments, contribution ledger                                                                                        |
| `/api/public/trips`        | `publicTrips.js`, `publicTripApplications.js`, `publicTripParticipants.js`                                                                         | open, gated by `trips` + per-church `allowPrivateApplicationLinks`/`allowPublicSupportRaisingLinks`/public discovery toggles | public Trip Opportunities listing, public application form, participant support-raising/self-service pages                                                                                                                            |
| `/api/care-team`           | `careTeams.js`                                                                                                                                     | session; `careTeam` feature (404 off); set = admin/editor                                                                    | a partner's care team: get, replace (lead + members), candidates (§5.1); `default-lead` get (admin/editor) / set (admin) (§5.4)                                                                                                       |
| `/api/contact-log`         | `contactLog.js`                                                                                                                                    | session; `contactLog` feature (404 off); fix/delete = admin/editor; guest only via a care team seat                          | a partner's contact log: list, add, fix, delete; the fixed type/direction/topic lists; `/assigned` (the caller's care team partners with care columns) (§5.3)                                                                         |
| `/api/notifications`       | `notifications.js`                                                                                                                                 | session                                                                                                                      | `NotificationSeen` read/unread state for in-app notices                                                                                                                                                                               |
| `/api/reports`             | `reports.js`                                                                                                                                       | session, `reports` feature (admin-only for users-&-access and schedule management)                                           | report hub catalog (`GET /`), run a report (JSON/CSV), saved views (`GET/POST /views`, `DELETE /views/:id`), scheduled report emails (`POST /views/:id/schedule`, `DELETE /schedules/:id`, admin only) — see `backend/src/reporting/` |
| `/api/partner-files`       | `partnerFiles.js`                                                                                                                                  | session, `partnerFiles` feature                                                                                              | newsletter/document CRUD, download, AI scan                                                                                                                                                                                           |
| `/api/photos`              | `photos.js`                                                                                                                                        | open                                                                                                                         | raw photo bytes                                                                                                                                                                                                                       |
| `/api/silhouette`          | `silhouette.js`                                                                                                                                    | open                                                                                                                         | generic SVG placeholder photos                                                                                                                                                                                                        |
| `/api/settings`            | `settings.js`, `settingsGroupMe.js`, `settingsWhatsApp.js`, `settingsEmail.js`, `settingsTrips.js`, `settingsDispatches.js` (six files, one mount) | session (read) / admin (write)                                                                                               | church profile, branding, GroupMe/WhatsApp pairing + group targeting, email, Trips settings, dispatch config, Joshua Project/AI Extraction keys                                                                                       |
| `/api/public/settings`     | `publicSettings.js`                                                                                                                                | open                                                                                                                         | public-safe settings + logo bytes                                                                                                                                                                                                     |
| `/api/version-check`       | `version.js`                                                                                                                                       | admin                                                                                                                        | upstream version comparison                                                                                                                                                                                                           |
| `/api/system-info`         | `systemInfo.js`                                                                                                                                    | admin                                                                                                                        | runtime/DB diagnostics                                                                                                                                                                                                                |
| `/api/backup-check`        | `backupCheck.js`                                                                                                                                   | admin                                                                                                                        | backup-reminder state                                                                                                                                                                                                                 |
| `/api/backups`             | `backups.js`                                                                                                                                       | admin                                                                                                                        | full DB export (NDJSON.gz)                                                                                                                                                                                                            |
| `/api/inbound-email`       | `inboundEmail.js`                                                                                                                                  | mixed (see below)                                                                                                            | Postmark webhook + review queue                                                                                                                                                                                                       |
| `/api/dispatches`          | `dispatches.js`                                                                                                                                    | session (read) / admin+editor (write)                                                                                        | pending-dispatch review queue                                                                                                                                                                                                         |
| `/api/public/subscribe`    | `publicSubscribe.js`                                                                                                                               | open, `publicPrayerDigest` feature                                                                                           | public digest signup + confirm                                                                                                                                                                                                        |
| `/api/public/unsubscribe`  | `publicUnsubscribe.js`                                                                                                                             | open                                                                                                                         | public digest unsubscribe                                                                                                                                                                                                             |
| `/api/scoped-digest`       | `adminScopedDigest.js`                                                                                                                             | session                                                                                                                      | subscriber counts                                                                                                                                                                                                                     |
| `/api/demo`                | `demo.js`                                                                                                                                          | token (only mounted if `DEMO_RESET_TOKEN` set)                                                                               | demo DB reset                                                                                                                                                                                                                         |
| `/api/health`              | inline in `server.js`                                                                                                                              | open                                                                                                                         | liveness                                                                                                                                                                                                                              |

`inboundEmail.js` is genuinely mixed: `POST /postmark` is Postmark's own
webhook, authenticated by HTTP Basic Auth (constant-time compare) because
Postmark has no HMAC signature support for inbound mail; every other
route in the file is the normal admin review queue behind a session.

### 2.3 Utility layer (`backend/src/utils/`)

Each file owns one narrow responsibility:

| File                                            | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features.js`                                   | Canonical feature registry — single source of truth (§4).                                                                                                                                                                                                                                                                                                                                                                                          |
| `maskData.js`                                   | `toPublicPartner()` — the public/restricted masking authority for the partner API (§7).                                                                                                                                                                                                                                                                                                                                                            |
| `crypto.js`                                     | AES-256-GCM field-level encryption for reversible secrets (TOTP, integration tokens).                                                                                                                                                                                                                                                                                                                                                              |
| `jwt.js`                                        | Session cookie signing/verification (httpOnly + Secure + SameSite=Lax).                                                                                                                                                                                                                                                                                                                                                                            |
| `extraction.js`                                 | Claude-based extraction of prayer requests/one-time needs from an uploaded newsletter/document.                                                                                                                                                                                                                                                                                                                                                    |
| `joshuaProject.js`                              | Server-side proxy for Joshua Project's country-stats API.                                                                                                                                                                                                                                                                                                                                                                                          |
| `backup.js`                                     | Builds the full-database NDJSON.gz export.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `backupCheck.js`                                | Guesses the Postgres provider from `DATABASE_URL`'s hostname, for a tailored reminder message.                                                                                                                                                                                                                                                                                                                                                     |
| `today.js`                                      | Resolves report "today" as church-timezone-aware UTC midnight (`process.env.TZ`, set from `ChurchSettings.timezone` at startup and again whenever the setting is saved, `utils/timezone.js`), preferring a browser-supplied query param when present. `churchToday()` is the same day for code with no browser: the key-date bell, email and care posts, and the daily jobs.                                                                                                                                                                                                                                                           |
| `csv.js`                                        | Hand-written RFC 4180 CSV serialization (no dependency).                                                                                                                                                                                                                                                                                                                                                                                           |
| `fileResponse.js`                               | Serves a DB-stored file back to the browser; decides `inline` vs. attachment based on whether its signature was verified on upload.                                                                                                                                                                                                                                                                                                                |
| `fileSignature.js`                              | Magic-number verification of uploaded file content vs. declared type.                                                                                                                                                                                                                                                                                                                                                                              |
| `geocode.js`                                    | OpenStreetMap Nominatim forward-geocoding (city/state/country granularity only).                                                                                                                                                                                                                                                                                                                                                                   |
| `photoUrls.js`                                  | Turns a `Photo` row's id into its servable URL.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `prismaIncludes.js`                             | The shared `{id, kind, displayName}` partner-reference select.                                                                                                                                                                                                                                                                                                                                                                                     |
| `sendingParty.js`                               | Reshapes the `SendingParty` relation into `sendingChurch`/`sendingOrg`.                                                                                                                                                                                                                                                                                                                                                                            |
| `silhouette.js`                                 | Generates the generic SVG placeholder photos (never a real human photo).                                                                                                                                                                                                                                                                                                                                                                           |
| `subscriberPage.js`                             | Shared branded HTML shell for confirm/unsubscribe landing pages.                                                                                                                                                                                                                                                                                                                                                                                   |
| `upload.js`                                     | Shared multer config: extension resolution + rejection.                                                                                                                                                                                                                                                                                                                                                                                            |
| `versionCheck.js`                               | Compares the running version against upstream's latest tag.                                                                                                                                                                                                                                                                                                                                                                                        |
| `email.js`                                      | `sendEmail`/`sendEmailBatch` over Postmark.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `emailTemplate.js`                              | Shared branded HTML shell reused by welcome emails and trip participant emails (meeting invites, reminders, checklist/date-change notices, team welcome).                                                                                                                                                                                                                                                                                          |
| `tripAccessRules.js`                            | Pure grant rules: a trip grant's effective expiry (override, else trip end date + 30 days), what a grant looks like to the UI, and why a guest is inactive. No Prisma import, so the reporting registry can use it.                                                                                                                                                                                                                                |
| `guestAccess.js`                                | What a guest may reach: loads active grants for `requireAuth`, and the single `readablePartnerIds`/`canReadPartner`/`readableTripIds`/`canReadTrip` helpers every scoped route asks (so none re-derives it from a trip).                                                                                                                                                                                                                           |
| `welcomeEmails.js`                              | Sends the new-user "choose your password" welcome email (`PasswordSetupToken`); owns the hardcoded docs-site links used in it (see CONTRIBUTING.md's "Hardcoded links into the docs site" table).                                                                                                                                                                                                                                                  |
| `tripEmails.js`                                 | Trip meeting/requirement participant emails, including `manualFallback()` — the `{ sent: false, manual: [{ name, email, url }] }` shape every manual-send-link notice in the UI renders from when `outboundEmail` is off (§4).                                                                                                                                                                                                                     |
| `publicSubscribeEmails.js`                      | Double opt-in confirm/unsubscribe emails for the public prayer-request Subscribe flow.                                                                                                                                                                                                                                                                                                                                                             |
| **Reporting system (`backend/src/reporting/`)** | `registry.js` (hub catalog: `listReports`/`getReport`/`runReport`), `definitions.js` (the nine report definitions, grouped by question — Money, Partner care, Trips, Contacts, System), `masking.js` (centralized restricted-partner masking for report output), `params.js` (shared URL-backed filter-param parsing), `reports/{care,communication,partners,people,support,trips}.js` (per-report query logic). Backs `routes/reports.js` (§2.2). |
| **Dispatch system (9 files)**                   | See §6.                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 2.4 Error handling

Single `errorHandler` (middleware/errors.js). Two invariants hold for
every response it produces: `error` is always a string (never an array or
object — an earlier version leaking Zod's issue array white-screened
every form that hit it), and only deliberate, status-carrying errors say
anything specific; an unexpected exception collapses to `"Server error"`
so a raw Prisma/JS message never leaks schema details. Routes are not
expected to catch-and-translate; Express 5 forwards a rejected promise
from an async handler here automatically.

### 2.5 External integrations

| Integration                  | Used for                                                   | Key storage                                      | Feature flag    |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------ | --------------- |
| Postmark (outbound)          | Admin/public digest email, test-email                      | `ChurchSettings.postmarkServerToken` (encrypted) | `outboundEmail` |
| Postmark (inbound)           | Auto-filing incoming newsletters/documents                 | same token; webhook creds separate               | `inboundEmail`  |
| GroupMe                      | Posting prayer requests/needs/newsletters to church Topics | `ChurchSettings.groupmeAccessToken` (encrypted)  | `groupme`       |
| Joshua Project               | Country-level unreached-people-group stats                 | `ChurchSettings.joshuaProjectApiKey` (encrypted) | `joshuaProject` |
| Anthropic (Claude)           | AI extraction of requests/needs from uploaded documents    | `ChurchSettings.anthropicApiKey` (encrypted)     | `aiExtraction`  |
| OpenStreetMap Nominatim      | Forward geocoding on address save                          | none (free, no key)                              | always on       |
| OpenStreetMap / ArcGIS tiles | Public map basemap                                         | none                                             | `publicMap`     |

Every encrypted `ChurchSettings` secret is explicitly `omit`ted from every
query outside its own dedicated settings sub-route — enforced by
discipline at each call site, not a schema-level guarantee.

## 3. Frontend architecture

Vite + React, `BrowserRouter`. Entry bundle (`main.jsx`) deliberately only
imports the public-site pages and `Login`/`Setup` eagerly; every admin
page and the public map/booklet are `lazy()`-loaded, for two reasons
stated directly in the code: an anonymous visitor to the public directory
should not download a readable map of the entire admin surface, and the
map (Leaflet) and booklet (a native-print stylesheet, `frontend/src/
styles/booklet.css`) are too heavy to make every visitor pay for.

### 3.1 Routing

**Public** (no login): `/` (directory), `/map`, `/partners/:id`,
`/subscribe`, `/login`, `/setup`. Each public route is wrapped in
`RequirePublicSite`, gated on the relevant feature flag(s), not auth.

**Admin** (`/admin/*`): one shared layout (`AdminLayout` → `AdminSidebar`

- `Outlet`) behind `RequireAdminAuth` (any logged-in role). Sub-routes are
  further gated by `RequireAdminFeature` (feature flag) and, for
  `/admin/settings/*`, a second `RequireAdminAuth requiredRole="admin"`.
  `/admin/settings` has no shared layout wrapper — each settings page owns
  its own heading, since it's reached via the sidebar's expandable group,
  not a same-page tab bar.

### 3.2 Page inventory

**Public surface:** `PublicDirectory`, `PublicMap`, `PublicPartnerDetail`,
`PublicSubscribe`, `Login`, `Setup`, `PublicTripOpportunities`,
`PublicTripApplication`, `PublicTripParticipant` (support-raising/
self-service), `PublicTripAccessRecovery`.

**Admin — content:** `AdminHome`, `AdminPartners`, `AdminPartnerForm`,
`AdminPartnerDetail` (the ~1,000-line single edit form was replaced by
per-section inline editing via `EditableSection.jsx` — see §3.3),
`AdminPrayerRequests`, `AdminOneTimeNeeds`, `AdminMonthlySupport`,
`AdminPartnerFiles`, `AdminBooklet`, `AdminReports` (the question-based
hub) and `AdminReport` (one report's own view — filters, summary tiles,
chart, `SavedViewsBar`, CSV download, print).

**Admin — trips** (#252 rework; replaces the old `AdminTripHistory`/
`AdminTripOpportunities`): `AdminTrips` (list), `AdminTripOverview`,
`AdminTripTeam` (roster, including the merged Confirmed Team table),
`AdminTripFinancial` (budget + contribution ledger), `AdminTripFlights`,
`AdminTripMeetings`, `AdminTripRequirements`, `AdminTripParticipantDetail`,
`AdminTripApplicationDetail` (the application-review wizard — Decision
then Confirm, with inline manual-send-link notices).

**Admin — communications:** `AdminInboundEmailQueue`,
`AdminPendingDispatches`, `AdminDispatchSettings`.

**Admin — site administration:** `AdminSettingsAbout` (church
info + branding together, one page — "About & Branding" in the sidebar),
`AdminSettingsFeatures`, `AdminSettingsGroupMe`,
`AdminSettingsWhatsApp`, `AdminSettingsIntegrations` (Joshua Project +
AI Features together, one page), `AdminSettingsEmail`, `AdminSettingsTrips`,
`AdminSystemInfo` (runtime/DB diagnostics + database backups together,
one page — "About App" in the sidebar), `AdminUsers`, `AdminUserForm`
(its own wizard page at `/admin/settings/users/new`, not a modal — email/
name/role, optional password override, "Send a welcome email" toggle,
"Require two-factor authentication at first sign-in", and for Trip
Leader a scoped-trip picker + optional access-expiry date).

**Admin — self-service:** `AccountSettings`.

### 3.3 Shared components worth naming

- `AdminLayout` / `AdminSidebar` — the shell every `/admin/*` page renders
  inside; `AdminSidebar` replaced an older single-row top nav.
- `EditableSection` — lets one section of the partner-detail page save
  independently, replacing the old one-giant-form edit model.
- `RequireAdminAuth` / `RequirePublicSite` / `RequireAdminFeature` — route
  guards; the admin-feature guard is a client-side convenience only, the
  real enforcement is `requireFeature` on the backend (404, not a UI
  state).
- `ApiKeySettingsPage` — the shared shell `AdminSettingsIntegrations`
  renders twice, once for Joshua Project and once for AI Features
  (previously two near-identical standalone pages, each its own route;
  now one page/route with both sections).
- `PartnerSelect`, `AddressFields`, `SendingPartySection`,
  `PresetOrCustomSelect`, `AlbumLinkField`, `SourcePicker`/`SourceLink`,
  `TripSelect` — reusable form building blocks shared across the
  partner-detail sections and the Trip/Monthly-Support/Prayer-Request/
  One-Time-Need pages. `TripSelect` (added for `AdminTripContributions`,
  #272) is the cross-trip counterpart to `PartnerSelect` — a plain
  `<select>` over every trip, grouped by status, for a page that isn't
  already scoped to one trip the way `TripDetailLayout` is.
- `ExtractionReviewModal` — the AI-scan review flow (accept/edit/reject
  each suggested request/need before it's created).
- `DispatchReviewModal` / `ApproveRestrictedTextConfirmBody` /
  `UrgentSendConfirmBody` — the dispatch-system's review/approval UI
  (§6).
- `useConfirmDialog` — the app's one confirmation-dialog pattern, replacing
  `window.confirm`/`prompt` everywhere.
- `ErrorBoundary` — catches both a render error and a failed lazy-chunk
  import after a deploy.

### 3.4 State management

One context (`SettingsContext`) for the one piece of genuinely global
state: public-safe church settings (branding, feature flags, demo-mode
banner fields), fetched once on mount and read by nearly every page
(sidebar, public header). Every other page fetches its own data
independently via a small `api/client.js` wrapper — there is no other
shared client-side store (no Redux/Zustand/etc.).

## 4. Feature flag registry

Single source of truth: `backend/src/utils/features.js`'s `FEATURES`
object. A church's choices live in `ChurchSettings.enabledFeatures`
(JSON); a key absent from that blob falls back to the registry's
`defaultEnabled`. Enforced server-side (`requireFeature` middleware → 404
when off) independent of the frontend hiding the corresponding nav entry.

| Key                   | Label                 | Default | Group                | Depends on                          |
| --------------------- | --------------------- | ------- | -------------------- | ----------------------------------- |
| `publicDirectory`     | Public directory      | on      | public               | —                                   |
| `publicMap`           | Public map            | on      | public               | —                                   |
| `partnerFiles`        | Newsletters & Docs    | on      | admin                | —                                   |
| `prayerRequests`      | Prayer requests       | on      | admin                | —                                   |
| `oneTimeNeeds`        | One-time needs        | on      | admin                | —                                   |
| `monthlySupport`      | Monthly support       | on      | admin                | —                                   |
| `trips`               | Mission trips         | **off** | admin                | —                                   |
| `publicTripDiscovery` | Public trip discovery | **off** | public               | `trips`                             |
| `booklet`             | Print booklet         | on      | admin                | —                                   |
| `reports`             | Reports               | on      | admin                | —                                   |
| `outboundEmail`       | Email (Sending)       | **off** | admin/communications | —                                   |
| `inboundEmail`        | Email (Receiving)     | **off** | admin/communications | —                                   |
| `groupme`             | GroupMe dispatch      | **off** | admin/communications | —                                   |
| `whatsapp`            | WhatsApp dispatch     | **off** | admin/communications | —                                   |
| `publicPrayerDigest`  | Public prayer digest  | **off** | admin/communications | `publicDirectory` + `outboundEmail` |
| `aiExtraction`        | AI Features           | **off** | admin/integrations   | —                                   |
| `joshuaProject`       | Joshua Project stats  | **off** | admin/integrations   | —                                   |

`isAnyFeatureEnabled` supports "reachable if at least one of N is on" —
used for the public partner data routes (back both directory and map) and
the shared Email settings page (reachable if either direction is on).

**A rule worth not rediscovering per feature: `outboundEmail` and
`inboundEmail` both default to off.** A brand-new fork with neither
configured yet is the _default_ state a church lands in, not a rare
opt-out -- so any feature that sends or depends on email has to be
designed against that from the start, not patched in after the fact.
Confirmed as a real, shipped gap (2026-11-22, found during a PR review
rather than at design time): a welcome-email flow that defaulted its
"send welcome email" option to on and never checked the flag at all,
which would have silently failed on every single Add User submission
for any church that hadn't gone through Email setup yet.

Two things every email-sending feature needs, not just one:

1. **Gate it.** Check `isFeatureEnabled(settings?.enabledFeatures,
"outboundEmail")` (or `"inboundEmail"` for receiving) before
   attempting anything -- server-side, same as every other feature
   flag, not just a frontend default.
2. **Give it a working fallback**, not just a disabled button. When
   what the email carries is a link/token that doesn't itself need
   Postmark to exist -- only its automatic delivery does -- hand that
   back directly so an admin can copy it and send it through whatever
   channel they actually have (personal email, text, in person),
   instead of the feature becoming unusable the moment email is off.
   Reference implementation: `backend/src/utils/tripEmails.js`'s
   `manualFallback()` (meeting invites, checklist notifications -- one
   shared shape: `{ sent: false, manual: [{ name, email, url }] }`,
   the participant's own trip-access link being enough on its own since
   the trip page already shows the meeting/requirement in question) and
   `backend/src/routes/users.js`'s `manualSetupUrl` (same idea, one
   recipient, one link, for the account-setup flow specifically). Not
   every email needs this -- a request that structurally depends on a
   full round trip (send _and_ receive a reply, e.g. the document-
   request flow in `tripParticipants.js`) has no equivalent manual
   substitute and is correctly just gated off outright; and a few
   secondary/FYI-only notifications (a late-joining participant's
   catch-up emails, a trip-dates-changed recalendar notice) were
   deliberately left as simple no-ops rather than given this treatment,
   since nothing is actually blocked on them.

## 5. Auth & permissions model

**"Auth is the boundary."** Any logged-in account holding one of the 3
full roles (`admin`/`editor`/`viewer`) reads every partner's full,
unmasked record, including restricted ones (see `reports.js`'s own
comment: gating a read to admin-only would be the _first_ read in the
app gated by role, "contradicting a decision made deliberately rather
than by omission"). Roles exist to gate **writes**, not visibility:

| Role     | Can read   | Can write                                                                                                                     |
| -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `viewer` | everything | nothing                                                                                                                       |
| `editor` | everything | partner content (create/update, not delete), prayer requests, one-time needs, trips, files, archive/unarchive                 |
| `admin`  | everything | everything editor can, plus: delete, user management, church settings, GroupMe/email/integration config, backups, system info |

- **Session**: httpOnly + Secure + SameSite=Lax JWT cookie, 8h TTL. Every
  request re-reads the user row from the DB (not just the JWT claims) so
  a deactivation/role-demotion takes effect on the user's very next
  request, not at token expiry.
- **Passkeys (#386)**: a second factor next to TOTP, via `@simplewebauthn/server`. `UserPasskey`
  holds only public material (credential id, public key as base64url, signature counter,
  transports, a label), up to 5 per user. `User.mfaEnabled` stays the single "second factor
  enrolled" flag, so sign-in, the church-wide requirement and `requireAuth` are unchanged;
  `User.mfaSecret` says whether an authenticator app is also set. The relying-party id is the host
  of `APP_BASE_URL` (falling back to the request host). Challenges are not stored: each is carried
  in a 5-minute signed token bound to its purpose and user and accepted once (in-memory spent
  list). Routes under `/api/auth/passkeys`: `register/options|verify` (a session, or the forced
  enrolment setup token, which then also signs the person in), list, `DELETE /:id` (password
  required; refused for the last factor while two-factor is required), and `login/options|verify`
  (second step after the password, using the pending token). Login returns `methods`
  `{authenticatorApp, passkey}`. Admin MFA reset deletes passkeys.
- **Passwordless (#386 Layer 2)**: `ChurchSettings.requirePasswordless`, church-wide, off by
  default, never on a demo. Turning it on (`PUT /api/settings`) needs outbound email ready (feature
  on, Postmark token and From address set, `APP_BASE_URL`) and the acting admin to hold a passkey;
  while on, outbound email can't be switched off. `isTwoFactorRequired()` is true while it is on, so
  an account with no factor is sent to enrolment. `POST /api/auth/login` refuses (403,
  `passwordless: true`). A passkey signs in alone: `/api/auth/passkeys/passwordless/options|verify`
  use discoverable credentials and user verification, with no email asked for (nothing
  enumerable). An account with no passkey asks `POST /api/auth/passwordless/email-link` (one
  reply for every address; only a passkey-less active local account is sent a link) and the link
  (`SignInLinkToken`, SHA-256 hash stored, 15 minutes, single-use via a conditional update) is spent
  at `POST /api/auth/passwordless/link/redeem`, which continues exactly as after a password
  (`afterFirstFactor`: a TOTP code, enrolment, or the session). A person with a passkey gets no
  link: a lost passkey is recovered by an admin (Reset MFA). Welcome emails send a sign-in link
  instead of a setup link while it is on.
- **MFA**: self-service TOTP, opt-in per user; an admin can force
  enrollment (`mfaSetupRequired`) of one account without knowing the
  secret, or require it of every account with the church-wide
  `ChurchSettings.requireTwoFactor` (#385): login sends an unenrolled
  account to enrolment (no session), `requireAuth` ends a session for an
  unenrolled account on the next request, the self-service disable is
  refused, and the setting can only be turned on by an enrolled admin and
  never on a demo deployment. Replay protection via `mfaLastTimeStep`. SSO was removed in 3.1.0 — auto-
  provisioning handed an account to anyone at the configured identity
  provider, which in a "any account reads everything" app was judged too
  wide; `authProvider` stays on the schema so `local`-only password auth
  can keep refusing anything else.
- **No per-resource ownership model among the 3 full roles** — there is
  no "editor can only edit their own partners" concept anywhere the 3
  full roles are concerned.

### 5.1 Guest — a scoped login, not a 4th full role

`guest` is a deliberately narrow 4th account tier, not a
reconsideration of "auth is the boundary" above and not a reduction of
any existing role's visibility — `admin`/`editor`/`viewer` are unchanged.
It's a real login (`User.role: "guest"`, same session/password
mechanism as every other account — no bespoke portal) whose reach comes
only from **grant rows**, never from the role itself: effective access =
the role's baseline (nothing, for a guest) plus whatever grants exist.
Today the only grant table is `TripAccess` (#356); #289 adds care team
seats to the same helpers. Grants never allow deletes, profile edits or
settings. (Renamed from `tripLeader`, which was scoped by a single
`User.scopedTripId`; that column and `User.expiresAt` are gone, and the
migration carries existing logins over.)

`TripAccess` is one row per (guest, trip), `onDelete: Cascade` on both
sides. **Expiry is derived at check time, not stored:** with a null
`TripAccess.expiresAt` the grant lapses at the end of the day 30 days
after `Trip.endDate`, so changing a trip's dates moves every grant's
expiry with it, and a trip with no end date never lapses on its own. A
non-null `expiresAt` is only an admin override ("extend" or "end now") and
wins over the derived date in both directions (`utils/tripAccessRules.js`).
`requireAuth.js` reads a guest's grants fresh on every request; a guest
with **no active grant** gets the same 401 as `!active` — the row is kept,
so extending access moves a date instead of recreating the account. Care
team seats (#289) will not expire.

Removing a guest's **last** grant deactivates the account (`active:
false`, sessions ended), never deletes it, and an admin granting access
afterwards does **not** silently reactivate it. The Users list marks
"inactive" guests (deactivated, all access expired, or none left —
computed, not stored) and `GET /api/users?inactive=true` /
the "Inactive accounts only" filter lists just those so an admin can reach
out and clean up. Grant changes are recorded in the audit log (§5.6): who granted,
extended or removed access, and the deactivation that follows.

**No two-factor rule is specific to a guest** (#385; before it, guests were
forced to enrol in four separate places). A guest is held to the church-wide
requirement exactly like every other role (§5, MFA). A guest can change their
own password and enrol MFA from "My account" (reversing #329 Finding 2, which
had made them fully admin-managed), and can switch it off only while the
church doesn't require it of everyone. "My account" shows a guest password and
MFA only — never the admin digest subscription.

| Can read                                                                        | Can write                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each granted trip's own content; the `Partner` of each granted trip (read-only) | Editor-equivalent create/update/delete on a granted trip's meetings/requirements/budget lines/flight segments/documents/contributions/participants/applications, matching the editor-delete exceptions above. Never the Trip entity's own delete/clone/generate-application-link (those stay admin-only or admin+editor-only even on a granted trip), never anything on the Partner |

Everything else in the app — the Partner directory, every other trip,
One-Time Needs, Monthly Support (amounts), Reports, Booklet, Inbound
Email, Updates to share, Settings, Users — is a flat 403. Enforced
server-side by two middleware in `requireAuth.js`:
`requireTripScope(tripIdResolver)` (a no-op for every other role; 403s a
`guest` whose request resolves to a trip they hold no active grant for —
applied to every trip-scoped route, reads included) and
`requirePartnerQueryScope` (same no-op/403 shape, for a Partner
sub-resource's own `?partnerId=` read — prayer requests, support entries,
family members, furloughs, church visits, links, languages, files,
trips-by-partner — refusing a query with no `partnerId` filter at all,
which would otherwise return every partner's rows). Single-record routes
(`GET /api/partners/:id`, partner file download) and both middleware ask
`utils/guestAccess.js` (`canReadPartner`, `canReadTrip`) rather than
re-deriving reach from a trip; add any new partner- or trip-keyed route
the same way. `/api/photos/:id/raw` is public by design, so it is not a
guest leak. `AdminLayout.jsx` mirrors this client-side (redirects a guest
away from any path outside a granted trip, `/partners/*` or
`/account`) purely so they never see a flash of the wrong page before the
backend's own 403 lands — the frontend check is not the real boundary.

**Frontend `canWrite` for a guest is scope-aware, and that scoping
doesn't propagate for free.** `useCurrentUser()`'s own `canWrite` is
global (`admin`/`editor` only, always `false` for `guest` — see its own
comment). `TripDetailLayout.jsx` computes a second, trip-scoped
`canWrite = globalCanWrite || canAccessTrip(id)` and
passes it down via `useOutletContext()` to every route nested under its
Outlet (`AdminTripTeam.jsx`, `AdminTripOverview.jsx`,
`AdminTripFinancial.jsx`, etc.) — none of those call `useCurrentUser()`
for `canWrite` themselves, they just read the context. A route that
lives _outside_ that Outlet but still operates on one trip's data (e.g.
`AdminTripParticipantDetail.jsx`, routed as a standalone sibling at
`trips/:tripId/participants/:participantId`, not nested under
`trips/:id`) has no context to inherit and must repeat the exact same
computation itself. Confirmed as a real, shipped bug, not a
theoretical one: `AdminTripParticipantDetail.jsx` called the global
`canWrite` directly and showed a trip leader a read-only UI on their
own trip's own participant, despite the backend correctly granting
them write access there the whole time (middleware above, not this
page's own code, was always right). Fixed by replicating
`TripDetailLayout.jsx`'s exact formula locally rather than inventing a
new one. If you add another sibling route under `trips/:tripId/...`
outside `TripDetailLayout`'s Outlet, give it this same local
computation — don't assume `useCurrentUser()`'s `canWrite` is enough
just because it works for every other role.

### 5.2 Care teams (#289)

Behind the `careTeam` feature (off by default; off = hidden, ignored for
access, data preserved). A partner's **care team** is one **Lead** plus any
number of **Members**, each a login (`CareTeamMember`, a seat). Terms are
fixed ("Care team", "Lead", "Member", "Guest"), not settings. Any role can
hold a seat; a guest outside the team is how someone without a full account
joins one. The Lead is a label today: no extra permission or notification
(everyone on the team is treated the same); the "You're the lead" marker and
the "My partners" view come with #288.

**One app for everyone.** There is no care-team-only or guest-only app. A
guest uses the same shell (header with bell and collapse, footer with My
Account / Log out / theme toggle), the same nav entries in the same order, the
same list pages and the same partner page as everyone, and the **server**
limits every list to what they reach. Roles gate what you can change and, for
a guest, hide what they can't see. The nav is the standard one filtered by
scope (below).

**Two sizes of guest.** A seat and a trip grant are different scopes:

- _Trip leader_ (a `TripAccess` grant): their granted trips (read and write)
  and those trips' partners, read-only, with prayer requests and Newsletters &
  Docs for that partner (read). Nav: Trips and Partners. Never one-time needs,
  never monthly support, never the care-team list pages.
- _Care team member_ (a seat): everything below, for that partner.

**What each can do on a partner** (a care team member is an editor on their own
partner, with three exceptions: their dispatches are held, they can't decide a
one-time need, and they never see monthly funding):

|                                                                                               | Editor           | Care team member (that partner)                                                                                                                                                                                                                                                | Trip leader (trip grant)      |
| --------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Which partners                                                                                | All              | Those whose team they're on                                                                                                                                                                                                                                                    | Their trips' partners (read)  |
| See the partner page                                                                          | Everything       | Everything **except monthly funding**                                                                                                                                                                                                                                          | Read-only, no needs, no money |
| Edit profile, family, location, furlough, visits, links, languages, trip hosting info, photos | Yes              | Yes                                                                                                                                                                                                                                                                            | No                            |
| Public / restricted / safe-to-contact flags                                                   | Yes              | Yes                                                                                                                                                                                                                                                                            | No                            |
| Archive / unarchive                                                                           | Yes              | Yes                                                                                                                                                                                                                                                                            | No                            |
| Create a partner                                                                              | Yes              | **No**                                                                                                                                                                                                                                                                         | No                            |
| Delete anything                                                                               | Admin only       | **No**                                                                                                                                                                                                                                                                         | No                            |
| Prayer requests: add, edit, answer, public/booklet                                            | Yes              | Yes                                                                                                                                                                                                                                                                            | Read only                     |
| Mark urgent / "approve now"                                                                   | Yes              | **No** (their dispatch is held)                                                                                                                                                                                                                                                | No                            |
| One-time needs: add, edit                                                                     | Yes              | Yes                                                                                                                                                                                                                                                                            | **No access**                 |
| Record a decision on a need                                                                   | Yes              | **No** (committee/board)                                                                                                                                                                                                                                                       | No                            |
| Monthly support (amounts, entries)                                                            | Yes              | **Never shown or writable**                                                                                                                                                                                                                                                    | Never                         |
| "Partnering since" date (and the $0 entry archiving a partner writes)                         | Yes              | **Yes: shown and editable on their own partner** (decided in #410; the key-date "N years of our support" reaches them)                                                                                                                                                         | Never                         |
| Newsletters & Docs: view, upload, edit, AI scan                                               | Yes              | Yes (scan only if the feature is on)                                                                                                                                                                                                                                           | View / download               |
| Dispatches from the above                                                                     | Sent on schedule | **Saved at once, held for staff approval**                                                                                                                                                                                                                                     | n/a                           |
| Approve in Updates to share                                                                 | Yes              | No                                                                                                                                                                                                                                                                             | No                            |
| Assign the care team                                                                          | Yes              | No (can view)                                                                                                                                                                                                                                                                  | No                            |
| Trips of the partner                                                                          | Manage all       | **View only**                                                                                                                                                                                                                                                                  | Manage their granted trips    |
| Trip participants' personal details (contact info, notes) on those trips                      | Yes              | **No** (#409): a seat sees the trip's name, type, status, dates and who is on the team, and nothing else: no contact details, dates of birth, applications, documents, contributions, budget, flights, requirements, meetings or private-link tokens (`utils/seatTripView.js`) | Yes, on their granted trips   |

Everything a non-staff login does is a request to the same routes an editor
uses; `requirePartnerWriter` (staff, or on **that partner's** care team) gates
the writes, and `isOnCareTeamFor` is the single seat check. Moving a record to
another partner needs a seat on both.

**A seat is a grant.** For a guest a seat reaches that partner, like a trip
grant reaches a trip's partner, and unlike a trip grant it never expires — an
admin removes the member when they step down. A guest with no trip grant _and_
no seat is inactive; removing their last seat deactivates them, like removing
their last trip.

**Their entries are saved at once but their dispatches are held.**
`DispatchRecord.reviewRequired` is set on the record created from a care team
member's prayer request, answer, need or uploaded newsletter. `needsReview()`
treats it like a restricted partner's content, but for _any_ type:
`isEligibleForChannel`'s Rule 1 blocks it on **every** channel (admin email,
public email, GroupMe, WhatsApp, the urgent path) until an admin/editor reviews
it in Updates to share, whether or not the partner is restricted. Staff-made
records are unaffected; a restricted partner's staff-made newsletter stays
exempt as before. (Before #289 the review hold applied _only_ to restricted
partners; every other record sent on schedule with no approval.)

**Server-scoped lists.** A guest may list partners, trips, prayer requests,
one-time needs (care team only) and Newsletters & Docs without naming a partner;
the server limits the rows to what they reach (`readablePartnerIds`,
`readableNeedPartnerIds`, the granted/readable trip sets). The partner list
leaves out `supportEntries`/`supportingSince` for a guest, and the booklet's
`?include=full` dump stays closed to them. `GET /api/partners/reachable` gives
pickers the partners a login may read. `/me` returns `careTeamSeats` for every
role and `guestReadTripIds` for a guest. The coverage view ("which partners have
no care team or no lead") is the `care-team-coverage` report in the reporting
hub.

### 5.3 Contact log (#288)

Behind the `contactLog` feature (off by default; off = hidden, data kept). A
`ContactLog` row is one touchpoint with a partner: `contactType` (call, text,
email, visit, card, video, prayed, other), `direction` (we reached out / they
did), `topics[]`, who made it (`contactedById`, default the person logging)
and who typed it in (`createdById`), a calendar `contactDate`, a note and an
optional `followUpDate`. The three fixed lists are plain validated Strings in
`utils/contactLog.js` (SPEC §3: no native enums), served by
`GET /api/contact-log/options` so the UI keeps no copy. It is purely internal
— never on a public page or a dispatch channel.

**Who.** Anyone who can see the partner can log a contact: admin, editor,
viewer, and a guest who holds a **care team seat** on it. A trip leader (a trip
grant alone) never reaches it — the same line as one-time needs
(`readableNeedPartnerIds`). Fixing or deleting an entry is admin/editor.
Everyone's contact counts toward the quiet clock. An entry is never held for
review (it isn't dispatched anywhere).

**Quiet and follow-ups.** `ChurchSettings.contactStaleDays` (default 90, 7 to 365,
set under Settings → Care Teams; `utils/careSettings.js` `careTimings` reads it)
is the one number for "quiet" (the _Last heard from_ report defaults to it too,
and counts a church visit as hearing from a partner): no logged contact for that long, or never. A
follow-up date is answered by any later-entered contact dated on or after the
one that set it; unanswered and past, it is _due_. `utils/contactLogQueries.js`
`loadAssignedPartners` is the single read model behind the **My partners**
tab (`GET /api/contact-log/assigned`, needs the care team feature too) and the
`partnersNeedingContact` notification (guest-visible, counts the caller's seats
that are quiet or due, 0 while either feature is off), so they can't disagree.

**Wiring.** _Last heard from_ reads the log: with the feature on, a partner is
quiet only when **both** the latest newsletter and the latest logged contact are
old (off: unchanged, newsletter only). A care team member's new prayer request
also creates a log entry (`inbound`, topic `prayer`, linked by
`prayerRequestId`; best-effort, never blocks the save). `prayerRequestId` and
`supportNeedId` are plain ids with no foreign key, so deleting the request or
need keeps the history.

**The contact card.** Everyone who can see a partner gets it, whether or not the contact
log is on, and it is the one place this is shown and edited: the primary contact
(`Adult.isPrimaryContact`, at most one per partner — a hand-added partial unique
index plus the route clearing the old one; picked from a list on the card; an
organization uses its named contact), how each person likes to be reached
(`Adult.contactMethod` and `contactMethodNote`; for an organization,
`Partner.contactMethod` beside its contact fields), tap-to-call/text/email/WhatsApp,
and last contact. `Partner.contactLevel` sets how careful to be (above); under `caution`
only the ticked `contactChannels` keep their buttons, and under `no_direct` the card shows
the go-between with their own call and email buttons instead of the family's. The
**printed booklet** withholds phone, email, addresses and preferred method for `no_direct`
and never prints the instructions. The public site never exposes adults' details at all.

### 5.4 Key-date reminders (#291)

Behind the `keyDates` feature (off by default; needs `careTeam` — that is where
recipients come from; the email also needs `outboundEmail`). A reminder is
raised for a birthday (adults and children), the wedding anniversary, and a
**supported-since milestone** (the first year, then every fifth — year-only
start dates are stored as Jan 1, so a yearly nudge would only ever say Jan 1)
coming up within `ChurchSettings.keyDateLeadDays` (default 7, 1 to 60, read through
`careTimings`, so the bell and the email always agree). `utils/keyDates.js` is the pure rule and
reuses `reporting/definitions.js` `nextAnnual` (the _Families & key dates_
report's date math: Feb 29 lands on Feb 28, and the age or years turning come
with it).

**Who.** The one ownership rule, `utils/ownership.js`: the partner's care team (active
members, only while `careTeam` is on) when it has one, else the church's **missions team**
(`User.onMissionsTeam`, active non-guest logins; set at `PUT /api/partner-care/missions-team`,
admin only, or per user; its display name is `ChurchSettings.ownerGroupName`, wording only);
if neither, nobody. The same rule feeds _My partners_ and _Partners to reach out to_
(`loadAssignedPartners` / `partnersOwnedBy`, marked `viaMissionsTeam`) and _Updates to pass on_:
a guest is never on the missions team, so their reach never widens. A
person can opt out of the daily email alone (`User.keyDateEmailOptOut`,
`PUT /api/auth/key-date-email`); the bell is unaffected. `utils/keyDateQueries.js` `loadOpenKeyDates` is
the one read model: it counts nothing while `keyDates` is off (it no longer needs `careTeam`),
skips archived partners, and drops anything _handled_.

**What clears one.** A contact log entry for that partner with the topic
**Key date**, dated within the lead window either side of the occurrence — the
card was sent, and (§5.3) it resets the quiet clock too. Per partner, not per
person: one card goes to the family.

**Bell.** The guest-visible `keyDatesComing` category in
`notifications/categories.js`, computed live for the caller (one partner links
straight to it, several to My partners).

**Email.** `utils/keyDateReminderScheduler.js`, started from `utils/backgroundJobs.js` (inside the
web process) on a daily 07:00 church-local cron, in the shape of
`tripReminderScheduler.js`. It sends **one grouped email per person**, only on a
day something is due and not yet mailed to that person — never one per partner.
`KeyDateReminder` (unique per person, partner, kind, subject, occurrence
date and `tier`) is the idempotency record, written after the send: a re-run never repeats
an occurrence, next year's is a new row, a corrected date re-arms, and a failed
send leaves no row so tomorrow's tick retries it. The email leaves the app, so a
restricted partner is named by `maskedDisplayName` and a restricted family's own
names are omitted; a partner who isn't safe to contact gets a pointer to the
special instructions on their page, never the instructions themselves.
`sendEmail` has no `replyTo`, so replies go to the church's From address.

**Heads-ups and the digest.** A key date is raised at tiers: `tier` 0 is the final
window (`keyDateLeadDays`), otherwise the smallest of `ChurchSettings.keyDateAdvanceDays`
(default `[90, 30]`, up to three, via `careTimings`/`cleanAdvanceDays`) that still covers
it (`reminderTier` in `utils/keyDates.js`). The bell and this daily email use tier 0 only.
The email digest (`sendDigestTier`) leads each staff recipient's message with a "Key dates
coming up" section: every open date for the partners they look after (their digest scope
already is "owned" for these) whose heads-up they haven't been mailed, sent even when there
are no other updates, and recorded as `KeyDateReminder` rows only after a successful send
(`keyDatesForDigest`, `recordKeyDatesMailed`). The daily email skips someone whose own
digest comes on or before the date (`utils/digestSchedule.js` `digestComesBefore`, an
approximation from the dispatch schedule and last-sent stamps), so a person gets one email,
and a person with no digest always gets the short one. A person who turned key-date email
off gets neither.

**Never on a public demo.** A demo's care teams are fake seeded addresses, so the
email would only bounce and spend the email plan. `utils/demoMode.js` lists the
features a demo keeps off (`keyDates`); the reset script and the seed (which
rewrites the feature list after the reset script does) both apply it, and
`checkAndSendKeyDateReminders` returns immediately on a demo, as a backstop for the
published admin login switching the flag on. A demo is known two ways: the
`DEMO_RESET_TOKEN` variable (web service only) or `ChurchSettings.demoMode`, which the
demo reset writes, so the scheduled jobs agree wherever they run. Only the scheduled senders (key dates, trip reminders, scheduled reports, email digests)
skip on a demo; an email a person adds or clicks to send goes out as anywhere else.

### 5.5 What flows to the care team (#292 Phase 1)

**The app never contacts a partner; a person does.** That settles the missionary
contact-address gap: the contact card (§5.3) says who and how, and "special
communication instructions" replace it when a partner isn't safe to contact.
Prayer updates (new or answered) come _from_ the partner: they tell a care team
member, who enters it (held for staff approval, §5.2), and the church hears it
through the existing dispatch channels.

- **Entering counts as a contact.** A care team member's new prayer request and
  their marking one answered each create an inbound `ContactLog` entry (topic
  `prayer`, linked by `prayerRequestId`). Marking it answered fires only on the
  transition, so a typo fix doesn't log twice; a staff entry logs nothing.
- **The team is told about new needs and prayers.** `newOneTimeNeeds` and
  `newPrayerRequests` are now guest-visible, scoped to the guest's _care team_
  partners (`careTeamPartnerIds` via the summary route's `scopePartnerIds`; a
  trip leader has none, so counts zero). Full roles are unchanged.
- **Updates to pass on.** The guest-visible `updatesToPassOn` category counts, on
  a partner the login has a seat on, a one-time need **decided** (`approvedDate`)
  or a prayer request **answered** (`dateAnswered`) in the last 30 days that no
  one has yet relayed. It is live (no sent-flag column) and cleared only by an
  **outbound** contact for that partner on or after it: topic `need` for a
  decision, `encouragement` or `prayer` for an answer — so hearing from them (the
  inbound auto-log above) never clears its own prompt. It counts nothing while
  `contactLog` or `careTeam` is off. A decision's outcome and note are already
  on the need the team can open.
- **Not built:** the "prayed-for" summary to existing subscribers, and Phase 2
  (church-member notes through a public form) — both deferred.

### 5.6 Audit log and last-edited-by (#341)

Two mechanisms, deliberately separate, because they have opposite retention:

**`AuditLog` — what happened, when (bounded).** One append-only row per
sensitive event (`utils/auditLog.js`, the `AUDIT_ACTIONS` catalogue is the line
between audit-worthy and routine). Gated by the `auditTrail` feature (**on by
default**, so it is recording from the first sign-in and a church that upgrades
gets it; the demo seed also seeds example entries). Actor and
target are plain ids with an email/name snapshot and **no foreign keys**, so an
entry survives either account being deleted; the API flags `deleted` when the id
no longer matches a user. `details` holds old/new values and never a secret:
secret columns are noted `"changed"` (`secretChange`). Kept for
`ChurchSettings.auditRetentionDays` (30/60/90, default 90), pruned daily at
03:30 church time by the scheduled jobs (`auditPruneScheduler.js`) whether or not the
feature is on. Included in backup/restore. Account, access, delete and care-team
entries are written in the **same transaction** as the change (`recordAudit(tx)`),
so an access change that cannot be recorded does not happen; sign-in events use
`recordAuditSafe`, which never blocks a login.

- _Settings_ are written by eight route files, so one middleware
  (`middleware/auditSettings.js`) mounted on `/api/settings` snapshots the
  `ChurchSettings` row before a write and diffs it after, logging each feature
  toggled separately and everything else as one entry per request. It ignores the
  stamp columns. Turning the log off records the switch-off (`force`), then it is
  quiet.
- _Restricted-partner views_ are logged once per (viewer, partner, church-local
  day) — `recordRestrictedView`.
- _Sign-in_ records failures with the reason (`unknown_email`, `inactive`,
  `wrong_password`, `wrong_two_factor_code`, …) and the IP (`trust proxy` is set
  to 1). The caller still gets the one generic answer.
- _Read side:_ `routes/audit.js`, admin-only and flag-gated (`GET /api/audit`
  with `q`/`category`/`action`/`from`/`to`, cursor paging; `/export` CSV through
  the formula-safe `toCsv`; `/meta`; `PUT /retention`). Reading it is not logged.
  The page is Settings → Audit log.

**`lastEditedById` / `lastEditedByName` / `lastEditedAt` — who last touched this
record (unbounded).** On 32 editable models. Stamped by a Prisma client extension
(`prismaClient.js`) on every `create`/`update`/`upsert` made while a signed-in
request runs; the actor comes from an `AsyncLocalStorage` (`utils/actorContext.js`)
entered by `requireAuth`. No actor — the seed, the scheduled jobs, a public
submission — means nothing is stamped and the old value stays. Overwritten in
place, never pruned, and the name is a snapshot so it survives account deletion.
Only the row written directly is stamped, not rows touched by a nested write.
**Excluded on purpose:** `AuditLog`, every `*Bytes` table, `ChurchSettingsLogo`,
`TripAccess` (audited instead), `KeyDateReminder`, `PasswordSetupToken`,
`NotificationSeen`, `UserFollowedPartner`, `PublicSubscriber*`, `InboundEmail*`,
`TripMeetingRsvp`, `TripParticipantPhoto`, `WhatsAppAuthEntry`. **Sending church filter** (`utils/sendingChurch.js`): one `sendingChurch` query
parameter on every list about partners or their records (partners, partner files, trips,
prayer requests, support needs, monthly support) and on every partner-level report
(`sendingChurchParam`/`sendingChurchField` in `reporting/params.js`; the field is
flagged `dynamicOptions: "sendingChurches"` and filled from
`GET /api/partners/sending-churches`). `__ours__` means the `sentByOurChurch` flag;
anything else matches a `SendingParty` (type `church`) name, case-insensitively; a
partner sent by us is counted under ours, not under its own name. Staff only.

**Master records read across their sections** (`utils/lastUpdated.js`): the
partner and trip pages, the Partners and Trips list columns ("Last updated",
sortable) and the Data completeness report show the latest change to the record
_or any section on its page_ (a partner's adults, children, addresses, furloughs,
visits, links, languages, sending parties, support entries and photos; a trip's
participants, applications, meetings, requirements and their statuses, documents,
contributions, budget lines and flights). Done at read time with one `UNION` query
over a fixed table list rather than by also stamping the parent on every child
write, which would run outside the request's transaction and could block on the
parent row it already holds; deletes are not seen. Lists omit the fields for
guests. It is shown on the
partner, trip, trip-participant and trip-application pages and in the prayer
request and one-time need detail dialogs (not to guests), as **Last edited by /
Last edited** columns in the Data completeness report only
(`reporting/reports/care.js`; reports are not open to guests; the prayer request
and one-time need reports stay compact because their dialogs carry it), and **never on the public site** (tested). A new model opts in by declaring the three columns.

### 5.7 Support preferences (#374)

Behind the `supportPreferences` feature (off by default; needs `careTeam`). The church's
menu is **data, not code**: `SupportOption` rows (`group` is plain text so it can be renamed,
`kind` is `offer` | `single` | `multiple` | `text`, `choices` a `String[]`, `allowOther`,
`sortOrder`, `active`), edited by an admin, so a fork never changes application code to change the
list; `utils/supportOptions.js` holds only the kinds and the answer rules (a starting list is a
template pack, §5.10). A partner's response is one
`PartnerSupportPreference` row per option, in **real columns** (`selected`, `choice`, `choices`
`String[]`, `other`, `text`, `note`), not a JSON blob, so a report can filter on them;
`normalizeResponse` validates an answer against its option and returns the columns (or "empty",
which deletes the row). One set per partner.

An option is **retired** (`active: false`) rather than deleted so answers survive; a retired
option is still shown to a partner that answered it and can't be newly answered. Its `kind` can't
change once answered. Deleting an option cascades to its answers. Access is the contact log's:
`readableNeedPartnerIds` (staff everywhere; a guest only on partners they hold a care team seat
on; a trip leader none), and a viewer reads but doesn't write. Nothing here is public, in the
booklet or in a dispatch. Both tables are in `backup.js`'s `MODELS`; the _Support preferences_
report (`reporting/reports/partners.js`) lists responses per partner and option, or the
partners with none recorded, masking a restricted partner's answers like its other sensitive fields.

### 5.9 Partner surveys (#419)

Behind the `surveys` feature (off by default; sending links also needs outbound
email). A church builds surveys as **data**: `Survey` (title, intro, `status` draft | open | closed,
optional `closesAt`) with ordered `SurveyQuestion` rows (`kind` single | multiple | text | yesno,
`choices`, `allowOther`, `required`). A person sends each chosen partner a personal link
(`SurveyInvite`, a random token stored only as a SHA-256 hash, 30-day expiry, one per survey and
partner; sending again issues a new token and the old link stops working). The app never emails
a partner on its own: every send, and every reminder, is started by a person who reviews the
recipient list first. It never emails a restricted partner, one marked "don't contact directly",
or one whose ticked ways exclude email (`emailBlockReason`), and never on a demo.

Answers are one `SurveyResponse` per survey and partner with `SurveyAnswer` rows in **real
columns** (`value`, `values`, `other`) plus the question's `label` and `kind` as worded when
answered, so an edited or deleted question leaves answers readable; `questionId` is cleared on delete.
The partner answers at `/survey/:token` (`routes/publicSurveys.js`): no login, rate limited, and every
failure (unknown, expired, survey not open) answers identically; the page carries only the survey's
own questions and the partner's own saved answers. They can save and finish later, and change answers
through the same link until the survey closes. Staff or a guest on the partner's care team can fill one in
on their behalf (`PUT /api/surveys/:id/partner/:partnerId`, `entered by` recorded); an admin or editor can
reopen a submitted response. Access to a partner's answers is the contact log's (`readableNeedPartnerIds`;
a trip leader none; a viewer reads). Nothing here is public, in the booklet or a dispatch. All five tables
are in `backup.js`'s `MODELS`. The _Survey responses_ report lists who is waiting, who answered and who has
not been sent a survey.

**Templates.** There are none in code: starting surveys are template packs (§5.10).

**Updating the record from answers.** A `SurveyQuestion.field` links a question to a key in
`utils/surveyFields.js` (a deliberately short list: primary contact's phone, email and preferred method,
emergency contact, a one-line overview, and `photo`; never visibility, restricted status, location, contact level or
names). When a response is submitted, `proposeFromResponse` (`utils/surveyProposals.js`) replaces the response's pending
`SurveyProposal` rows with one per linked answer that differs from the record (a photo always proposes). It writes
nothing to the record. `routes/surveyUpdates.js` (admin/editor, behind `surveys`) lists them; **approve**
validates the value (or an edited one) and writes it through the same columns the partner page edits, inside the
approver's request so last-edited-by and the audit log (`survey.update_approved`) credit them; **reject** leaves the
record alone. A decided value for the same question and response is not proposed again. A partner's photo arrives at
`POST /api/public/survey-uploads/:token/:questionId` (own 7 MB body limit and a tighter rate limit; JPEG, PNG, WebP or
HEIC, signature-checked, HEIC stored as JPEG, 5 MB cap), is held in `SurveyUpload`, and becomes a `Photo` only on approval;
a rejected one is deleted. The review route serves a held photo with `nosniff` and a sandboxing CSP. Both new tables are in
`backup.js`'s `MODELS`. The _Survey updates_ bell category counts pending proposals.

Deferred: bell alerts for new answers, scheduled reminders, per-adult responses, offering the support-preferences menu
as a survey, and linking a question to a mailing address or other multi-column fields.

### 5.10 Template packs

The app ships no church content in code (the fork-upgradability rule). Starting points are **template
packs**: JSON envelopes `{ format: "missions-partner-tracker-pack", version: 1, kind, title, description,
data }` (`utils/templatePacks.js`). Each `kind` (`survey`, `supportMenu`, `applicationQuestions`,
`tripRequirements`, `dispatchWording`) has a strict zod schema for `data`, a preview summary, an `apply`
and an `exportData`. `routes/templatePacks.js` (admin only; 1 MB body limit) offers `POST /preview`,
`POST /import` and `GET /export/:kind`; each kind needs the feature it belongs to (surveys,
supportPreferences + careTeam, trips; wording needs none). Import is **additive**: existing options,
questions and requirements are never deleted, a duplicate (same group+label, or label) is skipped so a
re-import adds nothing, and a survey arrives as a draft. The exception is `dispatchWording`, which replaces the
fields it contains (the preview says so). A survey question's `field` is validated against
`utils/surveyFields.js` like the builder does. Import is audited (`settings.updated`).

Examples live in `examples/template-packs/` (see its README) and are the only copy of that content; the demo
seed imports them through `utils/packFiles.js`, and a test asserts every file validates and carries no church's
name. A new install starts with every one of these areas empty and a prompt to import; existing installs keep
their data.

### 5.8 Wrapping up a trip (#358)

`POST /api/trips/:id/wrap-up` (admin, editor, or a guest for a trip they hold a grant on:
`requireTripScope`, the same reach as editing the trip) finishes a trip in one step: it sets
`status` to `completed`, records `wrappedUpAt` (kept on a later run, so editing the debrief doesn't
move it), may correct `startDate`/`endDate` and the album link, and stores the debrief in four plain
text columns (`debriefWhatWeDid`, `debriefWentWell`, `debriefWasHard`, `debriefPartnerNeeds`, all
optional, an empty answer stored as null). With `followUp.logContact`, the contact log on, a partner
on the trip, and a caller who may use the log for that partner (`readableNeedPartnerIds`: staff, or a
guest on its care team; never a trip leader with only a trip grant), it also adds a `ContactLog` entry
(visit, outbound, topic `trip`) with the optional follow-up date; the response says whether it did.
Nothing is emailed. Ending leader access stays with the existing grant routes (the wizard links to the
Team tab). Two bell categories read it: `tripsReadyToWrapUp` (trip-scoped: end date passed, not
completed) and `tripsWrappedUp` (the partner's care team, for 14 days).

## 6. The dispatch system (#202 redesign + WhatsApp)

Visual diagram, with the admin-vs-public and GroupMe-vs-WhatsApp
screenshot comparisons: [docs/dispatch-pipeline.html](docs/dispatch-pipeline.html).

Verified directly against the current code — matches the published
design closely; the two real additions beyond it are an inline "approve
now" path at creation time (see 6.5) and a fourth channel, WhatsApp,
added afterward as a sibling of GroupMe rather than a new kind of thing
(see 6.2a).

### 6.1 The model

Every event is **always recorded**, with exactly one exception: a
restricted partner's event is only recorded at all if
`ChurchSettings.allowRestrictedPartnerDispatch` is on (checked once,
at `createDispatchRecord()`, re-fetching `isRestricted` fresh by id rather than
trusting the caller's own partner shape). Every other setting — the chat
channels' content-type mutes, cadence tiers, review state — only ever
affects _delivery_, never recording.

Once recorded (`DispatchRecord`), four channels each independently
decide, at send time, whether a given row belongs in their send, via one
shared function:

```
isEligibleForChannel(row, channel, partner, settings, hasEligibleRecipient)
  Rule 1 (universal): restricted-and-unreviewed -- or reviewRequired-and-
                       unreviewed (a care team member's submission, #289)
                       -- blocks every channel,
                       for the types REVIEW_GATED_TYPES covers (newsletters
                       are exempt — buildBlurb() already suppresses them
                       to nothing regardless of review state)
  Rule 2 (per-channel): GroupMe's and WhatsApp's shared content-type
                       mutes; the public digest's structural
                       prayer-requests-only + isPublic check; the admin
                       digest has no Rule 2 at all
  Rule 3: is anyone actually there to receive it right now (computed by
          the caller, per channel)
```

A row clears (is deleted) once every channel's requirement is either
permanently resolved (ineligible by type/structure, or a toggle/feature
that was off when evaluated — also permanent, not retried if re-enabled
later) or actually sent (that channel's own stamp column is set).
`clearDispatchRecords()` (`dispatchOrchestrator.js`) is also where
a WhatsApp-specific wrinkle lives: a row only counts as WhatsApp-
applicable once its content type resolves to _some_ WhatsApp group (its
own pick or the community's Announcements fallback — see 6.2a); a type
with nowhere to go would otherwise wait in the queue forever for a
channel that can never take it.

### 6.2 The four channels

| Channel          | Schedule                                                                       | Content                                                                                    | Recipients                                                                     |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **GroupMe**      | Shared daily chat hour (`chatDispatchHour`)                                    | All 5 event types, each content-type independently mutable; plus 3 opt-in care types (below) | One church-wide group, split across up to 3 Topics (prayer/needs/newsletters)  |
| **WhatsApp**     | Same shared daily chat hour, own cursor (`lastWhatsappChatDispatchSentAt`)     | Same 5 types, same mutes (shared with GroupMe — see 6.2a)                                  | One WhatsApp community, split across up to 3 groups (prayer/needs/newsletters) |
| **Admin email**  | 3 cadence tiers: biweekly/monthly/quarterly (`emailDispatchHour` + day fields) | Every type, no content-type toggle                                                         | Each `User` with `cadence` set, scoped to `allPartners` or `followedPartners`  |
| **Public email** | Same 3 tiers, shared schedule with admin                                       | Structurally prayer-requests-only (`prayerRequestCreated`/`Answered`), never a source link | Each confirmed `PublicSubscriber`, scoped to `allPartners` or `scopedPartners` |

Admin and public recipients are normalized into one shape and run through
one shared send loop (`emailDispatchDelivery.js`'s `sendToRecipients`), chunked
at 250 messages per Postmark batch call. GroupMe and WhatsApp are each a
genuinely separate pass (no per-recipient loop — their only "recipient"
is the group/community itself).

### 6.2a GroupMe and WhatsApp are siblings, not one feeding the other

WhatsApp was added after the original three-channel design, as the same
_kind_ of channel as GroupMe rather than a new category — both are
chat-style and close to real-time, so both earned the daily-hour model
email's weekly/monthly tiers were never a fit for. The two channels are
fully independent features (separately toggled, separately configured,
separately paired/connected) that happen to share two things on purpose,
plus one thing by coincidence of naming:

- **The schedule itself**: `chatSchedule.js`'s `shouldFlushDailyChatChannel()`
  is the one function both `groupmeChannel.js` and `whatsappChannel.js`
  call, reading the shared `ChurchSettings.chatDispatchHour` but each
  channel's own dedupe cursor (`lastGroupmeChatDispatchSentAt` vs.
  `lastWhatsappChatDispatchSentAt`) and own per-row stamp (`groupmeDispatchedAt` vs.
  `whatsappDispatchedAt`). One channel being down (a revoked GroupMe token, a
  disconnected WhatsApp number) never blocks or double-stamps the other
  — `sendGroupMeUrgent`/`sendWhatsAppUrgent` in
  `dispatchOrchestrator.js` even run concurrently, each in its own
  try/catch, specifically so one provider's failure can't silently skip
  the others (a real bug this fixed — see that file's own comment).
- **The three content-type mutes**: `chatDispatchPrayerRequests`/
  `OneTimeNeeds`/`Newsletters` gate both GroupMe and WhatsApp identically
  (`dispatchEligibility.js`'s Rule 2 checks `channel === GROUPME ||
channel === WHATSAPP` against the same three columns).
- **Coincidence, not sharing**: the text each channel posts both come
  from `buildBlurb()`'s `groupmeText` field (see 6.3) — a historical
  name for what's actually channel-neutral chat content, reused by
  WhatsApp with no WhatsApp-specific rendering logic needed. Packing
  differs: WhatsApp allows much longer messages (4,000 chars vs.
  GroupMe's shorter limit), so `whatsappChannel.js` has its own
  `packMessages`/`splitLongText`.

WhatsApp's own targeting model has no GroupMe equivalent: each content
type picks its own WhatsApp group (`whatsappPrayerGroupId`/
`OneTimeNeedGroupId`/`NewsletterGroupId`), falling back to the
community's Announcements group (`whatsappAnnouncementGroupId`,
auto-resolved when the community is picked — `whatsappClient.js`'s
`findAnnouncementGroup`) when a specific group isn't set. Resolving
"does this row have anywhere to go" (`hasWhatsAppTarget()`) deliberately
checks only whether a group resolves, never whether the number is
_currently_ connected — a live-pairing check was tried and reverted: it
treated a normal brief reconnect window on every deploy the same as a
deliberate, permanent unlink, which isn't what a transient disconnect
means.

**Partner care posts.** Three chat-only dispatch types, `keyDateComing`, `quietPartner`
and `updateToPassOn` (`utils/careChatDispatch.js`, a daily 05:00 church-local cron
in the scheduled jobs), share one topic/group (`groupmeCareTopicId`, `whatsappCareGroupId`) and have
their own opt-in switches (`chatDispatchKeyDates`, `chatDispatchQuietPartners`,
`chatDispatchUpdatesToPass`, all default off), checked in `isEligibleForChannel` Rule 2.
They are recorded only while GroupMe or WhatsApp is on and the matching feature (keyDates,
contactLog) is on, never on a demo, and each occurrence once (`CareChatPost`: type,
subjectKey, occurrence date, tier). `CARE_DISPATCH_TYPES` are ineligible for both email
audiences: the digest has its own key-dates section (§5.4) and the bell carries the rest.
Restricted partners are masked by `buildBlurb` (no `who`, no need or prayer text), and a
restricted partner whose dispatch is off records nothing.

### 6.3 Masking authority

`dispatchBlurbs.js`'s `buildBlurb()` is the single place every channel
gets its rendered content from — none of GroupMe/WhatsApp/admin-digest/
public-digest ever reads a raw `DispatchRecord` field directly. For a
restricted partner, it substitutes initials for the real name and a
generic "details withheld" line for the real content, and never includes a
source-file link. `isRestricted` is read fresh at build time, not from
the event's frozen payload, so a flag flipped after recording still takes
effect. WhatsApp inherits all of this with zero WhatsApp-specific masking
code — it reads the same `groupmeText` field GroupMe does (see 6.2a).

### 6.4 Urgent dispatch

`PrayerRequest.isUrgent`/`SupportNeed.isUrgent` (admin/editor-settable at
creation) trigger `sendUrgentDispatch()` — an immediate, cadence-
bypassing send across all four channels for that one row (GroupMe and
WhatsApp concurrently via `sendGroupMeUrgent`/`sendWhatsAppUrgent`, plus
email). It still calls `isEligibleForChannel` per channel exactly like a
scheduled pass; only Rule 3's cadence-tier matching is bypassed (every
eligible recipient, regardless of tier). The restricted-partner review
gate and every content-type/structural rule still apply — "urgent" only
skips waiting for a schedule. Each channel's send is wrapped in its own
try/catch so one provider failing (GroupMe, WhatsApp, or email) can't
silently suppress the others.

### 6.5 Divergence from the original design doc

The shipped code adds an inline **"approve now"** path not in the
original plan: a creation route can pass `review: { reviewerId,
reviewedText }` straight into `createDispatchRecord`, writing `dispatchReviewedAt`/
`dispatchReviewedById`/`dispatchReviewedText` in the same create call — letting an
admin/editor who just typed a restricted partner's text confirm it's
safe to send immediately, instead of always needing a separate trip to
the Updates to share queue. The other divergence is WhatsApp
itself (6.2a) — not in the original three-channel design at all, added
later as a sibling of GroupMe rather than a redesign of anything.
Otherwise the as-shipped system matches the design doc's model, naming,
file organization, and schema changes precisely (verified file-by-file:
`dispatchRecording.js`, `dispatchEligibility.js`,
`dispatchOrchestrator.js`, `groupmeChannel.js`, `whatsappChannel.js`,
`chatSchedule.js`, `emailDispatchDelivery.js`, `emailDispatchScheduler.js`,
`emailDispatchShell.js`, `adminEmailDispatchContent.js`, `publicEmailDispatchContent.js`).

## 7. Public vs. admin surface boundary

Any logged-in session (any role) sees every partner's complete,
unmasked record — the boundary is the session, not the role (§5). The
**public** site is the only place real masking happens, applied once, in
`maskData.js`'s `toPublicPartner()`:

|                                        | Public, not restricted          | Public + restricted                                                                         |
| -------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| Name                                   | real                            | initials only (`toInitials`)                                                                |
| Photo                                  | real, current upload            | generic silhouette (household-shape or building icon — never a real photo, even anonymized) |
| Map pin                                | precise `gpsLat`/`gpsLng`       | country-level centroid only (`COUNTRY_CENTROIDS`)                                           |
| Overview                               | real `overview`/`overviewShort` | fixed generic "serving in a restricted-access location" text                                |
| Links, languages, sending party        | included                        | omitted entirely                                                                            |
| Contact info, internal notes, user ids | never included either way       | never included either way                                                                   |

A non-public partner (`isPublic: false`) never reaches the public API at
all — `toPublicPartner` returns `null` for it, and the route filters
those out. The same restricted-masking logic is independently
re-implemented (not shared code, but the same rule) in the dispatch
system's `dispatchBlurbs.js`, since a GroupMe post or a digest email
leaves the app's auth boundary the same way the public site does.

## 8. Deployment & environments

### 8.1 Topology

One Render web service serves both the built frontend and the API from
one process (`backend/src/server.js`); one Postgres database holds
everything, including every uploaded file's bytes. `render.yaml` is a
one-click Blueprint: one `web` service + one `database`, no other
infrastructure. `preDeployCommand` runs `prisma migrate deploy` before
the new version takes traffic.

### 8.2 One repo, two Render deployments

All work happens in this one repo (`missions-partner-tracker`): `dev` →
PR → `main`, CI-gated. Two Render services watch it directly, no second
repo in between:

| Service                                      | Branch | Purpose                                                                                 |
| -------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| `dev-missions-partner-tracker`               | `dev`  | Pre-prod test site — every push deploys, for fast live-site checks before a release PR. |
| `missions-partner-tracker` (production demo) | `main` | The live public demo. Deploys on every PR merge to `main`.                              |

An earlier setup ran the production demo from a second repo
(`missions-partner-tracker-demo`) that merged `upstream/main` in on its
own schedule. Collapsed back into this one repo: the demo isn't a real
independent stakeholder the way a church's own deployment is (see
below), so the extra repo only added overhead — a second PR per release,
a second repo-settings panel to keep in sync, two independently-driftable
Render configs — without buying any actual isolation this project needed.
Demo-only operational details (its own `render.yaml`, the real secrets
the nightly reset and `backend/scripts/reset-demo-db-remote.js` need)
now live in `demo/` at the repo root instead — see that folder's own
README.

A real church's own deployment is different: forked fresh from this repo
when needed, updated on its own cadence via `git merge upstream/main`,
genuinely independent. See [CONTRIBUTING.md § Downstream
instances](CONTRIBUTING.md#downstream-instances) for the exact mechanics.

### 8.3 Migration strategy (pre-1.0)

A single squashed baseline migration rather than an accumulated history —
every schema change is edited directly into it. This means `prisma
migrate deploy` against an already-provisioned database (demo, or any
fork) requires `migrate reset --force` whenever the baseline's SQL
changes, not an incremental `deploy`. `migrate deploy` itself does not
notice: the migration keeps its name, so it reports "No pending
migrations" and succeeds, and the pre-deploy step does **not** reliably
fail. What makes the deploy fail safely is the start-up check in
`utils/schemaCheck.js`: Prisma records a SHA-256 of each migration file
when it applies it, and the server compares those with the files in this
code before it listens; on a mismatch (or a migration not applied) it
prints why and exits, so the new version never goes live and Render
leaves the previous one serving. `SKIP_SCHEMA_CHECK=true` skips the
check (RUNBOOK.md). Recovery procedure: `demo/README.md`. Intentional
until 1.0.0 ships; will need to stop once there's real production data
anywhere.

### 8.4 Environment variables

Generated automatically by Render on first deploy: `DATABASE_URL`,
`SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`. Operator-set, optional:
`MFA_ISSUER`, `NOMINATIM_CONTACT`. Also read by the app but not declared
in `render.yaml` (either Render-provided automatically, or only relevant
to specific deployment modes): `RENDER_EXTERNAL_URL`/`APP_BASE_URL`
(digest/unsubscribe link base), `DEMO_RESET_TOKEN` (only present on the
demo deployment; its absence is what makes `/api/demo` not exist at all
elsewhere), `DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD` (demo reset script).

## 9. Known rough edges

Separate from the factual description above — things noticed while
reading the code that a rewrite audit would want to know about. None of
these are bugs severe enough to block current operation.

1. **No index on `DispatchRecord`'s stamp/review columns.** The model
   has `@@index([type])` and `@@index([partnerId])` but nothing on
   `dispatchReviewedAt`, `groupmeDispatchedAt`, or the three email-dispatch-sent-at columns,
   all of which `clearDispatchRecords()` and the per-channel send passes
   filter/scan on every pass. Harmless at this app's actual scale (one
   church's queue, cleared regularly), but worth knowing if event volume
   or send frequency ever grows.
2. **Two independent per-minute cron registrations** (`emailDispatchScheduler.js`,
   `groupmeChannel.js`'s own trigger) with no coordination beyond both
   calling the same `clearDispatchRecords()` afterward. Explicitly
   justified in-code as fine at one-instance scale, with a named fix
   (`node-cron`'s `distributed: true`) if the app is ever scaled
   horizontally — flagged here only so a rewrite doesn't have to
   rediscover that this was a conscious tradeoff, not an oversight.
   Related: nothing in the code enforces single-instance today — a
   second instance would double-send with no warning.
3. **`SendingParty`, `Address`, and `ChurchSettings.address` all re-declare
   the same address-field shape** (`addressLine1`/`addressLine2`/`city`/
   `stateProvinceRegion`/`postalCode`/`country`) three times — twice as
   real columns, once as a JSON blob — rather than a shared embeddable
   type. Prisma has no first-class composite/embedded type for Postgres
   that would unify this cleanly today, so this may be an accepted
   limitation rather than an oversight; worth confirming either way in a
   rewrite that might use a different ORM or database.
4. **Digest-email customization (`emailDispatchSubjectTemplate`, `emailDispatchSignature`,
   `emailDispatchLayout`) lives on `ChurchSettings` as free columns**, with
   `{church}/{month}/{year}/{date}/{cadence}/{name}/{term}` token
   substitution implemented by hand in `emailDispatchShell.js` rather than a
   real template engine. Deliberately minimal per its own comment ("an
   admin writes plain text, not a real template language"), but worth
   flagging as a spot where a future feature request (more tokens,
   conditionals) would need either a bigger rewrite of that one function
   or an explicit decision to keep refusing that scope.
5. **The entire dispatch system's correctness rests on every call
   site remembering to route through `buildBlurb()`** rather than reading
   a `DispatchRecord` row's raw fields — enforced by convention and code
   review, not by the type system or a lint rule. All four current
   channels (GroupMe, WhatsApp, admin email, public email) do this
   correctly (verified directly), but nothing would catch a future
   channel or a careless edit that reads `row.payload` directly and
   leaks a restricted partner's real content.
