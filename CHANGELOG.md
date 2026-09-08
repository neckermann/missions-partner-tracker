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
