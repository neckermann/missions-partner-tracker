# User Guide: Using the App

This covers day-to-day use of the admin dashboard — logging in, managing
partners, tracking support, and everything else you'd do once the app is
already set up and running. If you're looking for installation,
deployment, or infrastructure, see [ADMIN_GUIDE.md](ADMIN_GUIDE.md)
instead.

Screens and actions that require the `admin` role are marked **(Admin
only)** below — see [Understanding your role](#understanding-your-role).

**Contents**

- [Getting started](#getting-started)
- [Managing partners & support](#managing-partners--support)
- [Caring for partners](#caring-for-partners)
- [Settings](#settings)
- [Communications](#communications)
- [Integrations](#integrations)
- [Your account & the public site](#your-account--the-public-site)

## Getting started

### Logging in

Go to `/login` and sign in with your email and password. There's no
single sign-on — see
[ADMIN_GUIDE.md § Authentication setup](ADMIN_GUIDE.md#authentication-setup)
for why.

![The login page](docs/assets/screenshots/login-page.png)

**Your first time (the link you were sent).** A new account opens from a link
in a welcome email (or one an administrator copies to you). The page asks
**Where will you mostly sign in?** If it is your own phone or computer, choose
**Mostly on this device**: you create a passkey and use your fingerprint, face
or screen lock from then on. A passkey has no recovery codes, so if you lose
that device, ask an administrator to reset your sign-in, or use **Email me a
new link** on the sign-in page if your church has email set up. If you use
different or shared computers, choose **On different or shared computers**: you
choose a password and add an authenticator app, and you are given recovery
codes to keep. Either way you are signed in at the end, with no separate
sign-in step. A link works once; an expired one offers to email you a new link.
If your account already has two-factor, a link only changes your password, and
you sign in the normal way afterward.

**Forgot your password?** When your church's site can send email, a **Forgot
your password?** link under the sign-in button asks for your email address and
sends a link that lets you choose a new one (the same page described above). The link works once and expires
in an hour, and the page says the same thing whether or not that address has
an account. Choosing a new password signs you out on your other devices, and
if you use two-factor you're still asked for it next time you sign in. If the
site can't send email, the link isn't offered: ask an administrator for a new
setup link (**Settings → Manage Users**). It's not available on the public demo
or while passwordless sign-in is on.

The sign-in page has two short steps. If you have a passkey, press **Sign in with
a passkey** (or pick it from the list your browser offers in the email box);
your fingerprint, face or screen lock signs you in alone. Otherwise type your
email and press **Continue**, then your password. The page never says whether
an email has an account.

If your account has two-factor authentication enabled, you'll be prompted
for a 6-digit code from your authenticator app, or to **Use a passkey**
(your fingerprint, face or screen lock), after your password. If
your church requires two-factor for everyone (or an admin required it of
your account) and you haven't set it up yet, you'll be walked through
enrollment (add a passkey, or scan a QR code and confirm a code) before
you can do anything else. If your church turns the requirement on while you're signed in, your
next click takes you back to sign-in, and you set it up then.

If your church has turned on **passwordless sign-in**, there is no password
box. A passkey signs you in alone (it counts as both factors). If you haven't
added a passkey yet, typing your email and pressing **Continue** sends a one-time link that works once and
expires in 15 minutes; it signs you in and then walks you through adding a
passkey. Lost your passkey? Ask an admin to **Reset MFA** on your account;
they'll hand you a fresh way in.

![The sign-in page with passwordless sign-in on: a passkey button and an emailed link](docs/assets/screenshots/sign-in-passwordless.png)

![After the emailed link: add a passkey (or use an authenticator app) to finish signing in](docs/assets/screenshots/sign-in-add-passkey.png)

### Understanding your role

Every user has one of three full roles:

| Role     | Can change                                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewer` | Nothing. Read-only.                                                                                                                                                                                              |
| `editor` | Create, edit, and archive/unarchive partners; add support entries, one-time needs, trips, and prayer requests; upload newsletters and documents. Can't delete anything, manage users, or change Church Settings. |
| `admin`  | Everything above, plus delete records, manage users, and edit Church Settings.                                                                                                                                   |

**Roles control what you can change, not what you can see.** Every account,
including a `viewer`, can read every partner's full record — home address
and GPS coordinates, family members' phone numbers and birthdays, emergency
contacts, and the real name and photo of partners marked
restricted-access. There is no reduced view for lower roles.

That's a deliberate design choice, not an oversight: this is a small
internal tool for one church, and splitting what staff can see would make
the prayer list less useful without meaningfully protecting anything, since
anyone who needs an account needs the information. But it does mean **an
account is the whole permission** — treat handing one out the same way you'd
treat handing someone the filing cabinet key. If you only want someone to
see what's public, send them the public site; they don't need an account at
all.

**A 4th, narrower account type: Guest.** This one's the exception
to "an account is the whole permission" above, on purpose — a Guest is a
login that only reaches the trips an admin gives it. Create one from
Manage Users with a role of "Guest" and pick one or more trips (from the
trip's own page you can also give an existing guest access, or invite a
new one). A guest can see and edit those trips' team/meetings/
requirements/budget/flights, and can view (but not edit) those trips'
partner pages — nothing else in the app. **Access ends 30 days after
each trip's end date** unless an admin sets a different date, so a
guest doesn't keep access forever; an admin can extend it, end it
early, or remove a trip at any time. Guests sign in with a password, and
with two-factor authentication when the church requires it of everyone
(see [User management](#user-management-admin-only)). Use it
for an actual trip leader or chaperone who needs to manage their own
trip's logistics without a full account on everything else. See
[SPEC.md § 5.1](SPEC.md#51-guest--a-scoped-login-not-a-4th-full-role)
for the full access list.

**When the feature a guest's access comes from is switched off.** A
trip leader's access belongs to **Trips**, and a care team member's to
**Care teams**. While the church has that feature switched off in
[Enabled Features](ADMIN_GUIDE.md#feature-toggles), the guest's access
stops on the server (they cannot open the trip or its partner by typing
an address either), and a guest with nothing else to open sees a plain
page saying their church has paused it ("Trips are paused" or "Care
teams are paused"), not the sign-in page and not an instruction to
change a setting, which they cannot reach. A guest with both kinds of
access keeps the one that is still on. Nothing is removed: the trip
grants and care team seats are kept, and switching the feature back on
restores the access exactly as it was. Turning **Care teams** or
**Trips** off therefore takes any guest who depends on it out of the
app until it is back on, so tell them first.

If something you expect to see isn't there (a nav link, a button), it's
almost always a role thing, not a bug — check with whoever manages users
at your church.

### Dashboard overview

The sidebar (and the Home page's card grid, which mirrors it) lists:
**Home**, [**Partners**](#the-partners-list) (or your church's custom
term, e.g. "Go Team Partners," if enabled in Branding),
[**Emails to Sort**](#receiving) (inbound email only — see
[Email](#email-admin-only) below),
[**Updates to Share**](#updates-to-share) (GroupMe and/or
email sending only),
[**Monthly Support**](#financial-support--one-time-needs),
[**One-Time Needs**](#financial-support--one-time-needs),
[**Prayer Requests**](#prayer-requests),
[**Trips**](#trips) (Existing Trips / Plan a Trip tabs),
[**Newsletters & Docs**](#newsletters--docs),
[**Print Booklet**](#printable-partner-booklet), [**Reports**](#reports)
— visible to everyone, each one only if its
[feature toggle](ADMIN_GUIDE.md#feature-toggles) is on.

**Settings**, an expandable group at the bottom of the
sidebar, appears only for admins and holds **About & Branding**
(Church Info/address and branding together on one page — see [Church
Settings](#church-settings-admin-only)),
[**Manage Users**](#user-management-admin-only),
[**Enabled Features**](ADMIN_GUIDE.md#feature-toggles), and **About
App** ([system info](#system-info-admin-only) and
[database backups](#database-backups-admin-only) together on one
page) up front, then two further sub-groups
that only appear once their own features are on:

- **Communications** — [**Email**](#email-admin-only),
  [**GroupMe**](#groupme-dispatch-admin-only),
  [**WhatsApp**](#whatsapp-dispatch-admin-only), and
  [**Sending Updates**](#sending-updates-admin-only) (schedules,
  GroupMe's content-type mutes, the restricted-partner safety gate,
  digest appearance, and subscriber counts — the queue itself is
  [**Updates to Share**](#updates-to-share) in the main menu).
- **Integrations** — [**AI Features**](#ai-features-admin-only) and
  [**Joshua Project**](#joshua-project-admin-only).

The footer has **My Account**, a link back to the public
site, and **Log out**.

![The Home dashboard's card grid, mirroring the sidebar](docs/assets/screenshots/admin-home.png)

Missionaries and organizations share one combined **Partners** list —
there's no separate nav entry for each; you pick which kind to add from
the list page itself.

## Managing partners & support

### Managing partners (missionaries & organizations)

#### The Partners list

Filter by Type (missionary/organization), **Sending church**, Public (yes/no), Restricted
(yes/no), Continent, and Country — the continent/country dropdowns only
show what's actually represented in your data, and picking a continent
narrows the country list to match. There's also a free-text search box
that matches across name, field/region, focus area, short overview, and
country — it's diacritic-insensitive (a search for "sao tome" matches
"São Tomé") and multi-word (typing two words requires both to match
somewhere, not as one exact phrase). A "Show archived" checkbox reveals
archived records, and **Reset filters** clears everything back to
defaults.

Click **+ Add Missionary** or **+ Add Organization** to create one; click
any row to view that partner's detail page. The list shows each partner's
photo beside their name, and a **Flags** column that lists only what is out
of the ordinary (Restricted, Not public, Sent by us). **Last updated** is the
last change to the partner or anything on its page, and sorts; Flags doesn't, since a
row can carry several at once. To find, say, everything we sent, use the
**Sending church** filter instead.

**Sending church** is a filter on every list about partners or their records —
Partners, Newsletters & Docs, Trips, Prayer Requests, One-Time Needs, Monthly Support, and
the reports that list partners (Data completeness, Partner roster, Support summary, Last
heard from, Mailing list, Prayer requests, One-time needs, and the rest). Its first option
is **Sent by us** (our own church); after that it lists each other church that has sent a
partner, with how many, matched without regard to capitalisation. Guests don't see it.

![The Partners list filtered by Sending church: Sent by us](docs/assets/screenshots/partners-sending-church-filter.png)

![The Partners list, filterable by type, sending church, public/restricted status, continent, and country](docs/assets/screenshots/admin-partners.png)

#### Creating a missionary

**+ Add Missionary** opens a short form asking just for what can't be
filled in later from the record itself, plus a couple of fields that are
usually already known the moment you're adding someone and don't need
their own detail-page trip: Display Name (required), Country,
Field/Region Display Name, a Short Overview, **Partnering Since**, a
**Contacting them** choice (Normal, Use caution, or Don't contact directly;
the details go on their Contact card), and three checkboxes — **Show on
public site** (`isPublic`), **Restricted-access
location** (`isRestricted` — see
[Understanding restricted-access partners](#understanding-restricted-access-partners)
below before checking this), and **Sent by {your church}**. **Create
Partner** saves it and takes you straight to its detail page, where
everything else — photo, financial support, ministry overview, serving
location, family, trip history, and the rest — gets filled in section by
section. See [Editing a partner](#editing-a-partner) below. Hover any
field's label for a tip on what it means and how it's used.

![The New Partner form, with Partnering Since and Contacting them alongside the basics](docs/assets/screenshots/new-partner-form.png)

#### Creating an organization

**+ Add Organization** is the same short form, with **Organization
Name** and an **Organization Type** dropdown (Local/National) in place
of Display Name, and no "Contacting them" or "Sent by" choices —
those are person-specific.

#### Editing a partner

There's no single "edit form" holding the whole record — each section on
a partner's **detail page** edits on its own. Click that section (or a
specific row's own **Edit**, for a list like Adults or Links), and a
small popup opens with just that section's fields — **Save** (or
**Close**) returns you to the same spot on the page, nothing else
reloads. Every section saves only its own fields, so fixing a typo in
the overview never touches anything else on the record.

![Editing one household adult's fields in a popup over the partner detail page](docs/assets/screenshots/partner-edit-inline.png)

The page groups its sections to match what you'd actually open it to do,
not just what topic they fall under:

- **Photo** (missionary) / **Logo** (organization) — upload (JPEG/PNG/
  WebP) with a live preview and a Received Date. Uploading here always
  adds a new photo rather than replacing the current one — the previous
  photo becomes history instead of being deleted. Only the current photo
  (whichever has the latest Received Date) shows on the public site;
  view the full history or delete an old photo from
  [Photo history](#photo-history) below.
- **Status & Visibility** — the three quick toggles, kept together in
  their own box right under the header pills rather than buried inside a
  content section: **Show on public site** (`isPublic`), **Restricted-
  access location** (`isRestricted`, masks the name to initials and
  coarsens the map pin to a country centroid publicly), and, missionary
  only, nothing about contacting them: that lives on the **Contact card**,
  which is shown and edited in one place.
- **Ministry Overview** (missionary) / **Focus Area** (organization) —
  Short Overview (used on directory cards), Full Overview, and Ministry
  Focus.
- **Family & Personal** (missionary only):
  - **Family** — Wedding Anniversary, then one row per adult in the
    household (Name, Birthday, two phone numbers, Email) and one per
    child (Name, Birthday).
  - **Languages Spoken** — a free-text tag list.
  - **Emergency Contact** — Name, Phone, Email.
  - **Typing a phone number.** Every phone box has a country beside
    it, shown by name ("Kenya +254"). Pick the country, then type the
    number the way people there write it (`0712 345678`); it is saved
    in full international form (`+254712345678`), so Call and WhatsApp
    reach the right place. For a partner's adults and an
    organization's contact person the country starts on **the country
    the partner serves in** (from the Location address); everywhere
    else, including the emergency contact and sending church, it
    starts on your church's country. If a number doesn't fit the
    country picked, a note appears when you leave the box ("This
    doesn't look like a United States number. Is the country right?").
    It is only a question: you can still save.
- **Location & Contact**:
  - **Serving Location** — Field/Region Display Name (shown publicly
    even for a restricted partner, so keep it broad — "East Africa," not
    a city, or it undoes the restriction above), a full address (country
    is a suggest-as-you-type field, not a hard dropdown — pick a
    suggestion or type your own if it's not listed), and GPS coordinates.
    Leave both GPS fields blank and saving auto-fills them from the
    city/state/country (via OpenStreetMap) — that lands on the city, not
    an exact address, so enter coordinates yourself for more precise
    placement. This exact address is never shown publicly — only the GPS
    pin is, and only at all if **Show on public site** is checked.
    If [Joshua Project stats](ADMIN_GUIDE.md#feature-toggles) is turned
    on, a **Country Code** field also appears here, used only to look up
    that country's Joshua Project stats right on this page — nothing
    else reads it. It auto-fills from the address's country the first
    time it resolves to a recognized name, but only while the field is
    still blank — enter it yourself and it's never overwritten. It's a
    FIPS code specifically, which for many countries differs from the
    more familiar ISO code (e.g. the Philippines is `RP`, not `PH`) —
    that mismatch is exactly why the auto-fill, and the manual override,
    both exist. **Turning Joshua Project on after partners already
    exist?** The field only appears once the feature is on, so existing
    partners won't have a code yet — open each one's Serving Location
    and either type the code in directly, or clear the Country field and
    re-enter it to trigger the auto-lookup.
  - **Mailing & Contact Address** — Display Name (missionary) or
    Organization Name/Type (organization) — this is the public display
    name shown on the directory, map, and booklet — organization-only
    Contact Name/Phone/Email (how they like to be reached is on the
    Contact card), and a separate mailing address with
    "Receives mail here" / "Receives packages here" checkboxes.
  - **Sending Church** (missionary only) — name, contact, phone,
    website, mailing address, plus a **"Sent by {your church}"**
    checkbox. Checking it means this section IS your church, so it
    replaces every field here with Church Settings' current values —
    whatever was typed before gets overwritten, whether you check it
    when first creating the partner or later. Unchecking it never
    deletes data that's already there. A later change to Church Settings
    doesn't retroactively update an already-checked partner on its
    own — to push that out, use the bulk update on the **About Church**
    page (below), which re-applies current Church Settings to every
    partner already marked "Sent by our church" in one click. The status
    pill at the top of the page shows this at a glance, but editing it
    happens here.
  - **Sending Org** (missionary only) — same shape as Sending Church, no
    auto-fill checkbox.
  - **Links & Social Media** — Website, Support Link, Newsletter Signup,
    Facebook, Twitter, Instagram, LinkedIn.
- **Care & Follow-up**: **Support Preferences**, **Surveys**, the
  **Contact Log**, **Church Visits** and **Furlough** (each appears when
  its feature is on). The jump bar reads Overview, Family & Personal,
  Location & Contact, Care, Financial, Mission Trips, Communication.
- **Financial**:
  - **Partnering Since** — a single date.
  - **Financial Support** — repeatable Monthly Amount / Effective Date /
    Notes rows. The most recent effective date is what counts as the
    current amount everywhere else in the app. Never shown publicly.
  - **One-Time Needs** — repeatable Description / Requested Amount /
    Request Date / Approved Amount / Approved Date / Notes rows (you can
    also manage these from the dedicated
    [One-Time Needs](#financial-support--one-time-needs) page).
- **Mission Trips**:
  - **Trips** — this partner's own trips, each with dates, type,
    description, notes, a Photo/Video Album link (optional — Google
    Photos, iCloud Shared Album, or another provider; admin-only,
    never shown on the public site), and a nested list of participants
    (First/Last name, Role, Phone, Email, "Team Leader" checkbox) — the
    same records as the main [Trips](#trips) page, just scoped to this
    one partner. An actively-recruited trip's fuller detail page
    (applications, team, documents, support raising) is still
    reached from there, not from here.
  - **Trip Capacity** — Team Size Min/Max, Trip Types Supported (pick
    from presets or type your own), season/duration notes,
    lodging/logistics notes. This is what powers [Trip
    Planning](#trips)'s "No trip scheduled" row for this partner.
- **Communication**:
  - [**Prayer Requests**](#prayer-requests),
    [**Newsletters & Docs**](#newsletters--docs) — see their own sections below.
  - **Church Visits** — Visit Date + Notes; the most recent becomes
    "last visit" everywhere it's shown.
  - **Furlough** (missionary only) — Start/End Date (leave End Date
    blank for an ongoing furlough) and Notes.

Blank repeatable rows (an empty adult, an empty trip, etc.) are silently
dropped when you save — you don't need to manually remove unused rows.

Any list that can grow long over the years — Financial Support, One-Time
Needs, Trips, Prayer Requests, Newsletters & Docs, Church
Visits, Furlough — shows only its 3 most recent entries by default, with
a **Load More** button (showing how many more there are) to reveal the
rest. Nothing is hidden permanently; it's just not all rendered at once.

#### The partner detail page

Shows every section described in [Editing a partner](#editing-a-partner)
above, grouped as listed there — sections with no data are hidden
entirely rather than shown empty. Status pills under the header
summarize the flags at a glance (contact-safe, public/not, restricted,
sent-by-us, on-furlough, archived) and hovering one that lives in a
specific section (like "Sent by {your church}") says where to go edit
it. **Back to list** returns you to Partners. This page _is_ where every
edit happens — each section's own **Edit** button, not a separate form
— including newsletters & docs, and photos (see
[Newsletters & Docs](#newsletters--docs), and
[Photo history](#photo-history) below).

![The top of a partner detail page -- Photo History, Status & Visibility, and Ministry Overview](docs/assets/screenshots/admin-partner-detail-preview.png)

#### Who last edited a record

Partner, trip, trip-participant and trip-application pages show "Last edited by Dana Whitfield on 11/24/2026" under the name. A trip's page also says when it was added, on the same line ("Added 11/10/2026 · Last edited by …"), and that date never changes when the trip is edited. This is separate from the admin-only [Audit Log](#audit-log-admin-only): it is kept for good, and it is stamped on the record itself, not recorded as an event.

On a partner or trip that line covers the sections on its page too — a partner's family, addresses, links, visits, support and photos; a trip's team, meetings, requirements, documents and money — so it answers "when did anyone last touch this record?" even when the change was inside a section. The **Trips** list also has a sortable **Added** column, so you can find the newest trips. The **Partners** and **Trips** lists have a sortable **Last updated** column with the same date and name, so you can sort to find the records nobody has looked after in a while (blank means no signed-in person has changed it). Prayer requests, needs, newsletters and contact-log entries are not folded in; they have their own pages. A prayer request or one-time need shows its own line when you open it. None of this is shown to Guests or on the public site. The **Data completeness** report has **Last edited by** and **Last edited** columns too, so you can see which partner records nobody has touched in a while and who to ask. It is stamped on every record an admin, editor or care team member changes, and not by background jobs or a public form, so a record nobody has edited shows no line. The name is a snapshot, so it still reads after that person's account is deleted.

![A partner's page with "Last edited by Alex Hartley" under the name](docs/assets/screenshots/last-edited-by.png)

#### Photo history

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

#### Archiving vs. deleting

**Archive** and **Delete** are row actions on the **Partners list**, not
on the partner's own detail page. **Archive** removes a partner from the
public site and zeros out their monthly support total (by adding a new
$0 entry, not by touching existing history), while keeping their full
history — reversible any time via **Unarchive**. Unarchiving only clears
the archived flag, though: it does _not_ automatically turn "Show on
public site" back on or add a new support entry — those are deliberate
decisions to make again once someone's actually back, from
[Editing a partner](#editing-a-partner). **Delete** is only available on
an already-archived record, is permanent, and requires typing "confirm"
to proceed. When in doubt, archive.

#### Understanding restricted-access partners

Two checkboxes on every missionary/organization control what the public
site can see, independently of each other:

- **Show on public site** (`isPublic`) — whether the partner appears on
  the public site at all. Leave it unchecked for internal-only records
  (e.g. someone your church supports but doesn't publicize).
- **Restricted-access location** (`isRestricted`) — only relevant if
  `isPublic` is also checked. Automatically, on the public site only:
  reduces the missionary's name to initials built from the adults on the
  record ("T.S. and S.S." for a couple, "T.S." for one adult, "T.S., S.S.
  and J.K." for three; a partner with no adults recorded uses the initials
  of the display name) (an organization's name stays
  visible — it's an institution, not a person), replaces their real photo
  with a generic silhouette icon (a plain shape — single, couple, or
  family, matching their actual household — never a real photo of any
  kind, generic or otherwise), drops the precise GPS pin down to a
  country-level approximation (or no pin at all, if their country isn't
  recognized — see
  [ADMIN_GUIDE.md § Troubleshooting](ADMIN_GUIDE.md#troubleshooting)),
  replaces the overview with a generic security-conscious blurb, and
  strips all contact info, sending church/org, children's
  names/birthdays, and prayer requests entirely — even a strategic
  request marked Show on public profile never appears for a restricted
  partner.

Neither flag affects what you see in the admin dashboard — the masking
only ever applies to the public site. The masking rules themselves live
in one place in the code (`backend/src/utils/maskData.js`) — worth a
periodic team review, since you know which details are genuinely safe to
show for your specific restricted-access partners.

![A restricted-access missionary's public page -- initials, a silhouette, a country-level pin, and a generic overview](docs/assets/screenshots/restricted-partner-masked.png)

### Financial support & one-time needs

**Monthly Support** shows every partner with at least one support entry,
their current monthly amount, and a running total — archived partners
excluded unless you check "Include archived." Click a row to jump to that
partner. **+ Add Support Entry** logs a new amount against any partner
(the newest effective date is always what counts as "current"); each
row's **History** button expands to every entry on file for that partner,
with a **Delete** to remove one entered by mistake. There's deliberately
no in-place edit here — a support entry is a point-in-time record, like a
line in a ledger, so correcting one means deleting it and adding a new
entry rather than rewriting history.

![The Monthly Support page, with a running total and a History button per partner](docs/assets/screenshots/monthly-support.png)

**One-Time Needs** lists every recorded need across all partners, with a
status pill (Pending Decision / Fully Funded / Partially Funded /
Declined) computed from the approved vs. requested amount. **+ Add Need**
adds one without leaving the page; an undecided need gets a **Record
Decision** button to fill in the approved amount/date once your church
has made a call (tick **Decline this request** to record a no), plus an
optional **Decision Note** for why it came out that way (a reason for
declining, or for funding less than what was asked). The requested
amount is optional: leave it blank when a letter names no figure, and the
need shows "No amount". Separately from the decision, open a need to
record **Someone's on it** (who has taken it on: a person or a group) and
**Met on** (the day it was covered, by your church or anyone else). An
undecided need with someone on it reads "Someone's on it: …" instead of
Pending Decision, and a met need reads **Met** whatever was decided;
neither sends anything, and a met need no longer counts as waiting for a
decision. The requested amount (when there is one) and the
approved amount/decision note (once decided) show up in the GroupMe post and the
admin email digest for that need — one-time needs never reach the
public digest, so there's no reason to hold that detail back from the
audiences that do see it. Both **+ Add Need** and its Edit form have a
**Source (optional)** dropdown listing that partner's newsletters and
documents — pick one if you read it yourself and typed the need in, or
leave it as "None." A need pointed at a source this way, or added
automatically by [AI Features](#ai-features-admin-only), shows a
"From: ..." link back to that file, rendered the same either way. For
marking a new need urgent, or (for a restricted partner) approving it at
creation instead of from Updates to Share, see [Marking something
urgent](#marking-something-urgent).

![The One-Time Needs page, with status pills per need](docs/assets/screenshots/one-time-needs.png)

![A one-time need showing its "From: ..." source link](docs/assets/screenshots/support-need-source-link.png)

### Prayer Requests

Meant as a long-term record of what's been prayed for and how it was
answered — not a checklist. Add one from a partner's detail page or the
central **Prayer Requests** page (pick the partner, category, and the
request itself). **+ Add Prayer Request** and its Edit form also have a
**Source (optional)** dropdown listing that partner's newsletters and
documents — pick one if you read it yourself and typed the request in,
or leave it as "None."

![The Source (optional) dropdown on the Add Prayer Request form, listing this partner's newsletters and documents](docs/assets/screenshots/source-picker.png)

- **Category** is **Ministry** (tied to the ministry's long-term vision
  or calling — church planting, discipleship, language study, funding —
  can optionally be shown on that partner's public profile via **Show on
  public profile**) or **Everyday** (whatever came up — health,
  travel, family needs, paperwork; staff only). An Everyday request is
  **never shared by any route**: it is not posted to GroupMe or
  WhatsApp, not included in any email update (staff or public), not
  sent as an urgent update, never shown on the public site, the Sunday
  prayer sheet or the booklet, and it never appears on Updates to
  Share. The form hides **Mark as urgent** and **Review and approve
  now** for it, and says so under the Category box. If you change a
  Ministry request to Everyday while its update is still waiting to go
  out, the waiting update is removed. (Changing it back later does not
  send it: only a new Ministry request makes an update.)
- **What a care team member can and cannot set.** Anyone who isn't an
  admin or editor (a Guest on a partner's care team, or a Viewer who is
  on that partner's care team) can add and edit prayer requests for that
  partner, but cannot choose what is shown: the **Show on public
  profile** and **Include in printed booklet** boxes are not on their
  form, and the server ignores them if they are sent, on adding and on
  editing. They also cannot mark a request urgent or approve it. When
  they save, the form says "Your request has gone to the missions team
  for review" (using your church's name for that group), and it waits
  for staff on **Updates to Share**. Staff decide later whether it is
  shown publicly or printed. If they edit a request staff have already
  made public (its wording, category, partner, or its answered status or
  answer note), it comes off the public profile, the Sunday sheet and the
  booklet until staff look at it and tick those boxes again. Changing
  only notes or the source does not. Admins and editors are unchanged.
- A ministry request marked **Show on public profile** can also be
  checked **Include in printed booklet** — a separate setting, since a
  partner can build up more public strategic requests over time than
  would ever fit on a printed page. Only requests checked both ways ever
  appear in the booklet, and even then only up to the per-partner cap set
  on the [Booklet](#printable-partner-booklet) page (a handful, most recent first) — the
  rest still show on the public profile, just not in print. See
  [Printable partner booklet](#printable-partner-booklet) below.
- An open request just sits there — there's no "pending" or "unanswered"
  label anywhere in the app. Most requests, especially strategic ones,
  simply don't have a resolution yet, and that's normal, not a gap to
  flag. If you don't intend to follow up on a specific request for a
  formal answer (many situational ones), check **Not tracking this one
  for a specific answer** when adding it.
- When a request _is_ answered, click **Record Answer** on it — the date
  and an optional note on how it was answered (shown as a quiet "✓
  Answered" line, never a colored badge). This is the part worth keeping
  long-term: a public strategic request's answer note shows on that
  partner's public profile and in the booklet too, right alongside the
  request itself — a real, growing record of how prayers actually get
  answered over time, not just a log of what's currently outstanding.

Separately from any individual request above, a partner's detail page
also has its own **Last Prayed For in a Service** field (a caption on
the field itself spells this out) — a record of the last time the whole
congregation prayed for that partner together during a worship service
or special church event, not any one request's own answer. Click **Mark
Prayed Today** right after it happens, or open the field to
enter/correct a past date if you're catching up on a few weeks of
history. It also shows up as its own column on the **Last heard from**
report (see [Reports](#reports) below), alongside last newsletter, last
photo, last prayer request, and last church visit — one more
connectedness signal when reviewing who's gone quiet.

The central **Prayer Requests** page lists every request across every
partner, filterable by category, with a running count of how many have
been answered so far. A request pointed at a source this way, or added
automatically by [AI Features](#ai-features-admin-only),
shows a "From: ..." link back to that file, rendered the same either
way. For marking a new request urgent, or (for a restricted partner)
approving it at creation instead of from Updates to Share, see
[Marking something urgent](#marking-something-urgent).

![The central Prayer Requests page, newest first across every partner](docs/assets/screenshots/prayer-requests-list.png)

![A prayer request showing its "From: ..." source link](docs/assets/screenshots/prayer-request-source-link.png)

### Trips

Trips is a full recruiting/team/support-raising feature, not just a
historical log — off by default; turn it on in [Enabled
Features](ADMIN_GUIDE.md#feature-toggles) (and, separately, **Public
trip discovery** if you want trips listed publicly — see [ADMIN_GUIDE.md
§ Trips](ADMIN_GUIDE.md#trips) for exactly what each flag and each
private-link setting gates). One page, one "Trips" nav item, two tabs
each answering a different question:

![The Trips page's Existing Trips tab](docs/assets/screenshots/trip-history.png)

- The **Existing Trips** tab is the filterable log of every trip — filter by status,
  type, year, team size, and [**Sending church**](#the-partners-list) (the church that sent the trip's partner). A sortable **Last updated** column shows who last edited each trip, see [Who last edited a record](#who-last-edited-a-record). It opens showing **Active (not completed)**
  trips by default (planning, accepting applications, and closed-but-
  not-yet-happened all count as active) rather than every trip ever —
  switch the Status filter to **All statuses** or **Completed** to see
  the rest; the two count tiles above the list always show the
  filtered count alongside the true all-time total (e.g. "6 of 103
  total") so neither number is mistaken for the other. **+ New Trip**
  offers an explicit choice: **Start recruiting a new trip** (pick a
  partner and trip type, then land on that trip's own detail page to
  fill in the rest) or **Log a trip that already happened** (the
  original backfill form — partner, dates, trip type, description, a
  Photo/Video Album link, and participants, without leaving the page).
  A trip that's only historical (`completed`) is managed entirely
  inline here, same as before this feature existed — **Edit**
  (everything except which partner it's under — delete and re-add to
  move a trip to a different partner) and **Delete**. A trip that's
  still `planning`, `accepting_applications`, or `closed` instead shows
  its status as a link into its own fuller detail page (below) — this
  list isn't where an active trip's applications, team, or documents
  get managed.
  - The **Album** link points to wherever you already host the trip's
    photos/videos — a Google Photos shared album, an iCloud Shared Album,
    or another provider you choose "Other" for. This app never stores the
    photos/videos themselves, just the link, and it's admin-only — it
    never appears on the public site.
- The **Plan a Trip** tab answers a different question — which partner
  to plan the _next_ trip for — blending three kinds of row per
  partner so nobody falls off the list just because nothing's on the
  calendar yet: an **Open** row (already recruiting), a **Committed**
  row (team finalized, hasn't happened), or a **No trip scheduled** row
  (just that partner's own general trip capacity from their Trip
  Capacity fields). Each row also shows that partner's past trip
  count, and a **Clone trip** action to start a repeat from an existing
  trip's own setup instead of typing it all again. A restricted
  partner gets its own badge here too, name withheld — see
  restricted-partner handling below. Starting a brand-new trip works
  from either tab now — use whichever you're already on; Plan a Trip is
  still the better tool when you don't yet know _which_ partner needs
  one.

![The Plan a Trip tab](docs/assets/screenshots/trip-opportunities.png)

**On a trip's own detail page**, beyond the basic setup fields (name,
dates, team size, description, visible-on-public-discovery toggle, and
**Collect parent/guardian info** for a trip that may have minors on
it):

![A trip's detail page: the Overview tab, with its setup fields](docs/assets/screenshots/admin-trip-detail.png)

The rest — team, requirements, meetings, budget, contributions,
applications, flight itinerary — lives on that same page's other tabs
(**Team**, **Meetings**, **Requirements**, **Financial**, **Flights**),
covered below.

- **Support-raising goal** shows a suggested per-person figure once a
  budget and a team size exist — always just a suggestion, never
  forced.
- **Flight itinerary** — once group travel is booked, enter each leg
  (airline/flight number, departs, arrives); shown only on each
  participant's own self-service page, never publicly.
- **Confirmed Team** is who's on the team, with each person's
  support-raising progress, one column per requirement showing who's
  completed it, and a link to their own detail page for everything
  else. **+ Add participant directly** adds someone without an
  application.
- **Trip-wide documents** are files shared with the whole team — an
  itinerary, a packing list — give one a title so it's clear what it
  is. Every team member can see and download these from their own
  self-service page, not just admins.
- **Requirements** — your own list of what's needed from each
  participant, each either a **document** to upload, a plain **task**
  to check off (e.g. "Attended orientation call"), or an
  **e-signature** the participant (or, choosing "Parent or legal
  guardian," a parent signing on a minor's behalf) signs from their
  own self-service page. A document-kind requirement can now be
  uploaded by the participant themselves from that same page too — not
  only by an admin. Fulfillment shows right on the Confirmed Team
  table, computed from what's actually on file or signed rather than a
  status anyone updates by hand. **Add from your saved requirements**
  picks a reusable one (like a minor travel release form) onto this
  one trip, instead of retyping it. Adding a document or e-signature
  requirement emails the whole current team — and anyone who joins the
  team later gets caught up on it automatically too, so nobody who
  joins after the fact is left not knowing something's expected of
  them.
- **Meetings** — schedule a date/time, an in-person location, a join
  link if it's virtual or hybrid, a **title**, and an agenda. The
  title is what shows in the invite's subject line and on the calendar
  entry — handy once a trip has more than one meeting, so they don't
  all just read "Meeting: <trip name>." Each meeting shows as a short
  summary (when, where, and who's RSVP'd); click it to see or change
  the details and who's responded. Scheduling one emails the team an
  invite right away (with a calendar attachment and one-click **Yes /
  No / Maybe** RSVP buttons they can click straight from the email, no
  login needed), and participants get a day-before reminder too, both
  showing the agenda and join link. Changing the time or join link
  resends the invite automatically; **Resend invite** sends it again on
  demand with no change needed. Saving a meeting without changing its
  time, place or link emails nobody. **Meeting and flight times are
  always your church's own time**, with the zone named beside them (for
  example "6:00 PM Central Time"), whoever is looking and wherever they
  are, so a leader who is travelling reads and types the same hour as
  the office does. The zone is the one set under **Settings → About &
  Branding → Church Info**. Someone added to the team after a
  meeting's already scheduled gets that meeting's invite the moment
  they join — nobody has to remember to resend it for them. Changing
  the trip's own start or end date resends everyone the updated
  calendar invite too. **Cancel** calls a meeting off and emails
  everyone who was invited — the meeting stays listed, crossed out, as
  a record that it happened and was called off. **With email off**
  nothing here claims an email goes out: scheduling, changing or
  cancelling a meeting shows each team member's own trip page link for
  you to pass on, the cancel question says nobody is told automatically,
  **Resend invite** becomes **Show links to pass on**, and the
  Requirements tab says no reminders are sent.
- **Budget** (if turned on in Trips Settings) tracks estimated
  whole-team costs against what's been raised — admin-only, never
  shown to applicants or participants.
- **Contributions** is the giving ledger — who gave, how much, by
  Check/Cash/Online/Other, to whom it's credited.
- **Applications awaiting review** — a new application also shows as a badge on the bell. When Email (Sending) is on, the admins get an email naming the applicant with a link to review it (never their contact details). Click a row to open its own review
  page, with the applicant's full answers already shown. **Approve or
  Decline** there launches a short wizard (Decision, then Confirm); a
  declined one can still be reconsidered later.
- **Private application link** — a dedicated "Generate" button
  (appears only once **Allow staff to generate private application
  links** is on, under Settings → Trips Settings) creates a
  secret link you share directly — never listed anywhere, reachable
  even for a restricted partner's trip (masked, not blocked — see
  below). **Regenerate** immediately invalidates the old one.
- **Application questions** — add, edit, reorder, or remove questions
  specific to this trip, shown after the church-wide questions (set on
  Trips Settings) on both the public and private application form.
  Each is short text, long text, multiple choice, or checkboxes, with
  its own required toggle.

![A restricted partner's trip, with the masking warning](docs/assets/screenshots/admin-trip-restricted-warning.png)

**A participant's own detail page** (click their name from Confirmed
Team) is where their contact info gets corrected, their public
support-raising page gets set up (photo, story), and their own
requirement fulfillment and documents live. A participant uploads
their own requirement documents from their self-service page; an
admin can also log one here directly for a document that arrived some
other way.

![A participant's own detail page](docs/assets/screenshots/admin-trip-participant-detail.png)

**Settings → Trips Settings** holds everything church-wide
— donation instructions, whether to track a per-trip budget, the
application questions every trip shares plus a reusable saved-question
library, whether to collect an applicant's mailing address/emergency
contact/date of birth (date of birth has its own "require it" toggle
too), the requirement checklist new trips start with plus a
reusable saved-requirements library (both can be filled by importing an
example [template pack](#template-packs)), and the two private-link toggles
above.

![Trips Settings](docs/assets/screenshots/trips-settings.png)

**Restricted-partner trips are never public, but aren't locked down to
"admin only" either** — three different rules depending on the
surface: fully excluded (behaves like it doesn't exist) from the
public Trip Opportunities listing and plain application links;
**masked** (the real partner never shown, a generic label instead,
same as elsewhere in this app) on a private application link or a
participant's support-raising link, since reaching either already
required someone to share a secret with you directly; and fully real
here on the admin detail page, with an amber warning reminding you
that the trip's own free-text name/description can still leak details
masking can't catch — avoid naming the real location there.

**What an applicant or participant sees, outside the admin UI**:

![The public Trip Opportunities page](docs/assets/screenshots/public-trip-opportunities.png)

The public Trip Opportunities page (if that flag is on) lists what's
open, with a "Coming soon" teaser for anything still in planning; the
application form (below) renders whatever questions you've set up,
nothing hardcoded.

![The application form](docs/assets/screenshots/public-trip-application.png)

Once confirmed, a participant's own public support-raising page shows
their photo, story, progress toward their goal, and how to give —
never their flight itinerary or anyone's contact info.

![A participant's public support-raising page](docs/assets/screenshots/public-trip-support-raising.png)

Their own private self-service page (reached from their emailed access
link, not this public one) additionally shows the flight itinerary and
donor details, lets them edit their own story/photo directly with no
review step, and is where they fulfill a document or e-signature
requirement themselves. Each meeting listed there shows its title, an
**Add to calendar** link, and the same one-click Yes/No/Maybe RSVP
buttons the emailed invite has — right on the page, with "You
responded: X" once they've answered. Any trip-wide document (shared
with the whole team) is listed here too, with a link to download it.

![A participant's self-service page](docs/assets/screenshots/public-trip-self-service.png)

<!-- SCREENSHOT NEEDED: public-trip-self-service.png should be retaken
to show the new Meetings (title + Add to calendar + inline RSVP),
Trip-wide documents, and self-upload-a-document pieces described above
-- same flag as ADMIN_GUIDE.md. Tracked alongside #264/#266. -->

If they lose their self-service link, a **request a new link** page
always replies the same way whether or not it found anything, so it
can't be used to check whether someone has a trip record at all.

![Lost-link recovery](docs/assets/screenshots/public-trip-access-recovery.png)

#### Wrapping up a trip

When a trip is over, **Wrap up trip** (a button beside the trip's name, for admins, editors and the trip's own leaders) walks through finishing it. It is called _wrap up_, not _close_, because the status **Closed** already means applications are closed and the team is committed, which is not the trip being over.

1. **What happened.** Confirm the actual start and end dates. Finishing marks the trip **Completed**.
2. **Debrief.** A short plain-text answer under each of four prompts: _What did the team do? What went well? What was hard? What does the partner need next?_ Every prompt is optional.
3. **Follow-up.** With the [Contact log](#contact-log) on, tick **Log a visit for this trip** to add it to the partner's contact log (topic "Trip", we reached out) with an optional follow-up date. A trip leader who has a trip grant but isn't on the partner's care team doesn't see this step, since they never reach the contact log.
4. **Loose ends.** Links to the Requirements, Financial and Team tabs for anything still open.
5. **Photos.** The album link, if the trip has none.
6. **Access.** When the trip leaders' access ends: 30 days after the trip's end date unless it was given another date. To extend it or end it now, use the Team tab.

![A finished trip with its Wrap up trip button](docs/assets/screenshots/trip-ready-to-wrap-up.png)

![The debrief step of the Wrap up trip wizard: four optional prompts](docs/assets/screenshots/trip-wrap-up-debrief.png)

The debrief then shows on the trip's **Overview** (with **Edit debrief** to change it later; the first wrap-up time is kept). Nothing is emailed. Two bell items help: **Trips ready to wrap up** (staff, and a leader for their own trip) counts trips whose end date has passed and that aren't completed, and **Trips wrapped up** tells a partner's care team for two weeks after a trip is wrapped up.

![A wrapped-up trip's Overview, with its debrief](docs/assets/screenshots/trip-debrief.png)

### Newsletters & Docs

One place for every file a partner sends — a newsletter update, a
completed survey, a returned signed policy acknowledgment, an email
worth keeping on file long-term, or any other document — distinguished
by a single **Kind** field rather than separate newsletter/document
systems to choose between:

| Kind                | For                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------- |
| Newsletter          | A ministry/prayer update — what most uploads actually are.                             |
| Survey Response     | A completed survey or check-in questionnaire sent back by the partner.                 |
| Signed Policy       | A policy acknowledgment (child protection, code of conduct, etc.) signed and returned. |
| Email Communication | An email exchange worth keeping on file long-term.                                     |
| Office Document     | A Word/Excel/PDF document that doesn't fit the other kinds.                            |
| Other               | Anything else — pick this and type your own label (e.g. "Background Check").           |

Upload from the central **Newsletters & Docs** page (**+ Upload File**:
pick the partner, choose a file — PDF, Word `.doc`/`.docx`, Excel `.xls`/
`.xlsx`, `.eml`, JPEG, or PNG — pick a Kind, optional title/notes) or
directly from that partner's detail page, which embeds the same
upload/view/delete UI. The central page can filter by Kind and by
missionary/organization, so you can, for example, pull up every signed
policy on file across all partners at once. **View** opens the file in a
new tab; **Edit** lets you fix everything but the uploaded file itself —
Kind, title, received date, notes, and (from the central page only)
which partner it's filed under — so reclassifying a mis-filed upload is
just an edit, not a delete-and-reupload. Files here are always private —
never shown on the public site, regardless of the partner's `isPublic`
flag.

![The central Newsletters & Docs page, listing uploads across every partner with their Kind](docs/assets/screenshots/partner-files.png)

### Prayer Sheet

**Prayer Sheet** (under Prayer Requests in the menu) makes something ready for
Sunday: a one-page, printable list of what to pray for, or the same thing as
slides for the screen at church (**Show as slides**: one partner per slide,
arrow keys or the buttons to move, Escape to close). Pick how often you make a
sheet, **every week**, **every two weeks** or **once a month**, and the sheets
rotate through your partners so each comes round about once a month: weekly
shows a quarter of your partners on each sheet, every two weeks shows half, and
monthly shows all of them on one. The same Sunday always gives the same sheet.
Your choice of rhythm is remembered in your browser.

Because it is handed out, it shows only what your public site may show: a
partner that is public, not archived and not restricted, and only its prayer
requests marked as ministry and public that are still ongoing. Private
requests, restricted partners and answered requests never appear.

### Printable partner booklet

**Print Booklet** builds a print-formatted directory: pick a **Look &
Feel** template — Classic (warm accent-colored circles and a soft tinted
callout, with a circular photo) or Modern (clean and structured, no
decorative shapes, bold accent rules, and a rectangular photo) — choose
who's included (archived, restricted-access, organizations), and what
shows on each page (photo, overview, location, address, family info,
sending church/org, and an optional facing **Notes & Prayer Page** with
ruled lines for the reader's own handwritten notes). **Restricted-access
partners are left out until you tick the box** (it is unticked when
the page opens); once ticked, the page says how many restricted
partners are included and cautions that they print with their real
names and details, so hand that booklet only to people who may see
them. The booklet is the church's own document and otherwise prints
partners whether or not they are on the public site. Both templates'
accent color defaults to your church's own brand color (**Primary
Color** in [Church Settings](#church-settings-admin-only)); an instance
that hasn't set one falls back to a fixed four-color rotation instead.
Turning on **Prayer Requests** also turns on, and locks on, that facing
page — a partner's public [prayer requests](#prayer-requests) marked
**Include in printed booklet** print at the top of it, not on the main
page itself (an "answered" one includes its note, an open one doesn't
call out its status at all, same as everywhere else in the app), with
the ruled lines below them; the Notes & Prayer Page can still be turned
on by itself, with no prayer requests, for a facing page that's just
that partner's name and blank ruled lines. With Prayer Requests on, a
**Max prayer requests per partner** field caps how many print for any
one partner (most recent first) so a partner with a long history
doesn't crowd out the rest of their page. Set a cover title/subtitle.
Every booklet also ends with a closing back cover — your church's logo,
name, mailing address, phone, and website (all from
[Church Settings](#church-settings-admin-only)). The preview on the page
re-renders live as you change any option; **Print Booklet** opens your
browser's own print dialog on that same paginated preview — useful for
printing a physical prayer/support directory for your congregation.

![The Print Booklet generator, with the Classic and Modern Look & Feel templates to choose from](docs/assets/screenshots/print-booklet-admin.png)

![One page of the resulting booklet, in the Classic template](docs/assets/screenshots/booklet.png)

### Reports

A hub organized by the question you're actually asking, not a flat list
of report names. **Reports** opens a page of groups — **Money**,
**Partner care**, **Partners & relationships**, **Upcoming**, **Trips**,
**Coverage**, **Communication**, **Contacts**, **System** — each showing
the reports under it as a plain question ("What monthly support has the
church committed, and to whom?", "Who is still missing a requirement
before departure?"). Click a question to open that report.

Reports that list partners take the same **[Sending church](#the-partners-list)** filter as the Partners list, so you can narrow any of them to the partners we sent, or to one other church. Many also show **Last edited by** and **Last edited** columns; see [Who last edited a record](#who-last-edited-a-record).

![The Reports hub, grouped by question](docs/assets/screenshots/reports-hub.png)

Every report page works the same way: set its filters (each one is
reflected in the URL, so a link to a filtered view can be bookmarked or
shared), click **Run report**, and read the summary tiles above the
table for the headline numbers before scanning rows — some tiles are
themselves clickable, filtering the table to just that slice. Results
export as **Download CSV** (same rows and columns as the screen) or
**Print** (a clean paginated layout for handing to a meeting).

![One report's own page, with filters, summary tiles, and a chart](docs/assets/screenshots/admin-report-detail.png)

The current reports, by group:

| Group                    | Reports                                                |
| ------------------------ | ------------------------------------------------------ |
| Money                    | Support summary · Support changes                      |
| Partner care             | Prayer requests · One-time needs · Data completeness   |
| Partners & relationships | Partner roster & tenure · Last heard from              |
| Upcoming                 | Families & key dates                                   |
| Trips                    | Trip fundraising · Trip readiness · Application funnel |
| Coverage                 | Language coverage · Where we serve                     |
| Communication            | Dispatch health                                        |
| Contacts                 | Mailing list                                           |
| System                   | Users & access (admin only)                            |

A report tied to a feature that's turned off (see
[ADMIN_GUIDE.md § Feature toggles](ADMIN_GUIDE.md#feature-toggles))
simply doesn't appear in the hub. With **Monthly support** turned off,
the two reports that stay (**Where we serve** and **Partner roster &
tenure**) also leave out their committed-amount columns, totals and
chart, on screen, in the CSV and in a scheduled email, so no support
amount shows anywhere while that feature is off.

**Saved views** on a report's own page let you save a set of filters by
name — **private** (only you see it) or **shared** (everyone with access
to Reports sees it) — and apply it again later with one click instead of
re-setting every filter. An admin can turn any saved view into a
**scheduled report email**: pick weekly, monthly, or quarterly, and it's
emailed with that view's filters already applied to the recipients you
choose, masked the same way the screen is for a restricted partner.

## Caring for partners

Everything for keeping in touch with partners, in one place: who looks after each partner ([Care teams](#care-teams), including the Guest role), how to log and follow up on contact ([Contact log](#contact-log)), reminders for birthdays and anniversaries ([Key-date reminders](#key-date-reminders)), and passing news on ([Passing updates on to partners](#passing-updates-on-to-partners)). Each is a feature you turn on in [Enabled Features](ADMIN_GUIDE.md#feature-toggles).

### Care teams

With **Care teams** turned on in [Enabled Features](ADMIN_GUIDE.md#feature-toggles), every partner can have a **care team**: one **Lead** and any number of **Members**, the people at the church who keep in touch with that partner. An admin or editor sets it from the partner's page (**Care team**, near the top) or from the **Team** tab of one of that partner's trips, and can also add a **Guest** to a partner's team while creating their account (choose the Guest role in **Add User**, then the **Care team** step; other roles don't get that step). Each member's phone, email and a short note about them show under their name (staff roles only; a Guest doesn't see them); people add their own under **My account → Your details**, and an admin can add them in **Add User** or the user's edit popup. Everyone on a team needs a login; someone who isn't on your staff can be a **Guest**. **Reports → Care team coverage** lists the partners with no team or no lead.

The team shows as one line on the partner's **Contact** card ("Care team: Pat (lead), Casey") with **Edit team** beside it, or **+ Assign team** when nobody is set.

![A partner's Contact card with the care team on one line](docs/assets/screenshots/care-team-and-contact.png)

![The Care team dialog, choosing a Lead and ticking Members](docs/assets/screenshots/assign-care-team.png)

A care team member uses the same app as everyone, and for **their own partner** they can do what an editor can: edit the partner's profile, family, contact details, links and photos; add and edit prayer requests (and record answers) and one-time needs; and upload and edit newsletters and documents. They can also see that partner's trips, read-only. Three things are different:

- **What they enter is saved immediately, but isn't sent to the church** by email, GroupMe or WhatsApp **until an admin or editor approves it** in [Updates to Share](#updates-to-share). They can't mark anything urgent or use "approve now".
- **They can't approve or decline a one-time need** or record a decision on it. That stays with the committee or board.
- **They never see monthly support** — its amount, how long it has run, or its history.

They also can't create or delete partners, or delete records, and they can't use the AI scan of a newsletter (it sends the letter to an outside service, so it is for admins and editors only). If you're an admin or editor yourself, being on a team doesn't limit you or hold your entries; it just adds the care-team features.

![Updates to Share, where an entry from a care team member is held for staff to approve](docs/assets/screenshots/pending-dispatches-care-team.png)

A **Guest**, whether on a care team, given a trip, or both, sees one plain **Partners** list of every partner they can reach, with no tabs. Staff who are on a care team still land on All and switch to the **My partners** tab when they want it.

![A care team guest's Partners page: one list of the partners they can reach](docs/assets/screenshots/care-team-member-partners.png)

A **trip leader** (a Guest given a trip) has a smaller view: their trips, and those trips' partners read-only. They don't get the care-team list pages or one-time needs.

![A care team member's view of their partner: they can edit what's theirs, and see no monthly support](docs/assets/screenshots/care-team-member-view.png)

#### My partners

**My partners** is a tab on the Partners page for anyone on a care team. It lists your partners longest-quiet first: days since the last contact, any follow-up that has come due, the next birthday or anniversary, and open prayer requests and needs. A partner counts as **quiet** after 90 days of not hearing from them: a logged contact, a newsletter filed, a prayer request they sent or a visit to your church each start the count again. The 90 days is a church setting.

![The My partners tab, listing a care team member's partners longest-quiet first](docs/assets/screenshots/assigned-to-me.png)

**Partners to reach out to**, on the bell and the Home page, counts your partners that are quiet or have a follow-up due.

It works with the [Contact log](#contact-log): logging a contact resets a partner's quiet days, and so does anything else that shows they are in touch (the same four things the **Last heard from** report counts). The column is called **Last heard from**.

A partner nobody has contacted yet is not called quiet straight away: their quiet days count from the day they joined your list, so a new install (or a partner you just added) is not instantly all overdue. For a partner in a busy or private season, open **Edit contact** and set **Not this season**: until that day they are left out of "quiet" on My partners, the bell and the care chat posts, and My partners shows "Not this season until ...". A follow-up date you set on purpose still shows. Clear the date to bring them back.

### Contact log

With **Contact log** turned on in [Enabled Features](ADMIN_GUIDE.md#feature-toggles), every partner page gets a **Contact** card and a **Contact Log**.

- **The contact card** is where who to reach, how they like to be reached and how careful to be are shown and **edited** (**Edit** on the card): who to reach first (the adult marked **Primary contact**, picked from a list, or an organization's named contact), **how each person likes to be reached** (a phone call, text, email, WhatsApp, Signal, Messenger or another way), highlighted as "Prefers Email", one-tap **Call**, **Text**, **Email** and **WhatsApp** buttons, and when anyone last was in touch. Anyone else in the family who has their own preference is listed under it. The card is there even when the contact log is off; only the "last contact" line needs the log.

![A partner's Contact card for a partner we are not to contact directly: who to go through, with their own Call and Email buttons, in place of the family's details](docs/assets/screenshots/contact-card-instructions.png)

- **How careful to be** is one of three settings, chosen by staff on the card:
  - **Normal:** reach them as usual.
  - **Use caution:** their details and buttons stay, under a warning that carries your **guidelines** (for example "email only, and don't use the word mission in a subject line"). You can limit the ways it is ok to reach them, and then only those buttons show, so nobody texts someone who is email-only.

![A Contact card under Use caution: the guidelines in a warning, and only the Email button](docs/assets/screenshots/contact-card-caution.png)

- **Don't contact directly:** their phone, email, buttons and preferred way are hidden, replaced by **who to go through** (a name, role, phone and email, with their own **Call** and **Email** buttons) and the guidelines. The printed booklet also leaves out their phone, email, address and preferred way.
- **Log a contact** with **+ Log contact**: pick what happened (call, text, email, visit, card, video, prayed for them), who reached out, optional topics, the date, who made the contact (you, by default), an optional note and an optional **follow up by** date. Anyone who can see the partner can log one. Only an admin or editor can edit or delete an entry.

![The Log a contact dialog](docs/assets/screenshots/log-a-contact.png)

![A partner's Contact Log, newest first](docs/assets/screenshots/contact-log.png)

- **Only the latest few show on the partner's page.** The three newest entries (and filed visits or newsletters) appear in the card, so it doesn't grow with every contact. **View all N logged contacts →** opens the **Contact Log** page already filtered to that partner, where you can also filter by type, direction or topic, or clear the partner to see everyone's. Add or fix an entry from the partner's page.

- **A prayer request a care team member enters** also logs the contact, so it isn't typed twice.
- **Church visits and newsletters filed** for the partner also appear in the Contact Log, among the entries and newest first, as read-only rows (a visit, "Newsletter filed"). They are read from their own records when you open the page, not copied, so editing or deleting a visit or newsletter updates the log at once. Only a logged contact can be edited or deleted here.
- **Updates to pass on.** When a one-time need has been decided or a prayer answered and nobody has passed it on yet, the Contact Log shows an **Updates to pass on** box with a **Log that I told them** button: the update is news for the partner (their prayer was answered, or their request was decided), and this is how you record that you passed it on. It opens **+ Log contact** already set to "We reached out" with the right topic ticked, so saving it clears the bell's "Updates to pass on to partners". You still choose how you got in touch.
- **My partners** and **Partners to reach out to** (for anyone on a care team) are described under [My partners](#my-partners).

The **Last heard from** report counts a logged contact, a newsletter, a prayer request they sent and a church visit as hearing from a partner: a partner is only "quiet" when all of them are old. How long is "quiet" is a church setting (default 90 days; Settings → Partner Care → Quiet partners), and the report uses it unless you type another number for a run. Trip leaders don't get the contact log.

### Key-date reminders

With **Key-date reminders** turned on, whoever looks after a partner (its [care team](#care-teams), or your missions team) is reminded about a coming **birthday** (including the children's), **wedding anniversary**, or **partnering-since milestone** (the first year, then every fifth), or the anniversary of when they were **commissioned** (record both on the partner's page under **Our History With Them**; they can differ, since someone may have been commissioned long before we knew them), a week ahead.

- **On the bell and the Home page** as "Key dates coming up". Open it to find the partner. The **My partners** tab also flags a key date inside the window. A key date is raised **7 days ahead** by default; an admin can change that (1 to 60 days) under Settings → Partner Care → Key-date timing.

![The bell, with Key dates coming up among a care team member's alerts](docs/assets/screenshots/bell-alerts.png)

- **Send a greeting.** On the **My partners** tab, a key date inside the window has a **Send greeting** button where we may email them (not for a restricted partner, one marked not to be contacted directly, or one whose allowed ways exclude email, and not when there is no address). It opens a prefilled draft in your own mail program, so you read and send it yourself; the app never sends it. Afterwards it asks whether to log it, and saying yes records an email with the **Key date** topic, which clears the reminder.

- **In your email digest**, if you have one (My account → Email updates). A **Key dates coming up** section leads the digest, listing dates **90 and 30 days out**, each once, so a monthly or quarterly digest still gives you time to plan. The earlier heads-ups are a church setting (Settings → Partner Care → Key-date timing).
- **By a short email of its own** for the last stretch (the final **7 days** by default), sent at 7am church time on a day something is due, listing everything coming up for your partners (not one email per partner). If your next digest would reach you on or before the date, you get it there instead, so you aren't emailed twice. Someone with no digest always gets the short email. It needs Email (Sending) turned on, and it's sent at 7am church time. **You can turn the email off for yourself** under **My account → Key-date email** (a Guest on a care team can too); the alert on the bell stays either way.

![The grouped key-date email](docs/assets/screenshots/key-date-email.png)

- **Who gets it:** the partner's whole care team, lead and members, when it has one. A partner with no care team goes to your **missions team** (an admin picks who is on it under Settings → Partner Care, and can call the group whatever your church says); with nobody on it, nobody hears about it. People on the missions team also see those partners under **Partners to reach out to** (on My partners they are marked with the group's name). A Guest is never on it: a guest only sees the partners they have been given.

![Settings → Partner Care, where an admin picks who is on the missions team](docs/assets/screenshots/care-teams-settings.png)

- **To clear a reminder**, send the card or make the call and **log it as a contact with the topic "Key date"**. That stops the reminders for that occasion, and it counts as being in touch.
- The app never sends the card for you, and a restricted partner appears in the email by initials only. A partner you are asked to be careful with (Use caution, or Don't contact directly) is marked in the email so a reminder to "send a card" isn't read as "call them".

### Passing updates on to partners

The app never contacts a partner on its own — a person always does. If you're on a partner's [care team](#care-teams), it tells you when there's something to pass on:

- **New needs and prayer requests** on your partners show on the bell (as they do for staff), so you know before the church does.
- **Updates to pass on to partners** (bell and Home page) counts, for your partners, a one-time need the committee **decided** and a prayer request that was **answered** in the last 30 days. Open the partner to see the decision and its note, then tell them yourself.
- **To clear one**, [log the contact](#contact-log) as something **you** sent or did (we reached out): topic **Need / support** for a decision, **Encouragement** or **Prayer** for an answered prayer — a thank-you card or call counts. An entry made because the partner reached out doesn't clear it.
- **When a partner tells you a prayer was answered** and you mark it answered, that is logged as a contact for you automatically (it still waits for staff approval before the church is told).

### Support preferences

With **Support preferences** turned on in [Enabled Features](ADMIN_GUIDE.md#feature-toggles) (it works with or without [Care teams](#care-teams)), each partner's page gets a **Support preferences** card, in the **Care & Follow-up** section (jump bar: **Care**): the ways your church can support them, and which of them this partner has asked for. The card stays compact (how many are recorded, and which groups); click that line to open everything, with their notes.

- **The menu is your church's.** An admin edits it under **Settings → Support Preferences**: options are put in groups (rename a group any time), and each is something you **offer** (tick it if wanted), a **pick one** or **pick any** question (with an optional "something else" box), or a **free-text** question. From an empty menu, **Import a menu…** takes an example [template pack](#template-packs) (housing, transportation, speaking about the partner, prayer, care packages, how to send gifts and so on) to edit or delete. **Retire** an option to stop offering it while keeping the answers already given, or **Delete** it to remove it and those answers. **Print menu** (top right of that page) opens a clean copy with the church's name and logo, boxes to tick and lines to write on, for a conversation with a partner; retired options are left out, and it stores nothing.
- **Record a partner's choices** with **+ Record** (or **Edit**) on their page, after a conversation: tick what they want, pick their answers, add a note. One set per partner, so a couple or family shares it. Admins, editors and a guest on that partner's care team can record it; a viewer can read it. A trip leader never sees it.
- **Staff-only options.** An admin can tick **Staff only** on an option (Settings → Support Preferences) so its answers are hidden from care team members and shown only to staff; the example "What can and cannot be shared with others?" starts that way.
- **Tag a contact with an option.** When you log a contact, **Which support option was this about?** links it to an option, and the log shows "re: Airport pick-up". The label is kept even if the option is later retired or deleted.
- **Who can see it:** staff and the partner's care team only, on the partner's page. It never appears on the public site, in the booklet, or in dispatches. How a partner prefers to be contacted is the **Preferred contact** on their Contact card, not here.
- **Reports → Support preferences** lists what each partner has chosen (sort by an option to see who wants it) or, with **Show: Partners with nothing recorded**, who still needs that conversation.

![A partner's Support preferences card, compact; click the line to see everything](docs/assets/screenshots/support-preferences-card.png)

![The full details popup, grouped by kind of support](docs/assets/screenshots/support-preferences-details.png)

![Settings → Support Preferences, the church's own menu](docs/assets/screenshots/support-preferences-settings.png)

![The printable menu, as it prints](docs/assets/screenshots/support-preferences-print.png)

### Partner surveys

With **Partner surveys** turned on in [Enabled Features](ADMIN_GUIDE.md#feature-toggles) (it works with or without [Care teams](#care-teams)), admins and editors can ask partners a few questions and keep the answers with the partner.

- **Build a survey** under **Settings → Surveys → + New survey**: a title, an introduction, and questions (free text, yes/no, pick one, pick any; mark any as required). **Open survey** when it is ready; **Close survey** when you are done.
- **Send it.** On the survey's page, **Send** lists every active partner. Tick who should get a personal link, use the shortcuts (**Select everyone not yet sent**, **Select those still waiting**, **Select all who can be emailed**) or **Find a partner…** to narrow the list, then **Send to N**. A person always starts the send, and **Send as a reminder** follows up the ones still waiting. Partners the app may not email (restricted, marked not to be contacted directly, or no address on file) can't be ticked: fill the survey in for them instead. Sending a link again replaces the earlier one.
- **The partner's side.** The email has one button. Their page needs no login, works on a phone, lets them save and finish later, and lets them change their answers until the survey closes. **Save and finish later** keeps every answer that is fine and lists any it could not keep (a mistyped phone number, say) so they can fix just those; **Submit** still refuses until everything is right. The "Saved" and "Thank you" messages appear beside the buttons, where they just pressed, and scroll into view on a phone.
- **Fill it in for them.** On the partner's page, the **Surveys** card (in **Care & Follow-up**) lists each open survey and where it stands. Click one to **Fill in** after a conversation; it records who entered it. Staff and the partner's care team can do this, and a viewer can read.
- **See the answers** on the survey's page under **Answers**, or on the partner's card. **Reopen** lets a partner change a submitted response. **Reports → Survey responses** lists who is waiting, who answered, and who has not been sent a survey.
- **Who can see it:** staff and the partner's care team only. It never appears on the public site, in the booklet, or in dispatches.

![A survey's page in Settings: progress, details and questions](docs/assets/screenshots/surveys-detail.png)

![Choosing who to send a personal link to](docs/assets/screenshots/surveys-send.png)

![Filling a survey in for a partner from their page](docs/assets/screenshots/surveys-card-fill.png)

![What a partner sees on their phone](docs/assets/screenshots/surveys-partner-page.png)

#### Start from an example

Rather than build every survey from scratch, **Import a survey…** (top of **Settings → Surveys**) takes a [template pack](#template-packs): the examples include a **Care check-in**, an **Annual update** (contact details, emergency contact, a photo and a short update), **Getting to know you** (a fuller partnership survey) and **Furlough and visit planning**, and **How can we support you?** (partners pick from your support menu). An imported survey arrives as an ordinary **draft** you can change freely. **Export** on a survey's page saves it as a pack to share.

#### Updating a partner's record from their answers

A question can be linked to a part of the partner's record: in the survey builder, pick **Suggest a change to their record** on a text or pick-one question, use a **Mailing address** question (street, city, region, postal code and country boxes), use a **Support preferences** question (the partner sees your support menu, Settings, Support Preferences; staff-only options are never shown, and Support preferences must be on), or use a **Photo** question. A support answer shows on Survey Updates as one line per option that would change, and approving it fills in only those options on the partner's page, keeping any staff note already there. The Annual update template is already linked for the phone number, email, preferred contact method, emergency contact and photo.

- **Decided together.** Changes are grouped by partner, with **Approve all** and **Reject all** for the group. A new answer from a partner also appears on the bell as **New survey answers** (for staff and for the care team on their own partners); the **Survey updates to review** item is shown only to admins and editors, who can act on it.
- **Nothing changes by itself.** When a partner's answer differs from what is on file, it appears on **Survey Updates** (sidebar, with a count, and on the bell) showing what is on file now next to what they answered. A photo shows as a thumbnail.
- **Approve** applies it to their record, exactly as if you had edited it on their page ("last edited by" and the audit log record you). **Edit** lets you correct the value first (for example to fix a phone number's format) and then approves it. **Reject** leaves the record alone, and a rejected photo is deleted.
- A photo a partner sends is held until you approve it, then becomes their current photo; the earlier one stays in their photo history.
- Only a short list of fields can be linked: primary contact's phone, email and preferred contact method, emergency contact name, phone and email, a one-line overview, the mailing address, and the photo. Public visibility, restricted status, location and names can never be changed this way.
- If the same answer was already approved or rejected, it is not proposed again; a changed answer replaces the one waiting. The **Decided** tab keeps the history.

![Survey Updates: what each partner's answers suggest changing](docs/assets/screenshots/survey-updates.png)

It records preferences; it doesn't schedule or assign anything, and the app never contacts a partner for you.

## Settings

### Church Settings (Admin only)

One record controls the whole instance's branding, on one **About &
Branding** page under Settings, split into two sections — changes on
either take effect immediately, everywhere, with no code changes
needed:

- **About Church** — Church Info: name, phone, contact name/email,
  website, timezone, **currency** (how every amount in the app is written:
  monthly support, one-time needs, trip money, reports and announcements;
  it changes only the symbol and converts nothing, so check existing
  figures if you change it), and address. This is also what auto-fills "Sent by our church"
  on the missionary form. Right after saving a change here, if any
  partners are marked "Sent by our church," a prompt appears showing how
  many and offering to **update them all with this info** — a one-click
  bulk overwrite of every such partner's Sending Church section, for
  keeping everyone in sync after an address or contact change. It's
  deliberate, not automatic: saving About Church alone never touches any
  partner on its own.
- **Branding** — Public Site (tagline, about text, an optional Scripture
  passage and its source shown above the Subscribe form (empty by default,
  so you choose the translation and check its licence), three independent
  colors, plus a font choice), Logo, and Partner Terminology (swap
  "Missionary" for whatever your church calls them, and optionally use
  that term in the admin nav too). Each color controls a different part
  of the app, so a church can genuinely style itself rather than
  tinting everything the same shade:
  - **Header Color** — the header bar and the admin sidebar background.
  - **Accent Color** — buttons, links, headings, and report
    letterheads — the color people actually associate with the church.
  - **Highlight Color** — hover, focus, and active/selected states, e.g.
    a button on hover or the current nav item.

  All three also flow into the [email digest](#how-the-update-email-looks)'s
  Snapshot layout and its masthead/buttons, so the digest looks like the
  same product as the rest of the site, not a separately-styled email.
  **Reset to Default** clears all three colors and the font back to the
  built-in look in one click; changing nothing leaves every surface at
  its current built-in default, the same visual look as before this
  feature existed.

![The About Church page, with Church Info and address fields](docs/assets/screenshots/about-church.png)

![The Branding page, with Public Site, Logo, and Partner Terminology](docs/assets/screenshots/branding-settings.png)

### User management (Admin only)

**Manage Users** lists everyone with access — email, role, active status,
MFA status, last login.

At the top, **Two-factor sign-in** is one switch for the whole church:
**Require it for everyone** makes every account, whatever its role,
set up two-factor authentication. It shows how many active accounts
haven't yet. Turning it on signs out anyone who hasn't set it up (their
next click takes them back to sign-in, where they're walked through
enrollment), and while it's on nobody can turn it off for themselves; if
someone loses their authenticator, **Reset MFA** on their row sends them
through enrollment again. It only turns on for an admin who has set up
two-factor on their own account first, so it can't lock you out, and it
can't be turned on for the public demo. It's off by default. Turning it
on or off is recorded in the [Audit Log](#audit-log-admin-only).

Below it, **Passwordless sign-in** takes passwords away church-wide: people
with a passkey sign in with it alone, and everyone else gets an emailed
one-time link and is then asked to add a passkey. It shows how many active
accounts have no passkey yet, and the turn-on button explains itself when it
is disabled: it needs outbound email set up (the emailed links depend on it)
and a passkey on your own account (so it can't lock you out). Turning it on
confirms first, since it ends password sign-in for everyone; it implies the
two-factor requirement; passwords aren't deleted, so turning it off puts
everyone back; and outbound email can't be switched off while it is on. If
email breaks, or someone loses their passkey, **Reset MFA** on their row
clears it and you hand them a setup link. It can't be turned on for the
public demo.

![Manage Users with passwordless sign-in on](docs/assets/screenshots/manage-users-passwordless.png)

**+ Add User** opens its own page: email, name,
role (Admin, Editor, Viewer, or Guest — pick at least one trip for a
Guest), then how they'll get access — **Send a welcome email** (on
by default) emails them a one-time "Set up your sign-in" link so you
never type or see their password; **Require two-factor authentication at
first sign-in** can be turned on at the same time. **With email off**
(or switched on but not finished setting up) the page never offers to
send anything: the tick box reads **Give me a setup link to pass on**,
the note under it says nothing is emailed, and when you save, the
one-time setup link is shown right there to copy and send however you
like (a text, your own email, in person). **Send setup link** on a row
in Manage Users works the same way, and only ever says "Setup link
sent" when an email really went out. If there is no link to show
either (the site has not been told its own web address, `APP_BASE_URL`),
the message says so and tells you to set a password for the person
from **Edit**. Turn the tick box off to set a
password yourself (or leave it blank and use **Send setup link** on their
row in Manage Users later) — either way, every account is still email +
password once set up, per [Logging in](#logging-in) above. A setup link
expires after 72 hours (7 days for a Guest); their account stays
pending — visible in Manage Users, but unable to sign in — until a
password is actually set.

For a Guest, Manage Users also shows each trip they can reach and when
that access ends. Click their row to extend a trip's access to a date,
end it now, go back to the automatic date (30 days after the trip ends),
add another trip, or remove one. Removing a guest's last trip
deactivates the account (it isn't deleted). Guests whose access has
ended or been removed are flagged in the list, and **Inactive accounts
only** shows just those, so you can reach out and clean up. A trip's own
**Team** tab has a **Guest access** section for the same thing from the
trip's side, and a team member's page has **Give guest access** to
create their login in one step.

![The Add User page, with Basics and Account Setup steps](docs/assets/screenshots/add-user.png)

![Add User's Care team step, choosing partners for a Guest to look after](docs/assets/screenshots/add-user-care-team.png)

Editing an existing user (from their row in Manage Users) lets you change
role, deactivate, require two-factor for just that account, or reset a
password. **Reset MFA** clears a locked-out user's two-factor setup (their
recovery codes included) so they can log back in and re-enroll (with just their password, or straight
into enrollment if the church requires two-factor) — for your own account,
use **Disable Two-Factor Authentication** on [Your account settings](#your-account-settings)
instead (not available while the church requires it), which requires your
current password; **Reset MFA** on your own
row is blocked here, since skipping that password check is exactly how a
hijacked session could silently strip your own two-factor protection.
You can't delete your own account, and the app won't let you demote,
deactivate, or delete the last active admin — there's always at least
one way back in.

![The Manage Users page: the Two-factor sign-in panel, then each account with its role, active status and MFA status](docs/assets/screenshots/manage-users.png)

### Database Backups (Admin only)

**Backups** is a section of the **About App** page under Settings
(formerly its own nav item, now folded in alongside System Info below —
same page, scroll down). Any admin can download a full backup of
everything in the database — every partner, user, and uploaded file —
as a single file, on demand, with no setup required. Nothing is kept
server-side; the download is the only copy, so save it somewhere safe
right away. The file is unmasked and highly sensitive (restricted
partners' real data, password hashes, encrypted two-factor secrets) —
treat it accordingly. Restoring one is a deliberate command-line step,
not a button — see
[ADMIN_GUIDE.md § Database backups](ADMIN_GUIDE.md#database-backups) for
the full runbook.

The same section also has a periodic reminder banner (asking you to
confirm your database provider's own backups are working) with an
explicit, permanent opt-out for a church that's already confirmed that
elsewhere — checking that box requires a deliberate save, not just a
casual dismiss.

![The Backups section of the About App page: a Back up now button and the opt-out for the periodic reminder](docs/assets/screenshots/backups-settings.png)

### System Info (Admin only)

**System Info** is the top section of the same **About App** page
(Settings → About App) — a read-only view of what's actually running on
this instance: the app version (plus the same "update available" check
the dashboard banner already does), Node.js/React/React DOM versions,
the Postgres version and database size, and — when running on Render —
the service name, git commit, and external URL. Useful for confirming
what you're on before filing a bug, without needing shell access. Never
shows a connection string or any credential.

![The top of the About App page: app, runtime, database, and deployment details](docs/assets/screenshots/system-info.png)

### Audit Log (Admin only)

The **Audit Log** is on by default (turn it off in [Enabled Features](ADMIN_GUIDE.md#feature-toggles) if you'd rather not keep it), and admins get **Settings → Audit Log**: who did what, and when, for the actions that matter if you ever need to ask "who changed that?".

- **What is recorded:** sign-ins (and failed ones, with the reason and where from), password and two-factor changes, accounts created, changed or deleted, a guest's trip access given, changed or removed, care team changes, every change to church settings (a feature turned on or off, an API key changed), partners and trips deleted, backups downloaded, a partner being marked restricted, and **each person's first look at a restricted partner each day**.
- **What isn't:** routine work — a new prayer request, an edited overview, a logged contact. Those are already visible on the record itself.
- **Secrets are never stored.** Changing an API key or token is listed as "changed"; the value is not kept anywhere in the log.
- **Find things:** search by name, email, record or IP address; filter by what kind of event and by date; **Export CSV** downloads exactly what the filters show.
- **Admin only.** The log names restricted partners in full (admins can already see them), so treat an export like any other file holding that data.
- **Deleted accounts stay readable.** An entry keeps the name and email of who did it and who it was done to, so it still reads after either account is deleted, and is tagged "(deleted account)".
- **How long it is kept:** 30, 60 or 90 days (default 90), set on the same page. Older entries are deleted each night.

![The Audit Log page: who did what, with filters, an export button and the retention setting](docs/assets/screenshots/audit-log.png)

For who last changed one record (kept for good, and shown on the record itself), see [Who last edited a record](#who-last-edited-a-record).

## Communications

### GroupMe dispatch (Admin only)

Posts new prayer requests, one-time needs, and newsletters to GroupMe so
a team sees them without checking the admin dashboard. A prayer request
getting **Record Answer**ed or a one-time need getting **Record
Decision**ed posts too — the original ask alongside the outcome, into
that same type's topic, no separate setup. Off by default — turn it on
in [Enabled Features](ADMIN_GUIDE.md#feature-toggles) once it's set up
here.

These don't post the instant they happen — GroupMe has its own daily
batch time (set on the Sending Updates page), and an item marked
**urgent** posts right away regardless of that schedule — see [Marking
something urgent](#marking-something-urgent). See [Updates to Share](#updates-to-share) for the queue itself, and
[Sending Updates](#sending-updates-admin-only) for the
schedule.

Setup, on the **GroupMe** page under Settings, builds up in
steps:

1. **Access Token** — paste a personal access token from
   [dev.groupme.com](https://dev.groupme.com). Messages post under that
   account's own GroupMe identity, not a bot — write-only once saved,
   same as a password field; leave it blank on a later save to keep the
   existing one.
2. **Group** — click **Load My Groups** to pull the token's actual
   GroupMe groups, pick one, **Use This Group**.
3. **Topics** — click **Load Topics** once to pull that group's real
   Topics. The three sections below (**Prayer Requests Topic**,
   **One-Time Needs Topic**, **Newsletters Topic**) all share that same
   list — pick a topic and **Use This Topic** for whichever dispatch
   types you want; skip any you don't. Until a topic is picked for a
   given type, that dispatch posts to the group's main conversation
   instead.

![The GroupMe settings page, with all steps configured](docs/assets/screenshots/groupme-settings.png)

If GroupMe itself is unreachable or rejects a post, whatever you were
saving — a prayer request, a one-time need, a newsletter, an answer, a
decision — still saves normally; it just queues for the next send
attempt. The dispatch is best-effort and never blocks your own work.

The newsletter dispatch includes a direct link to the letter (the
same link **View** opens on the newsletter's own page) — this only
appears once `APP_BASE_URL` is set, or automatically on Render (see
[ADMIN_GUIDE.md § Environment variables](ADMIN_GUIDE.md#environment-variables)).
Whoever clicks it needs to be logged into the admin dashboard, same as
any other admin link.

Once it's sent, a prayer request, one-time need, or newsletter shows up
in its own configured Topic within the GroupMe app itself, same as any
other message, with the full request/need text (not a summary) and
several queued items packed into as few messages as fit GroupMe's
1,000-character limit:

![A new prayer request dispatch, as it actually appears in the GroupMe app](docs/assets/screenshots/groupme-notification.png)

![A new one-time need dispatch, with the prayer/meeting-prep note above the need itself](docs/assets/screenshots/groupme-notification-need.png)

![A new newsletter dispatch, with a direct link to the letter](docs/assets/screenshots/groupme-notification-newsletter.png)

### WhatsApp dispatch (Admin only)

Posts the same new prayer requests, one-time needs, and newsletters to
WhatsApp — each type to its own group inside one WhatsApp community.
It's an alternative or addition to [GroupMe](#groupme-dispatch-admin-only):
a church can use either or both. Off by default — turn it on in [Enabled
Features](ADMIN_GUIDE.md#feature-toggles), then set it up on the
**WhatsApp** page under Settings (it only appears once the
feature is on). **Read [ADMIN_GUIDE.md § Dispatch:
WhatsApp](ADMIN_GUIDE.md#dispatch-whatsapp) first** — this is an
unofficial connection and you'll want a dedicated phone number for it.

WhatsApp sends once a day, at an admin-set hour, and has its own three
content-type mutes (Prayer Requests / One-Time Needs / Newsletters) —
both set on the [Sending Updates](#sending-updates-admin-only)
page. Beside those three, **partner care posts** (a coming key date, a
partner nobody has heard from, and news to pass on to a partner) have
their own switches, **off until you turn them on**, and share one
Partner Care topic or group; a restricted partner is named by initials
only. GroupMe shares that same daily-hour field and the same three
mutes, because both are chat-style, near-real-time channels — not
because WhatsApp depends on or borrows GroupMe's settings — but
WhatsApp's own on/off state, community/group configuration, and
delivery are entirely its own; turning GroupMe off, or it being
unreachable, never affects WhatsApp. An item marked **urgent** posts
right away. Items waiting for the same group go out together in one
message.

Setup builds up in steps:

1. **Link the number** — click **Show QR Code**. On the dedicated phone
   open WhatsApp → Settings → Linked Devices → Link a Device, and scan
   the code shown. The page shows whether the number is connected, and
   warns if WhatsApp has flagged it. **Unlink Number** removes it and
   clears your choices below.
2. **Community** — once connected, **Load My Communities**, pick yours,
   **Use This Community**. The number must already be a member. The
   community's built-in **Announcements group** is detected
   automatically at this point (no picker for it — it's shown read-only)
   and works the same way GroupMe's main conversation does: it's where a
   dispatch type with no group of its own posts instead.
3. **Groups** — **Load Groups** once to pull the community's real groups,
   then pick a group and **Use This Group** for each of **Prayer
   Requests**, **One-Time Needs**, and **Newsletters** you want. A type
   with no group of its own picked posts to the Announcements group
   instead; only if neither is set does it not go out over WhatsApp at
   all. Picking a different community clears the group picks and
   re-detects the new community's Announcements group.

![The WhatsApp settings page, with the number linked and every step configured](docs/assets/screenshots/whatsapp-settings.png)

If WhatsApp is disconnected or rejects a post, whatever you were saving
still saves normally; the dispatch stays queued and goes out on the
next send.

![A WhatsApp community's groups, including the built-in Announcements group used as the fallback](docs/assets/screenshots/whatsapp-community-groups.png)

What a church's members actually see once messages go out — a Prayer
Requests group with new and answered requests, and a One-Time Needs
group with new and decided needs:

![The Prayer Requests group showing new and answered prayer requests](docs/assets/screenshots/whatsapp-prayer-requests-group.png)
![The One-Time Needs group showing new and decided one-time needs](docs/assets/screenshots/whatsapp-one-time-needs-group.png)

### Updates to Share

The **Updates to Share** page (in the main menu, alongside If Email (Sending), GroupMe and WhatsApp are all off, nothing goes out on its own: the page offers **Copy the updates that are ready** (grouped by partner, leaving out anything still held for review) so you can share them yourself, then clear them.
Emails to Sort) is where every prayer request, one-time need, and
newsletter queues before going out — the shared review-and-send queue
behind both GroupMe dispatch above and email digests below. Only
shows up once GroupMe dispatch or Email (Sending) is turned on —
no point reviewing a queue neither channel will ever read. Visible to
any logged-in role; only an admin or editor can actually edit, approve,
or clear an item. For the schedules, GroupMe's content-type mutes, the
restricted-partner safety gate, and email dispatch appearance, see
[Sending Updates](#sending-updates-admin-only) below.

The list shows everything currently queued, grouped by partner, with a
prayer request or need that came from a newsletter nested right under
that newsletter instead of repeated separately. There's no manual
"send everything now" button here — for a specific item that needs to
go out right away, check **urgent** on it when you create it instead,
see [Marking something urgent](#marking-something-urgent).

![The Updates to Share page: a regular partner's prayer requests and one-time needs (new and answered/decided), grouped with a restricted partner's already-reviewed items below](docs/assets/screenshots/pending-dispatches.png)

Items a [care team member](#care-teams) enters are held here for review whatever the partner — nothing goes out until an admin or editor approves it, the same way a restricted partner's items are held.

A queued item only clears once every currently-enabled channel has
actually sent it — if GroupMe is down but email goes out fine, that item
stays queued and only retries GroupMe next time, rather than going out
to email twice.

A partner marked **Restricted-access** (see [Understanding
restricted-access partners](#understanding-restricted-access-partners))
shows a **Restricted** badge on its queued items here, and its name,
photo, and any source link are masked the same way they are everywhere
else a restricted partner appears, regardless of anything below.

**Editing any item.** Every queued item has an **Edit** button — opens
the real (unmasked) text in a small editor, for a quick wording fix
before it goes out. Saving takes effect on that item's next send; it
has no effect on _whether_ an item is eligible to send, except for a
held item (next).

**Reviewing a restricted partner's request or need.** A restricted
partner's prayer request or one-time need — new, answered, or decided
— can't send on any channel, on schedule or urgent, until an admin or
editor reviews it. Marking something urgent (see [Marking something
urgent](#marking-something-urgent)) doesn't skip this — it still shows
the amber **Awaiting review** badge and stays held until cleared, the
same as it would without the urgent checkbox.

The real (unmasked) text shows right there on the row itself, not a
generic placeholder — the structural masking above (name, photo,
source link) is the actual protection here, not the wording, so there's
nothing gained by hiding it in this one list when [Prayer
Requests](#prayer-requests) and [One-Time
Needs](#financial-support--one-time-needs) already show it to anyone
logged in regardless of role. Clear the hold one of three ways:

- **Approve** — confirms the text already shown on the row and clears
  the hold in one click, with nothing to edit.
- **Edit**, then **Save and Approve** (the Save button's label when the
  item is held) — edit the wording first, confirm, and save; the hold
  clears at the same time.
- **Review and approve now**, checked while creating the request or
  need in the first place, instead of coming back here at all — see
  [Marking something urgent](#marking-something-urgent).

Any of the three, the confirmation prompt repeats the exact text that's
about to become sendable and asks you to check it for anything else
that could identify the partner or their location before confirming —
the structural masking above (name, photo, source link) stays in
effect regardless, but the wording itself is otherwise sent as-is.
Once reviewed, the item is eligible for the next send like any other
queued item; editing it again later overwrites what was previously
reviewed.

The **Pending (N)** heading shows a note when any items are being held
this way.

Any item, restricted or not, reviewed or not, can be removed from the
queue without sending it with the **Clear** button on its row.

### Marking something urgent

A **Mark as urgent** checkbox is available to admins and editors when
creating a prayer request or one-time need (not when answering/deciding
one, and not for newsletters — there's no form to check it on). It only
appears once at least one dispatch channel is actually turned on;
with GroupMe and Email (Sending) both off, there's nothing for it to
reach, so it isn't offered at all rather than doing nothing silently.

Checking it and saving sends that item immediately — to GroupMe, to
admins, and to confirmed public subscribers, whichever of those your
church currently has turned on — without waiting for anyone's schedule.
It only emails people who have chosen to get email (a staff login has to
pick a schedule under My account first; a new login has not, so on a new
install no staff are emailed until they do; they still see it in the app
and in chat). You'll see a confirmation naming the real number of admins
and public subscribers about to be emailed before it actually sends.

What it doesn't bypass: a restricted partner's item still waits on
review exactly as it would without the checkbox (see [Reviewing a
restricted partner's request or need](#updates-to-share) above),
and a muted GroupMe content type still blocks that one channel — urgent
only skips waiting for a schedule, never either of those safety rules.

An urgent item that was held for review goes out the moment someone approves it in [Updates to Share](#updates-to-share), instead of waiting for the next scheduled send. Editing its wording afterwards does not send it again.

**Review and approve now.** For a restricted partner specifically, a
second checkbox appears alongside "Mark as urgent": **Review and
approve now**. Checking it confirms, right then, that the text you just
typed is safe to send out exactly as written — the same confirmation
[Updates to Share](#updates-to-share)'s own **Approve** does,
just at creation time instead of a second visit later. It clears the
review hold; it doesn't by itself make anything send immediately — that
still needs "Mark as urgent" too, or whatever channel's own regular
schedule picks the item up next.

### Sending Updates (Admin only)

The **Sending Updates** page under Settings → Communications
holds every schedule, the chat channels' (GroupMe and WhatsApp) shared
content-type mutes, the one restricted-partner safety gate, and the
email dispatch's own appearance —
separate from the actual queue above, same split Email already has
between its own settings page and Emails to Sort. Top to bottom:

#### Who gets update emails

A read-only section at the top of the page (only shown once [Public
prayer digest](ADMIN_GUIDE.md#feature-toggles) is turned on) showing
how many admins are subscribed to the digest from their Account
Settings, how many public visitors have confirmed their subscription,
and how many are still waiting on their confirmation email. Counts
only — no email addresses, here or anywhere else an admin can see.

#### Restricted Partners

One checkbox, off by default: turned on, a restricted-access partner's
prayer requests and one-time needs are recorded and can reach GroupMe,
WhatsApp, and both email digests, subject to the review requirement described in
[Updates to Share](#updates-to-share) above. Left off (the
default), their events are never recorded in the first place, for any
type — nothing to hold, nothing to review, because nothing's queued.
Turning it on takes on that review responsibility in exchange for
restricted partners' content reaching every channel like anyone else's.

![The Sending Updates page: subscriber counts, the Restricted Partners gate, digest customization, email schedule, and the GroupMe/WhatsApp chat schedule](docs/assets/screenshots/dispatch-settings.png)

#### How the update email looks

Everything here controls the **email digest specifically** — GroupMe
and WhatsApp's own message format doesn't change, since both are
plain text and have no layout/subject/signature of their own to
customize:

- **Layout** — **Classic** (plain text-only partner cards) or
  **Snapshot** (adds each partner's photo — or a generic silhouette if
  they don't have one, or if they're restricted-access — field, how long
  the church has supported them, and a short overview above their
  items). Classic is the default; switching to Snapshot doesn't change
  what's masked for a restricted partner, only how the rest of the card
  looks.
- **Subject line** — leave blank for the default
  (`{date} {church} - {term} Updates`), or write your own using any of
  `{church}`, `{month}`, `{year}`, `{date}`, `{cadence}`
  (Biweekly/Monthly/Quarterly), `{name}` (the recipient's own name), and
  `{term}` (the Partner Terminology set on
  [Branding](#church-settings-admin-only)).
- **Signature** — an optional closing line (a verse, "Questions? Contact
  us," etc.) shown above the unsubscribe link.

Below are the same batch of items from the Snapshot example rendered as
both an actual email, Classic on the left and Snapshot on the right, so
you can see exactly what changes between the two before picking one.

| Classic                                                                                     | Snapshot                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ![An example Classic-layout digest email](docs/assets/screenshots/digest-email-classic.png) | ![An example Snapshot-layout digest email, including a restricted partner's masked card](docs/assets/screenshots/digest-email-snapshot.png) |

The layout choice above is shared by both audiences, but what each one
actually _receives_ isn't — a public subscriber's email only ever
includes prayer requests, with no source link and no one-time-need
amount, regardless of layout. See [ADMIN_GUIDE.md § Dispatch:
GroupMe, the admin digest, and the public
digest](ADMIN_GUIDE.md#dispatch-groupme-the-admin-digest-and-the-public-digest)
for a side-by-side example of the same batch of events rendered for
each audience.

#### Email Schedule

The one shared schedule for both the admin digest and the public
digest — each admin picks their own cadence on their own [Account
Settings](#your-account-settings) page, and each public subscriber
picks theirs when they follow a partner or use the Subscribe page (see
[§ The public site](#the-public-site)); this is what actually makes
either cadence send. Set a day of week (biweekly), a day of month
1–28 (monthly and quarterly share this field), and a time shared by
all three — each tier only fires once its own day/time is set; leaving
all three unset (the default) means nobody's individual cadence choice
ever actually sends, regardless of what they picked for themselves.

This section also has a checkbox for each of the three tiers, deciding
whether it's even offered on the two cadence pickers above (biweekly
starts off, monthly and quarterly start on). Unchecking one moves
anyone currently on it to the first tier still checked, in order
Monthly, Quarterly, Biweekly — immediately, not reversibly; re-checking
the tier later doesn't move anyone back. At least one tier has to stay
checked.

#### Chat channels (GroupMe & WhatsApp)

One shared daily-hour field and three shared mutes, used by whichever
chat channel(s) are on (see [GroupMe dispatch](#groupme-dispatch-admin-only)
and [WhatsApp dispatch](#whatsapp-dispatch-admin-only) above for each
channel's own connection setup, on its own page):

- **Time** — a single daily hour. GroupMe and WhatsApp are both
  near-real-time chat channels, not a periodic email, so there's no
  weekly/monthly tier here — whatever's queued for either one gets
  packed into as few messages as fit and posted once a day, at
  whichever hour you set. One field, shared by both — there's no way
  to give them different hours.
- **Mute Prayer Requests / One-Time Needs / Newsletters** — three
  independent checkboxes, shared by GroupMe and WhatsApp. Muting one
  just stops _that type_ from posting to either chat channel; it never
  affects whether that type gets recorded at all, so the email digest
  and the restricted-partner review queue are completely unaffected by
  any of these three.

### Email (Admin only)

One **Email** page under Settings, with two independent
halves — **Sending** and **Receiving** — each with its own on/off switch.
Both go through [Postmark](https://postmarkapp.com), a dedicated email
delivery service, not through this church's own Gmail or Microsoft
account. See
[ADMIN_GUIDE.md § Email (Postmark)](ADMIN_GUIDE.md#email-postmark) for
why. Turn on just the one you actually use — a church that only wants
the digest doesn't need Receiving on, and vice versa.

![The Email settings page, Sending and Receiving both configured](docs/assets/screenshots/email-settings.png)

#### Sending

Once turned on, this is the email half of the
[Updates to Share](#updates-to-share) queue above — an
opted-in user gets one digest email covering everything currently
queued, instead of one email per item. Setup builds up in steps:

1. Create a free account at [postmarkapp.com](https://postmarkapp.com),
   verify a sending domain there (adds SPF/DKIM records to that domain's
   DNS — a one-time step with whoever manages it), then copy the
   **Server API Token** from your server's API Tokens tab.
2. **Server API Token** — paste it below. Write-only once saved, same as
   a password field; leave it blank on a later save to keep the existing
   one.
3. **From Address** — the address recipients see mail arrive from, e.g.
   `updates@yourchurch.org` — must be on the domain verified in step 1.
4. **Send Test Email** — sends a real email to your own account address,
   confirming it actually works before anything depends on it.

To check the connection itself works before setting up a real domain,
paste the literal text `POSTMARK_API_TEST` as the Server API Token (no
Postmark account needed at all) and any address as From Address, then
**Send Test Email** — Postmark accepts and validates the request without
actually delivering anything or requiring a verified domain, confirming
the settings/token/API call path works. Swap in a real token once you
have a verified domain to actually receive mail.

Each user decides for themselves whether they get the digest, on
what cadence, and for which partners — there's no admin-managed
recipient list. Set it up from
[Your account settings](#your-account-settings); every digest also
carries its own one-click unsubscribe link, which turns it back off
without needing to log in.

This is also what Sending powers for the public **Subscribe** page — see
[§ The public site](#the-public-site) below — once [Public prayer
digest](ADMIN_GUIDE.md#feature-toggles) is turned on.

#### Receiving

Lets a missionary or organization email an update straight into the app
instead of you having to download and upload it yourself. Point partners
to a dedicated inbox address (never the church's own real inbox — see
[ADMIN_GUIDE.md § Email (Postmark)](ADMIN_GUIDE.md#email-postmark) for
the webhook setup itself, which is a one-time admin/infra step). When an
email arrives:

- If the sender's address matches **exactly one** partner — either that
  organization's own Contact Email, or any household adult's email on a
  missionary's record — it waits in **Emails to Sort** for a quick look
  (a sender address can be forged, so nothing is filed or announced on its
  own). An admin or editor assigns it to that partner as a **Newsletter**
  (title = the email's subject, the original `.eml` as the file), and it
  then notifies the same way a manually-uploaded newsletter does
  (GroupMe/email digest, if those are on; [AI Features](#ai-features-admin-only)
  can scan it the same as any other newsletter). Nothing in the queue is ever deleted
  automatically; only an admin can discard a message. (An admin can switch
  the review off for a sender that matches one partner and passes the sender
  check: **Settings → Email → Receiving → File mail from a verified partner
  without review**. It is off by default.)
- If the sender's address matches **no partner, or more than one** (two
  partners happen to share a household-adult email, for instance),
  there's no safe guess to make — it lands in the **Emails to Sort**
  queue instead, visible to any logged-in role.

**Emails to Sort** (its own nav item, next to Partners) lists what's
waiting: From, Subject, Received. **View raw** opens the original email.
**Assign** (editor or admin) picks the right partner _and_ what kind of
file it actually is — Newsletter, Survey Response, Signed Policy, Email
Communication, Office Document, or Other (with your own label) — the same
choices as uploading any other file on a partner's own page, defaulting to
Newsletter since that's what most inbound mail turns out to be. **Discard**
(admin only) removes it permanently with a confirmation prompt — for spam
or anything that was never meant to be filed at all.

If [Trips](#trips) is on, **Assign** has a second mode: switch "Assign
to" from Partner to **Trip participant** to file the email straight
into that participant's own trip record instead — pick the
participant (grouped by trip) and, if it fulfills one, which document
requirement. Useful for a signed waiver or passport photo that arrives
by email rather than through the participant's own self-service page.

![The Emails to Sort queue, waiting on review](docs/assets/screenshots/unmatched-emails.png)

![The Emails to Sort queue, waiting on review](docs/assets/screenshots/unmatched-emails.png)

## Integrations

### Joshua Project (Admin only)

Shows country-level unreached-people-group statistics — population,
primary religion, percent evangelical, how reached the country is — on a
partner's page, pulled live from the [Joshua
Project](https://joshuaproject.net/). Off by default.

Setup, on the **Joshua Project** page under Settings, is one
step: paste an API key from
[joshuaproject.net/api/request](https://joshuaproject.net/api/request)
(free) and **Save API Key** — write-only once saved, same as a password
field; leave it blank on a later save to keep the existing one.

![The Joshua Project settings page, with an API key saved](docs/assets/screenshots/joshua-project-settings.png)

A key alone doesn't show anything — turn on **Joshua Project stats** in
[Enabled Features](ADMIN_GUIDE.md#feature-toggles). Once both are done,
it shows up everywhere it always has: a partner's admin page and public
page, wherever a Country Code is on file.

### AI Features (Admin only)

Adds a **Scan for requests** button on each newsletter/document that's
PDF, JPEG, PNG, or `.eml` (Word/Excel aren't supported). Sends that one
file to Claude (Anthropic's API) to look for prayer requests and
one-time financial needs, then shows them for review — nothing is added
until you explicitly accept a suggestion. Off by default, even once
configured, since it's the one feature here that sends data to a third
party.

Each suggestion's text box starts with a short background sentence
(resolving things like "the teenager we mentioned" to who that actually
is) ahead of the request itself, so you're editing one readable block
rather than a bare, context-free sentence — edit it freely before
accepting. Once accepted, the request or need shows a "From: ..." link
back to the newsletter or document it came from, visible only here in
the admin view.

![Scan results, with each suggestion's background sentence joined ahead of the verbatim request](docs/assets/screenshots/ai-scan-results.png)

That source link is set automatically here — accepting a suggestion sets
it for you. The same link can also be set by hand, whether or not this
feature is turned on, via the **Source** dropdown on each request/need's
Add or Edit form — see [Prayer Requests](#prayer-requests) and
[Financial support & one-time needs](#financial-support--one-time-needs).

Setup, on the **AI Features** page under Settings, is
one step: paste an API key from
[console.anthropic.com](https://console.anthropic.com/settings/keys) and
**Save API Key** — write-only once saved, same as a password field;
leave it blank on a later save to keep the existing one. Usage is
pay-per-scan on the key owner's Anthropic account — a few cents/month at
typical volume, not a flat fee.

![The AI Features settings page, with an API key saved](docs/assets/screenshots/ai-extraction-settings.png)

A key alone doesn't turn anything on — turn on **AI Features**
in [Enabled Features](ADMIN_GUIDE.md#feature-toggles) to actually show
the Scan for requests button.

## Your account & the public site

### Your account settings

**My Account** is where you manage your own login, for every role. You
can change your password (current password required) and enable/disable
two-factor authentication — enabling walks you through scanning a QR code
and confirming a code; disabling requires your current password. (A Guest
sees just password and two-factor authentication here. When your church
requires two-factor for everyone, nobody, whatever their role, can turn it
off here, and the page says so. If you lose your authenticator app, an
admin resets it from Manage Users and you set it up again at next
sign-in.)

**Passkeys** sit below it. A passkey is your device's fingerprint, face or
screen lock (or a security key) used as the second step at sign-in, so there
is no code to type. Add one on each device you use (**Add a passkey**, up to
five, each with a name you choose): a lost phone is then one of several, not
the only way in. It shows when each was added and last used, and **Remove**
asks for your password. If you have no password (you set up with a passkey
only), it asks you to confirm with a passkey you still have instead: your
device asks for your fingerprint, face or screen lock, so you can remove a
lost phone's passkey from your laptop. (If you have lost every passkey, use
**Email me a new link** on the sign-in page, or ask an admin to reset your
sign-in.) If your church requires two-factor, you can't remove
your last way of signing in; add another first. A passkey only works on the
address your church's site is served from. An admin's **Reset MFA** clears
your passkeys along with your authenticator app.

![My Account: two-factor enabled with passkeys, and the list of passkeys](docs/assets/screenshots/my-account-passkeys.png)

If [Email (Sending)](#email-admin-only) is turned on for the church,
there's also an **Email updates** section here: a cadence (no
automatic digest by default, or one of whichever of biweekly, monthly,
and quarterly the admin has chosen to offer — see [Sending Updates](#sending-updates-admin-only)) and, once a cadence is
picked, a choice of what it covers: **the partners you look after** (the
default: your care team seats, plus, if you're on the missions team, the
partners that have no care team of their own), **all partners**, or **only
the ones you check** from a list. A church member added as a **Guest** on a
care team can have the digest too, but only for the partners they hold a seat
on, with no other choice. When an admin adds you to the missions team and the
church has set a default digest (Settings → Partner Care), you start on it
automatically and can change or stop it here. If you'd already picked a cadence before the admin turned it
off, it stays selectable for you specifically — you're never silently
switched to something else. The digest itself
still includes prayer requests, one-time needs, and newsletters, same
as before — picking a cadence and scope here doesn't narrow what you
get, just when and for whom. It sends on whatever [Email
Schedule](#sending-updates-admin-only) the admin set up at Site
Administration → Sending Updates. You can also turn it off directly from
the unsubscribe link in any digest email, without logging in. Besides
your chosen cadence, you may occasionally get an item right away
outside that schedule — see [Marking something
urgent](#marking-something-urgent).

![Account settings, Email updates: a biweekly cadence picked, with the specific-partners scope list expanded](docs/assets/screenshots/account-settings-digest.png)

![Account settings, mid-enrollment: the QR code step of enabling two-factor authentication](docs/assets/screenshots/mfa-enrollment.png)

### The public site

Worth understanding what visitors actually see, since it's driven
entirely by what you check in the admin dashboard:

- **Partner Directory** (`/`) — a searchable, filterable grid (same
  continent/country/type filters as the admin Partners list) of everyone
  with `isPublic` checked. Search also matches the same way (diacritic-
  insensitive, multi-word) across name, field/region, focus area, short
  overview, country, and — unlike the admin Partners list — sending
  church/org name.

  ![The public partner directory, with search and photo cards](docs/assets/screenshots/public-directory.jpg)

- **Map** (`/map`) — the same partners plotted on an interactive Leaflet
  map. Restricted partners show at country-level precision only, if they
  show at all — see
  [Understanding restricted-access partners](#understanding-restricted-access-partners).
  Organizations aren't part of the auto-tour cycle described below, but
  their pins are still clickable any time.

  ![The public map, with partner pins and a sidebar list](docs/assets/screenshots/public-map.jpg)

- **Partner detail page** — the fuller write-up linked from both the
  directory and the map, masked the same way for restricted partners. If
  the Joshua Project stats feature is turned on (see
  [ADMIN_GUIDE.md § Feature toggles](ADMIN_GUIDE.md#feature-toggles)), a
  **Show Country Statistics** button (visible whenever the partner has a
  Country Code set) fetches live population, primary religion, percent
  evangelical, and how reached that country is, straight from the
  [Joshua Project](https://joshuaproject.net/) — the same lookup the
  [Serving Location](#editing-a-partner) field offers on the
  admin side, here for visitors.

  ![A public partner profile, with the per-partner "follow this partner" subscribe form and Joshua Project country statistics expanded](docs/assets/screenshots/public-partner-detail.png)

- **Subscribe** (`/subscribe`) — only shown once an admin turns on
  [Public prayer digest](ADMIN_GUIDE.md#feature-toggles). A dedicated page
  for getting prayer-request updates by email: no login, just an email
  address, a cadence choice (whichever of biweekly, monthly, and
  quarterly an admin has chosen to offer, pre-selected to monthly when
  it's available), and either every partner or several specific ones
  picked from a checklist. A visitor clicks a
  link in a confirmation email, then presses **Confirm my subscription** on
  the page it opens, before anything actually sends (double opt-in — nothing
  goes out to an address nobody confirmed, and a mail program that merely
  opens the link does not confirm it), and every
  digest they get after that carries its own one-click unsubscribe
  link. Those confirm and unsubscribe links keep working even if you
  later turn the public digest or the public directory off. This public digest is **prayer requests only** — never a
  one-time need, never a newsletter or a link back to one — unlike the
  digest an admin can opt into from their own [Account
  Settings](#your-account-settings), which still includes both. A
  matching, smaller "Follow this partner's prayer requests" form sits on
  each partner's own detail page, for subscribing to just that one
  partner instead of everyone — it also points back to this page, and,
  when that partner has their own newsletter signup link, makes clear
  this is separate from (not a replacement for) subscribing to the
  partner's own newsletter directly. Either form's email only ever goes
  toward sending these updates — see the form's own privacy line for
  the exact wording, including the same occasional-urgent-item
  disclosure [Marking something urgent](#marking-something-urgent)
  describes.

  ![The public Subscribe page, with the all-partners/specific-partners picker](docs/assets/screenshots/subscribe-page.png)

#### The public map's auto-tour

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

Nothing on the public site is editable — it's a read-only mirror of
whatever's marked public in the admin dashboard.

## Template packs

The app ships no church-specific content in its code. Starting points (survey questions, a support menu, trip requirement documents, trip application questions, email update wording) are **template packs**: small JSON files you import from the page where that content lives. Example packs are in the project's [`examples/template-packs`](https://github.com/neckermann/missions-partner-tracker/tree/main/examples/template-packs) folder, and the public demo imports them so it shows everything.

- **Import** (admins): open the page, press **Import…**, choose the file or paste its text, **Check this pack** to see what it would do, then **Import**. Importing only adds: nothing you have is deleted, a duplicate (same name) is skipped, and importing the same pack twice does nothing the second time. A survey arrives as a draft. Email update wording is the one exception: it replaces the subject line, sign-off and layout the pack contains, and the preview says so.
- **Where:** surveys under **Settings → Surveys**, the support menu under **Settings → Support Preferences**, trip requirements and application questions under **Settings → Trips**, wording under **Settings → Sending Updates**.
- **Export:** each of those pages has an **Export** button that saves what you have as a pack, so a church can share its own.
- **A new install starts empty** in each of these areas, with a prompt to import an example or start blank. Existing installs keep everything they have.
