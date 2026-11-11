# SPEC.md

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
baseline migration (`backend/prisma/migrations/20261106200717_init/`)
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

| Field | Purpose |
|---|---|
| `isPublic` | Shows on the public site at all. |
| `isRestricted` | When combined with `isPublic`: masked to a generic, anonymized view on the public site and in every dispatch (see §7). |
| `archived` / `archivedAt` | Soft delete — hides from admin lists, forces `isPublic` off, zeros monthly support via a new `$0` `SupportEntry` (history is never edited). Hard delete is only permitted once archived. |
| `sentByOurChurch` | Missionary-only: true when *this* church (`ChurchSettings`) is the sending church. Distinct from the `SendingParty` relation, which records whichever church actually sends them. |
| `contactSafe` | Missionary-only: whether it's OK to contact them directly. |
| `overview` vs `overviewShort` | Long-form narrative vs. a one/two-line summary for list/card contexts. |
| `fieldDisplayName` | A public-safe location label ("Northern Uganda") independent of the precise address — safe to show even when restricted. |

Collections are independent resources with their own CRUD endpoints, never
written as a nested array on a `Partner` update — doing so would delete
and recreate every child row on each save, churning ids and destroying
rows added concurrently through their own endpoint.

### 1.2 Entity relationship summary

```
Partner (missionary | organization)
├── Adult[] / Child[]                  missionary-only household members
├── Address[]                          at most one per type: "physical" | "mailing"
├── Trip[] → TripParticipant[]         past team trips to visit this partner
├── Furlough[]                         missionary-only, time off-field
├── ChurchVisit[]                      partner visiting this church (reverse of Trip)
├── SendingParty[]                     missionary-only, "church" | "org", who sent them
├── SupportEntry[]                     monthly-support ledger (append-only history)
├── SupportNeed[]                      one-time financial need + decision
├── PrayerRequest[]                    ongoing/answered prayer content
├── PartnerFile[]                      newsletters/documents, bytes stored in-row
├── Photo[]                            full upload history, bytes stored in-row
├── DispatchRecord[]                   recorded dispatch-system events
├── UserFollowedPartner[]              admin digest scoping (join row)
└── PublicSubscriberPartner[]          public digest scoping (join row)
```

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
- **Audit fields (`createdById`/`updatedById`) exist only on `Partner`**,
  deliberately — they used to be inconsistently populated elsewhere, and
  half-populated provenance was judged worse than none.

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

| Mount | File | Gating | Owns |
|---|---|---|---|
| `/api/auth` | `auth.js` | mixed (see §5) | setup, login, MFA, password change, digest-email self-service, unsubscribe link, logout |
| `/api/partners` | `partners.js` | session (any role) | Partner CRUD, photo upload, archive/unarchive/delete, sync-sending-church |
| `/api/public/partners` | `publicPartners.js` | open | masked public partner list/detail |
| `/api/users` | `users.js` | admin only | user management |
| `/api/public/country-info` | `countryInfo.js` | `joshuaProject` feature | Joshua Project proxy |
| `/api/support-needs` | `supportNeeds.js` | session | one-time need CRUD |
| `/api/support-entries` | `supportEntries.js` | session | monthly-support ledger |
| `/api/prayer-requests` | `prayerRequests.js` | session | prayer request CRUD |
| `/api/trips` | `trips.js` | session | trip CRUD |
| `/api/reports` | `reports.js` | session, `reports` feature | report picker + run (JSON/CSV) |
| `/api/partner-files` | `partnerFiles.js` | session, `partnerFiles` feature | newsletter/document CRUD, download, AI scan |
| `/api/photos` | `photos.js` | open | raw photo bytes |
| `/api/silhouette` | `silhouette.js` | open | generic SVG placeholder photos |
| `/api/settings` | `settings.js` | session (read) / admin (write) | church profile, branding, GroupMe, email, dispatch config, Joshua Project/AI Extraction keys |
| `/api/public/settings` | `publicSettings.js` | open | public-safe settings + logo bytes |
| `/api/version-check` | `version.js` | admin | upstream version comparison |
| `/api/system-info` | `systemInfo.js` | admin | runtime/DB diagnostics |
| `/api/backup-check` | `backupCheck.js` | admin | backup-reminder state |
| `/api/backups` | `backups.js` | admin | full DB export (NDJSON.gz) |
| `/api/inbound-email` | `inboundEmail.js` | mixed (see below) | Postmark webhook + review queue |
| `/api/dispatches` | `dispatches.js` | session (read) / admin+editor (write) | pending-dispatch review queue |
| `/api/public/subscribe` | `publicSubscribe.js` | open, `publicPrayerDigest` feature | public digest signup + confirm |
| `/api/public/unsubscribe` | `publicUnsubscribe.js` | open | public digest unsubscribe |
| `/api/scoped-digest` | `adminScopedDigest.js` | session | subscriber counts |
| `/api/demo` | `demo.js` | token (only mounted if `DEMO_RESET_TOKEN` set) | demo DB reset |
| `/api/health` | inline in `server.js` | open | liveness |

