# User Guide: Using the App

This covers day-to-day use of the admin dashboard — logging in, managing
partners, tracking support, and everything else you'd do once the app is
already set up and running. If you're looking for installation,
deployment, or infrastructure, see [ADMIN_GUIDE.md](ADMIN_GUIDE.md)
instead.

Screens and actions that require the `admin` role are marked **(Admin
only)** below — see [Understanding your role](#understanding-your-role).

## Logging in

Go to `/login`. Email + password always works. If your church has
single sign-on configured, you'll also see one "Sign in with ..." button
per provider they've enabled (e.g. Entra ID, Google Workspace, Okta) —
use whichever your church set up for you.

If your account has two-factor authentication enabled, you'll be prompted
for a 6-digit code from your authenticator app after your password. If an
admin has *required* MFA on your account but you haven't set it up yet,
you'll be walked through enrollment (scan a QR code, confirm a code)
before you can do anything else.

## Understanding your role

Every user has one of three roles:

| Role | Can do |
|---|---|
| `viewer` | Read-only access everywhere in the admin dashboard. |
| `editor` | Everything a `viewer` can, plus create/edit missionaries, organizations, and support entries, and upload newsletters and documents. |
| `admin` | Everything above, plus delete records, manage users, and edit Church Settings. |

If something you expect to see isn't there (a nav link, a button), it's
almost always a role thing, not a bug — check with whoever manages users
at your church.

## Dashboard overview

The sidebar (and the Home page's card grid, which mirrors it) lists:
**Home**, **Partners** (or your church's custom term, e.g. "Go Team
Partners," if enabled in Church Settings), **Monthly Support**,
**One-Time Needs**, **Trip History**, **Trip Opportunities**,
**Newsletters**, **Documents**, **Print Booklet** — visible to everyone.
**Manage Users** and **Church Settings** appear only for admins. The
footer has **My Account**, a link back to the public site, and **Log
out**.

Missionaries and organizations share one combined **Partners** list —
there's no separate nav entry for each; you pick which kind to add from
the list page itself.

## Managing partners (missionaries & organizations)

### The Partners list

Filter by Type (missionary/organization), Public (yes/no), Restricted
(yes/no), Continent, and Country — the continent/country dropdowns only
show what's actually represented in your data, and picking a continent
narrows the country list to match. There's also a free-text search box
that matches across name, field/region, focus area, overview text,
sending church/org name, and country — it's diacritic-insensitive (a
search for "sao tome" matches "São Tomé") and multi-word (typing two
words requires both to match somewhere, not as one exact phrase). A
"Show archived" checkbox reveals archived records, and **Reset filters**
clears everything back to defaults.

Click **+ Add Missionary** or **+ Add Organization** to create one; click
any row to view that partner's detail page.

### Adding/editing a missionary

The form is organized into sections:

- **Photo** — headshot upload (JPEG/PNG/WebP) with a live preview and a
  Received Date. Uploading here always adds a new photo rather than
  replacing the current one — the previous photo becomes history instead
  of being deleted. Only the current photo (whichever has the latest
  Received Date) shows on the public site; view the full history or
  delete an old photo from this missionary's **detail page** (see
  [Photo history](#photo-history) below).
- **Core Info** — Display Name (required), Field/Region, Supporting
  Since, Preferred Contact Method, and three checkboxes: **Safe to
  contact**, **Show on public site** (`isPublic`), and
  **Restricted-access location** (`isRestricted` — see
  [Understanding restricted-access partners](#understanding-restricted-access-partners)
  below before checking this).
- **Financial Support** — repeatable Monthly Amount / Effective Date /
  Notes rows. The most recent effective date is what counts as the
  current amount everywhere else in the app. Never shown publicly.
- **One-Time Needs** — repeatable Description / Requested Amount /
  Request Date / Approved Amount / Approved Date / Notes rows (you can
  also manage these from the dedicated **One-Time Needs** page).
- **Ministry Overview** — Short Overview (used on directory cards), Full
  Overview, and Ministry Focus.
- **Serving Location** — a full address, plus GPS coordinates (leave
  blank to auto-geocode from the address on save, or enter manually) and
  a Country Code, which drives a live Joshua Project stats lookup on the
  form itself. This exact address is never shown publicly — only the GPS
  pin is, and only at all if `isPublic` is checked.
- **Mailing & Contact Address** — a separate address, with "Receives mail
  here" / "Receives packages here" checkboxes.
- **Adults** — Wedding Anniversary, then one row per adult in the
  household (Name, Birthday, two phone numbers, Email).
- **Children** — Name + Birthday per child.
- **Emergency Contact** — Name, Phone, Email.
- **Languages Spoken** — a free-text tag list.
- **Trip Capacity** — Team Size Min/Max, Trip Types Supported (pick from
  presets or type your own), season/duration notes, lodging/logistics
  notes. This is what powers the **Trip Opportunities** capacity search.
- **Trip History** — past trips, each with dates, type, description,
  notes, and a nested list of participants (Name, Role, Phone, Email,
  "Trip Leader" checkbox).
- **Furlough** — Start/End Date (leave End Date blank for an ongoing
  furlough) and Notes.
- **Church Visits** — Visit Date + Notes; the most recent becomes "last
  visit" everywhere it's shown.
- **Sending Church** — has a **"Sent by {your church}"** checkbox: check
  it to auto-fill the blank fields below from Church Settings (name,
  contact, phone, website, mailing address) without overwriting anything
  you've already typed. Unchecking it later never deletes data that's
  already there.
- **Sending Org** — same shape as Sending Church, no auto-fill checkbox.
- **Links & Social Media** — Website, Support Link, Newsletter Signup,
  Facebook, Twitter, Instagram, LinkedIn.

Blank repeatable rows (an empty adult, an empty trip, etc.) are silently
dropped when you save — you don't need to manually remove unused rows.

### Adding/editing an organization

Same shape as the missionary form, with these differences: **Logo**
instead of Photo; **Organization Name** + an **Organization Type**
dropdown (Local/National) instead of Display Name; no "Safe to contact"
checkbox; a single combined **Contact Info** section (name, phone, email,
website, support link, newsletter signup, social media) instead of it
being split across Core Info and Links; the overview section is labeled
"Focus Area"; and there's no Adults, Children, Emergency Contact,
Languages Spoken, Anniversary, Sending Church, or Sending Org — those are
person-specific and don't apply to an organization.

### The partner detail page

A read-only view of everything above — sections with no data are hidden
entirely rather than shown empty. Status pills under Core Info summarize
the flags at a glance (contact-safe, public/not, restricted, sent-by-us,
on-furlough, archived). **Edit** takes you to the form; **Back to list**
returns you to Partners. Newsletters, documents, and photos can be
uploaded, viewed, and deleted directly from this page (see
[Newsletters](#newsletters), [Documents](#documents), and
[Photo history](#photo-history) below) — but other edits (adding a trip,
recording support) only happen through the Edit form.

### Photo history

Every photo/logo ever uploaded is kept, not just the current one — the
detail page's **Photo History** section lists them all, newest received
first, each with its Received Date and a **Current** badge on the one
actually shown on the public site (whichever has the latest Received
Date — not necessarily the most recently uploaded, so backfilling an
older photo won't demote a more recent one still to come). **+ Add
Photo** here works the same as uploading from the Edit form. **Delete**
removes one permanently, including the current one — if you delete the
current photo, whichever remains with the next-latest Received Date
automatically becomes current. There's no "restore" — re-upload a
deleted photo if you need it back.

### Archiving vs. deleting

**Archive** (from the Edit form) removes a partner from the public site
and zeros out their monthly support total, while keeping their full
history — reversible any time via **Unarchive**. **Delete** is only
available on an already-archived record, is permanent, and requires
typing "confirm" to proceed. When in doubt, archive.

### Understanding restricted-access partners

Two checkboxes on every missionary/organization control what the public
site can see, independently of each other:
- **Show on public site** (`isPublic`) — whether the partner appears on
  the public site at all. Leave it unchecked for internal-only records
  (e.g. someone your church supports but doesn't publicize).
- **Restricted-access location** (`isRestricted`) — only relevant if
  `isPublic` is also checked. Automatically, on the public site only:
  reduces the missionary's name to initials (an organization's name stays
  visible — it's an institution, not a person), drops the precise GPS pin
  down to a country-level approximation (or no pin at all, if their
  country isn't recognized — see
  [ADMIN_GUIDE.md § Troubleshooting](ADMIN_GUIDE.md#troubleshooting)),
  replaces the overview with a generic security-conscious blurb, and
  strips all contact info, sending church/org, and children's
  names/birthdays entirely.

Neither flag affects what you see in the admin dashboard — the masking
only ever applies to the public site. The masking rules themselves live
in one place in the code (`backend/src/utils/maskData.js`) — worth a
periodic team review, since you know which details are genuinely safe to
show for your specific restricted-access partners.

## Financial support & one-time needs

**Monthly Support** is a read-only rollup: every partner with at least
one support entry, their current monthly amount, and a running total —
archived partners excluded unless you check "Include archived." Click any
row to jump to that partner.

**One-Time Needs** lists every recorded need across all partners, with a
status pill (Pending Decision / Fully Funded / Partially Funded /
Declined) computed from the approved vs. requested amount. **+ Add Need**
adds one without leaving the page; an undecided need gets a **Record
Decision** button to fill in the approved amount/date once your church
has made a call.

## Trip history & trip opportunities

These are two different things:
- **Trip History** is a read-only, filterable log of trips that already
  happened, flattened across every partner — filter by type, year, team
  size; trips themselves are added from a partner's Edit form, not here.
- **Trip Opportunities** is a forward-looking capacity search — "who
  could host a trip like this" — filtering by team size, trip type,
  region, and how recently a team last visited, reading the same Trip
  Capacity fields set on each partner's form.

## Newsletters

Upload from the central **Newsletters** page (**+ Upload Newsletter**:
pick the partner, choose a file — PDF, `.eml`, JPEG, or PNG — optional
title/notes) or directly from that partner's detail page, which embeds
the same upload/view/delete UI. **View** opens the file in a new tab;
**Delete** removes it permanently. Newsletters are always private — never
shown on the public site, regardless of the partner's `isPublic` flag.

## Documents

A separate, more general place to keep other files from a partner —
survey responses, a returned signed policy acknowledgment, Word/Excel/PDF
documents, or an email you want kept on file long-term — anything that
isn't a newsletter update. Same private, admin-only visibility as
Newsletters; the difference is what each is *for*, not who can see it.

Upload from the central **Documents** page (**+ Upload Document**: pick
the partner, choose a file — PDF, Word `.doc`/`.docx`, Excel `.xls`/
`.xlsx`, `.eml`, JPEG, or PNG — pick a **Category**, optional title/notes)
or directly from that partner's detail page, which embeds the same
upload/view/delete UI. Every document needs a category:

| Category | For |
|---|---|
| Survey Response | A completed survey or check-in questionnaire sent back by the partner. |
| Signed Policy | A policy acknowledgment (child protection, code of conduct, etc.) signed and returned. |
| Email Communication | An email exchange worth keeping on file long-term. |
| Office Document | A Word/Excel/PDF document that doesn't fit the other categories. |
| Other | Anything else — pick this and type your own label (e.g. "Background Check"). |

The central **Documents** page can filter by category and by
missionary/organization, so you can, for example, pull up every signed
policy on file across all partners at once. **View** opens the file in a
new tab; **Delete** removes it permanently.

## Printable partner booklet

**Print Booklet** builds a print-formatted directory: pick a **Look &
Feel** template — Classic (warm accent-colored circles and a tinted
callout), Modern (clean, no decorative shapes, bold rules), Traditional
(a bordered page frame, small centered portrait, serif type throughout),
Keepsake (a polaroid-framed, slightly tilted photo, a handwritten-note
callout), Portfolio (a large photo-led layout, high-contrast dark
header), or Friendly (a bold color-block header, a large circular photo,
rounded pill-style info rows) — choose who's included (archived,
restricted-access, organizations), what
shows on each page (photo, overview, location, address, family info,
sending church/org, and an optional facing "Notes & Prayer Requests" page
with ruled lines), and set a cover title/subtitle. Every booklet also
ends with a closing back cover — your church's logo and name (from
[Church Settings](#church-settings-admin-only)) plus your About Text or
Public Tagline as a closing message, or a generic thank-you if neither is
set. **Update Preview** re-renders on the page — automatically when you
switch templates, but not on every checkbox (re-pagination is expensive)
— and **Open in New Tab to Print** builds a clean, paginated document
ready for your browser's print dialog — useful for printing a physical
prayer/support directory for your congregation.

## Church Settings (Admin only)

One record controls the whole instance's branding: Church Info (name,
phone, contact, website, address — also what auto-fills "Sent by our
church" on the missionary form), Partner Terminology (swap "Missionary"
for whatever your church calls them, and optionally use that term in the
admin nav too), Public Site (tagline, about text, brand color), and Logo.
Changes take effect immediately, everywhere, with no code changes needed.

## User management (Admin only)

**Manage Users** lists everyone with access — email, role, auth provider,
active status, MFA status, last login. **+ Add User** creates one
(email + role + auth provider; a password is required for local
accounts). Editing lets you change role, deactivate, force MFA
enrollment, or reset a local password. **Reset MFA** clears a locked-out
user's two-factor setup so they can log back in with just their password
and re-enroll. You can't delete your own account, and the app won't let
you demote, deactivate, or delete the last active admin — there's always
at least one way back in.

## Your account settings

**My Account** is where you manage your own login, regardless of role.
Local accounts can change their password (current password required) and
enable/disable two-factor authentication — enabling walks you through
scanning a QR code and confirming a code; disabling requires your current
password. SSO accounts don't manage a password here — that's handled by
your organization's identity provider (Entra ID, Google Workspace, etc.)
instead.

## The public site

Worth understanding what visitors actually see, since it's driven
entirely by what you check in the admin dashboard:
- **Partner Directory** (`/`) — a searchable, filterable grid (same
  continent/country/type filters and robust search as the admin Partners
  list) of everyone with `isPublic` checked.
- **Map** (`/map`) — the same partners plotted on an interactive Leaflet
  map. Restricted partners show at country-level precision only, if they
  show at all — see
  [Understanding restricted-access partners](#understanding-restricted-access-partners).
  Organizations aren't part of the auto-tour cycle described below, but
  their pins are still clickable any time.

### The public map's auto-tour

The map can automatically cycle through missionary pins, flying to each
one and opening its popup — useful for an unattended display (e.g. a
lobby kiosk) as well as regular visitors:
- **Manual**: the "Start Tour" / "Stop Tour" button in the header toggles
  it. Clicking any pin or list card stops the tour and holds on that pin.
- **Auto-start via URL**: append `?tour=1` to the map's URL to start the
  tour immediately on load — a kiosk display just needs to open that URL
  once.
- **Speed**: `?tourSeconds=N` sets how long each pin stays in view before
  advancing (this alone also implies `?tour=1`). Defaults to 30 seconds.
- The tour always jumps to the first pin immediately when it (re)starts —
  it doesn't wait a full `tourSeconds` before the map first moves, even if
  a different pin was already active from earlier browsing.
- Only missionaries with a resolvable pin are included in the cycle — see
  [ADMIN_GUIDE.md § Troubleshooting](ADMIN_GUIDE.md#troubleshooting) if a
  restricted partner isn't showing up.
- **Partner detail page** — the fuller write-up linked from both the
  directory and the map, masked the same way for restricted partners.

Nothing on the public site is editable — it's a read-only mirror of
whatever's marked public in the admin dashboard.
