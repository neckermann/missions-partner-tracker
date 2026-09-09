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

Nothing yet.

## [1.6.0] - 2026-09-09

Newsletters and Documents now have a real "Edit" option too (both the
top-level page and the embedded section on a partner's detail page) --
everything but the uploaded file itself is editable, including moving a
misfiled newsletter/document to a different missionary or organization
(top-level pages only; the embedded section stays scoped to the partner
you're already viewing) and, for documents, changing the category. Also
fixes a stale doc comment left behind by the 1.4.0 prayer request category
rename, and a Playwright e2e test that still selected the old "Long-term"
option label.

## [1.5.0] - 2026-09-09

Prayer Requests and One-Time Needs now have a real "Edit" option (fix a
typo, correct an amount, change the category) on both the top-level page
and the embedded section on a partner's own detail page -- previously
the only way to change one after the fact was delete and re-add. Doesn't
touch the answer/decision workflow, which keeps its own dedicated flow.

## [1.4.0] - 2026-09-09

Prayer request categories renamed from short-term/long-term (a time
horizon) to Strategic/Situational (what the request actually is -- tied
to the ministry's long-term vision, or whatever came up). A migration
renames existing category values automatically (long_term -> strategic,
short_term -> situational). Strategic + public requests can now be
independently marked "Include in printed booklet" (a request can be
public-site-only), and the Booklet page caps how many print per partner
(default 4, adjustable) so a partner with a long history doesn't crowd
out the rest of their page. The scheduled demo reset's about text now
points to the GitHub repo for full app/usage docs.

## [1.3.2] - 2026-09-09

Fixed: the "Site Administration" sidebar toggle rendered as a plain
browser button (boxed, wrong colors) instead of matching the rest of the
sidebar -- the dark-sidebar CSS reset only covered footer buttons, not
nav ones.

## [1.3.1] - 2026-09-09

Site Administration is now an expandable group in the admin sidebar itself
(Manage Users, Branding, Enabled Features, Single Sign-On, About Church),
not a separate page with its own tab bar. Partner terminology moved from
About Church into Branding. The scheduled demo reset now explicitly turns
every feature on (including AI request scanning, off by default) instead
of leaving some toggled off after the schema gets rebuilt from scratch.

## [1.3.0] - 2026-09-09

Five more feature toggles (Prayer Requests, One-Time Needs, Monthly
Support, Mission Trips, Print Booklet), grouped into Public vs. Admin
sections in Church Settings > Features. Church Settings itself is now a
proper admin sub-section with its own tab nav (General, Branding,
Features, Single Sign-On, Users) instead of one long page — User
Management moved here from its own top-level nav entry. Every checkbox in
the admin app now renders as a pill toggle, restyled directly via CSS
(no markup changes). Seed data now weaves prayer requests and one-time
needs into a fraction of generated newsletters/documents, so a fresh seed
or demo reset always has something real for AI request scanning to find.

## [1.2.1] - 2026-09-09

Fixed: "Scan for requests" was missing from the standalone Newsletters and
Documents admin pages -- it only showed up on the embedded sections of an
individual missionary/organization's detail page.

## [1.2.0] - 2026-09-09

The "Public site" feature toggle is now two independent toggles, Public
directory and Public map -- a church can run either one alone, both, or
neither (the partner-detail page stays reachable as long as at least one
is on). Church Settings > Features also now renders as pill toggle
switches instead of checkboxes.

## [1.1.1] - 2026-09-09

AI request scanning now reads `.eml` files too, not just PDF/JPEG/PNG --
it's just structured text (headers + a text/html body), so this parses it
directly and sends the body as text rather than treating it like an
opaque binary format the way Word/Excel are.

## [1.1.0] - 2026-09-09

Per-church feature toggles (Admin → Church Settings → Features) — turn off
Newsletters, Documents, or the public site if a church isn't using them,
enforced server-side, not just hidden in the UI. First feature built on
top of that system: optional AI request scanning, which reads an uploaded
newsletter or email document (PDF, JPEG, or PNG) with Claude and suggests
prayer requests and one-time financial needs for review — nothing is
added without an explicit accept. Off by default, and only available at
all once `ANTHROPIC_API_KEY` is configured, since it's the one feature
here that sends file content to a third party.

## [1.0.0] - 2026-09-08

Initial release. This project went through an extended build-and-test
phase — dependency upgrades, a Prisma major-version migration, moving
file storage (photos, newsletters, documents) directly into Postgres
instead of a separate object store, and a one-click deployment path on
[Render](https://render.com) (the simplest option, though not the only
one — see [ADMIN_GUIDE.md § Deploying anywhere else](ADMIN_GUIDE.md#deploying-anywhere-else))
with a browser-based first-run setup flow, no shell or database access
needed to create the first admin account. None of that iteration
reflects a real deployment anyone depends on yet, so versioning starts
fresh here rather than carrying forward a long list of internal
milestones.