`inboundEmail.js` is genuinely mixed: `POST /postmark` is Postmark's own
webhook, authenticated by HTTP Basic Auth (constant-time compare) because
Postmark has no HMAC signature support for inbound mail; every other
route in the file is the normal admin review queue behind a session.

### 2.3 Utility layer (`backend/src/utils/`)

Each file owns one narrow responsibility:

| File | Responsibility |
|---|---|
| `features.js` | Canonical feature registry — single source of truth (§4). |
| `maskData.js` | `toPublicPartner()` — the public/restricted masking authority for the partner API (§7). |
| `crypto.js` | AES-256-GCM field-level encryption for reversible secrets (TOTP, integration tokens). |
| `jwt.js` | Session cookie signing/verification (httpOnly + Secure + SameSite=Lax). |
| `extraction.js` | Claude-based extraction of prayer requests/one-time needs from an uploaded newsletter/document. |
| `joshuaProject.js` | Server-side proxy for Joshua Project's country-stats API. |
| `backup.js` | Builds the full-database NDJSON.gz export. |
| `backupCheck.js` | Guesses the Postgres provider from `DATABASE_URL`'s hostname, for a tailored reminder message. |
| `birthdays.js` | Pure calendar arithmetic for the Upcoming Birthdays report. |
| `csv.js` | Hand-written RFC 4180 CSV serialization (no dependency). |
| `fileResponse.js` | Serves a DB-stored file back to the browser; decides `inline` vs. attachment based on whether its signature was verified on upload. |
| `fileSignature.js` | Magic-number verification of uploaded file content vs. declared type. |
| `geocode.js` | OpenStreetMap Nominatim forward-geocoding (city/state/country granularity only). |
| `photoUrls.js` | Turns a `Photo` row's id into its servable URL. |
| `prismaIncludes.js` | The shared `{id, kind, displayName}` partner-reference select. |
| `sendingParty.js` | Reshapes the `SendingParty` relation into `sendingChurch`/`sendingOrg`. |
| `silhouette.js` | Generates the generic SVG placeholder photos (never a real human photo). |
| `subscriberPage.js` | Shared branded HTML shell for confirm/unsubscribe landing pages. |
| `upload.js` | Shared multer config: extension resolution + rejection. |
| `versionCheck.js` | Compares the running version against upstream's latest tag. |
| `email.js` | `sendEmail`/`sendEmailBatch` over Postmark. |
| **Dispatch system (9 files)** | See §6. |

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

| Integration | Used for | Key storage | Feature flag |
|---|---|---|---|
| Postmark (outbound) | Admin/public digest email, test-email | `ChurchSettings.postmarkServerToken` (encrypted) | `outboundEmail` |
| Postmark (inbound) | Auto-filing incoming newsletters/documents | same token; webhook creds separate | `inboundEmail` |
| GroupMe | Posting prayer requests/needs/newsletters to church Topics | `ChurchSettings.groupmeAccessToken` (encrypted) | `groupme` |
| Joshua Project | Country-level unreached-people-group stats | `ChurchSettings.joshuaProjectApiKey` (encrypted) | `joshuaProject` |
| Anthropic (Claude) | AI extraction of requests/needs from uploaded documents | `ChurchSettings.anthropicApiKey` (encrypted) | `aiExtraction` |
| OpenStreetMap Nominatim | Forward geocoding on address save | none (free, no key) | always on |
| OpenStreetMap / ArcGIS tiles | Public map basemap | none | `publicMap` |

