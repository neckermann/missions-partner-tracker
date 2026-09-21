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

## [1.0.0] - 2026-09-21

First release.

A missions partner tracker for a single church: who you support, where
they are, what they need prayer for, and what you've given — with a
public-facing directory and map that deliberately shows less than the
admin side does.

What's in it:

- **Partners.** Missionaries and organizations are one record type
  distinguished by `kind`, so everything downstream — trips, support,
  prayer requests, newsletters, documents — attaches the same way for
  both. A partner's page is also its editor: each section saves only its
  own fields, so changing one thing can't quietly overwrite another.
- **A public site that protects people.** Partners marked
  restricted-access appear with their name masked to initials, a
  silhouette instead of a photograph, and a map pin coarsened to a country
  centroid. Every public response goes through one masking serializer that
  no public route can bypass, tested in isolation.
- **Prayer requests, monthly support, one-time needs, trips,
  newsletters and documents**, each with its own page and its own section
  on a partner's page.
- **A printable booklet** that lays out every partner for handing round on
  paper.
- **Per-church feature toggles.** Turn off anything a church doesn't use;
  the toggle is enforced on the server, not just hidden in the UI.
- **Optional AI request scanning.** Point it at an uploaded newsletter and
  it suggests prayer requests and financial needs for review — nothing is
  added without an explicit accept. Off by default, and only available at
  all once `ANTHROPIC_API_KEY` is set, since it's the one feature that
  sends file content to a third party.
- **Accounts with optional two-factor.** Email and password, with TOTP
  that an admin can require per account.
- **One-click deployment on [Render](https://render.com)** with a
  browser-based first-run setup, so standing up an instance needs no shell
  or database access.

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