Every encrypted `ChurchSettings` secret is explicitly `omit`ted from every
query outside its own dedicated settings sub-route — enforced by
discipline at each call site, not a schema-level guarantee.

## 3. Frontend architecture

Vite + React, `BrowserRouter`. Entry bundle (`main.jsx`) deliberately only
imports the public-site pages and `Login`/`Setup` eagerly; every admin
page and the public map/booklet are `lazy()`-loaded, for two reasons
stated directly in the code: an anonymous visitor to the public directory
should not download a readable map of the entire admin surface, and the
map (Leaflet) and booklet (paged.js + a 980-line print stylesheet) are
too heavy to make every visitor pay for.

### 3.1 Routing

**Public** (no login): `/` (directory), `/map`, `/partners/:id`,
`/subscribe`, `/login`, `/setup`. Each public route is wrapped in
`RequirePublicSite`, gated on the relevant feature flag(s), not auth.

**Admin** (`/admin/*`): one shared layout (`AdminLayout` → `AdminSidebar`
+ `Outlet`) behind `RequireAdminAuth` (any logged-in role). Sub-routes are
further gated by `RequireAdminFeature` (feature flag) and, for
`/admin/settings/*`, a second `RequireAdminAuth requiredRole="admin"`.
`/admin/settings` has no shared layout wrapper — each settings page owns
its own heading, since it's reached via the sidebar's expandable group,
not a same-page tab bar.

### 3.2 Page inventory

**Public surface:** `PublicDirectory`, `PublicMap`, `PublicPartnerDetail`,
`PublicSubscribe`, `Login`, `Setup`.

**Admin — content:** `AdminHome`, `AdminPartners`, `AdminPartnerForm`,
`AdminPartnerDetail` (the ~1,000-line single edit form was replaced by
per-section inline editing via `EditableSection.jsx` — see §3.3),
`AdminPrayerRequests`, `AdminOneTimeNeeds`, `AdminMonthlySupport`,
`AdminTripHistory`, `AdminTripOpportunities`, `AdminPartnerFiles`,
`AdminBooklet`, `AdminReports`.

**Admin — communications:** `AdminInboundEmailQueue`,
`AdminPendingDispatches`, `AdminDispatchSettings`.

**Admin — site administration:** `AdminSettingsAbout`,
`AdminSettingsBranding`, `AdminSettingsFeatures`, `AdminSettingsGroupMe`,
`AdminSettingsJoshuaProject`, `AdminSettingsAiExtraction`,
`AdminSettingsEmail`, `AdminSettingsBackups`, `AdminSystemInfo`,
`AdminUsers`, `AdminUserForm`.

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
- `ApiKeySettingsPage` — the shared shell behind both
  `AdminSettingsJoshuaProject` and `AdminSettingsAiExtraction` (previously
  two near-identical hand-written pages).
- `PartnerSelect`, `AddressFields`, `SendingPartySection`,
  `PresetOrCustomSelect`, `AlbumLinkField`, `SourcePicker`/`SourceLink` —
  reusable form building blocks shared across the partner-detail sections
  and the Trip/Monthly-Support/Prayer-Request/One-Time-Need pages.
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

| Key | Label | Default | Group | Depends on |
|---|---|---|---|---|
| `publicDirectory` | Public directory | on | public | — |
| `publicMap` | Public map | on | public | — |
| `partnerFiles` | Newsletters & Docs | on | admin | — |
| `prayerRequests` | Prayer requests | on | admin | — |
| `oneTimeNeeds` | One-time needs | on | admin | — |
| `monthlySupport` | Monthly support | on | admin | — |
| `trips` | Mission trips | on | admin | — |
| `booklet` | Print booklet | on | admin | — |
| `reports` | Reports | on | admin | — |
| `outboundEmail` | Email (Sending) | **off** | admin/communications | — |
| `inboundEmail` | Email (Receiving) | **off** | admin/communications | — |
| `groupme` | GroupMe dispatch | **off** | admin/communications | — |
| `publicPrayerDigest` | Public prayer digest | **off** | admin/communications | `publicDirectory` + `outboundEmail` |
| `aiExtraction` | AI Features | **off** | admin/integrations | — |
| `joshuaProject` | Joshua Project stats | **off** | admin/integrations | — |

`isAnyFeatureEnabled` supports "reachable if at least one of N is on" —
used for the public partner data routes (back both directory and map) and
the shared Email settings page (reachable if either direction is on).

## 5. Auth & permissions model

**"Auth is the boundary."** Any logged-in account — any role — reads
every partner's full, unmasked record, including restricted ones (see
`reports.js`'s own comment: gating a read to admin-only would be the
*first* read in the app gated by role, "contradicting a decision made
deliberately rather than by omission"). Roles exist to gate **writes**,
not visibility:

| Role | Can read | Can write |
|---|---|---|
| `viewer` | everything | nothing |
| `editor` | everything | partner content (create/update, not delete), prayer requests, one-time needs, trips, files, archive/unarchive |
| `admin` | everything | everything editor can, plus: delete, user management, church settings, GroupMe/email/integration config, backups, system info |

- **Session**: httpOnly + Secure + SameSite=Lax JWT cookie, 8h TTL. Every
  request re-reads the user row from the DB (not just the JWT claims) so
  a deactivation/role-demotion takes effect on the user's very next
  request, not at token expiry.
- **MFA**: self-service TOTP, opt-in per user; an admin can force
  enrollment (`mfaSetupRequired`) without knowing the secret. Replay
  protection via `mfaLastTimeStep`. SSO was removed in 3.1.0 — auto-
  provisioning handed an account to anyone at the configured identity
  provider, which in a "any account reads everything" app was judged too
  wide; `authProvider` stays on the schema so `local`-only password auth
  can keep refusing anything else.
- **No per-resource ownership model** — there is no "editor can only edit
  their own partners" concept anywhere in the schema or routes.

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
affects *delivery*, never recording.

Once recorded (`DispatchRecord`), four channels each independently
decide, at send time, whether a given row belongs in their send, via one
shared function:

```
isEligibleForChannel(row, channel, partner, settings, hasEligibleRecipient)
  Rule 1 (universal): restricted-and-unreviewed blocks every channel,
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
applicable once its content type resolves to *some* WhatsApp group (its
own pick or the community's Announcements fallback — see 6.2a); a type
with nowhere to go would otherwise wait in the queue forever for a
channel that can never take it.

### 6.2 The four channels

| Channel | Schedule | Content | Recipients |
|---|---|---|---|
| **GroupMe** | Shared daily chat hour (`chatDispatchHour`) | All 5 event types, each content-type independently mutable | One church-wide group, split across up to 3 Topics (prayer/needs/newsletters) |
| **WhatsApp** | Same shared daily chat hour, own cursor (`lastWhatsappChatDispatchSentAt`) | Same 5 types, same mutes (shared with GroupMe — see 6.2a) | One WhatsApp community, split across up to 3 groups (prayer/needs/newsletters) |
| **Admin email** | 3 cadence tiers: biweekly/monthly/quarterly (`emailDispatchHour` + day fields) | Every type, no content-type toggle | Each `User` with `cadence` set, scoped to `allPartners` or `followedPartners` |
| **Public email** | Same 3 tiers, shared schedule with admin | Structurally prayer-requests-only (`prayerRequestCreated`/`Answered`), never a source link | Each confirmed `PublicSubscriber`, scoped to `allPartners` or `scopedPartners` |

Admin and public recipients are normalized into one shape and run through
one shared send loop (`emailDispatchDelivery.js`'s `sendToRecipients`), chunked
at 250 messages per Postmark batch call. GroupMe and WhatsApp are each a
genuinely separate pass (no per-recipient loop — their only "recipient"
is the group/community itself).

### 6.2a GroupMe and WhatsApp are siblings, not one feeding the other

WhatsApp was added after the original three-channel design, as the same
*kind* of channel as GroupMe rather than a new category — both are
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
*currently* connected — a live-pairing check was tried and reverted: it
treated a normal brief reconnect window on every deploy the same as a
deliberate, permanent unlink, which isn't what a transient disconnect
means.

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
the Pending Dispatches queue. The other divergence is WhatsApp
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

| | Public, not restricted | Public + restricted |
|---|---|---|
| Name | real | initials only (`toInitials`) |
| Photo | real, current upload | generic silhouette (household-shape or building icon — never a real photo, even anonymized) |
| Map pin | precise `gpsLat`/`gpsLng` | country-level centroid only (`COUNTRY_CENTROIDS`) |
| Overview | real `overview`/`overviewShort` | fixed generic "serving in a restricted-access location" text |
| Links, languages, sending party | included | omitted entirely |
| Contact info, internal notes, user ids | never included either way | never included either way |

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

| Service | Branch | Purpose |
|---|---|---|
| `dev-missions-partner-tracker` | `dev` | Pre-prod test site — every push deploys, for fast live-site checks before a release PR. |
| `missions-partner-tracker` (production demo) | `main` | The live public demo. Deploys on every PR merge to `main`. |

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
changes, not an incremental `deploy` — expected to fail at
`preDeployCommand` on every such release; Render doesn't cut over on a
failed pre-deploy, so the live site stays up throughout. Recovery
procedure: `demo/README.md`. Intentional until 1.0.0 ships; will need to
stop once there's real production data anywhere.

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

1. **A stale comment, not stale behavior**: `backend/src/reports/index.js`
   (lines 18-19) and `backend/src/routes/reports.js` (lines 66-67) both
   say "No church timezone is stored anywhere" as the reason report
   "today" resolution prefers a frontend-supplied query param over the
   server clock. That's no longer true — `ChurchSettings.timezone` was
   added by the #202 redesign specifically so server-side time
   calculations have a real church-local time to use. The *behavior*
   (preferring the browser's own `today`) isn't necessarily wrong, but
   the stated reasoning for it is now incorrect, and nothing currently
   makes `furlough.js`'s Current/Upcoming split or a report's year
   default use the configured timezone as a fallback instead of the raw
   server clock for a direct API call that omits `today`. Worth a
   decision either way, not just a comment fix.
2. **No index on `DispatchRecord`'s stamp/review columns.** The model
   has `@@index([type])` and `@@index([partnerId])` but nothing on
   `dispatchReviewedAt`, `groupmeDispatchedAt`, or the three email-dispatch-sent-at columns,
   all of which `clearDispatchRecords()` and the per-channel send passes
   filter/scan on every pass. Harmless at this app's actual scale (one
   church's queue, cleared regularly), but worth knowing if event volume
   or send frequency ever grows.
3. **Two independent per-minute cron registrations** (`emailDispatchScheduler.js`,
   `groupmeChannel.js`'s own trigger) with no coordination beyond both
   calling the same `clearDispatchRecords()` afterward. Explicitly
   justified in-code as fine at one-instance scale, with a named fix
   (`node-cron`'s `distributed: true`) if the app is ever scaled
   horizontally — flagged here only so a rewrite doesn't have to
   rediscover that this was a conscious tradeoff, not an oversight.
   Related: nothing in the code enforces single-instance today — a
   second instance would double-send with no warning.
4. **`SendingParty`, `Address`, and `ChurchSettings.address` all re-declare
   the same address-field shape** (`addressLine1`/`addressLine2`/`city`/
   `stateProvinceRegion`/`postalCode`/`country`) three times — twice as
   real columns, once as a JSON blob — rather than a shared embeddable
   type. Prisma has no first-class composite/embedded type for Postgres
   that would unify this cleanly today, so this may be an accepted
   limitation rather than an oversight; worth confirming either way in a
   rewrite that might use a different ORM or database.
5. **Digest-email customization (`emailDispatchSubjectTemplate`, `emailDispatchSignature`,
   `emailDispatchLayout`) lives on `ChurchSettings` as free columns**, with
   `{church}/{month}/{year}/{date}/{cadence}/{name}/{term}` token
   substitution implemented by hand in `emailDispatchShell.js` rather than a
   real template engine. Deliberately minimal per its own comment ("an
   admin writes plain text, not a real template language"), but worth
   flagging as a spot where a future feature request (more tokens,
   conditionals) would need either a bigger rewrite of that one function
   or an explicit decision to keep refusing that scope.
6. **The entire dispatch system's correctness rests on every call
   site remembering to route through `buildBlurb()`** rather than reading
   a `DispatchRecord` row's raw fields — enforced by convention and code
   review, not by the type system or a lint rule. All three current
   channels do this correctly (verified directly), but nothing would
   catch a future channel or a careless edit that reads `row.payload`
   directly and leaks a restricted partner's real content.
