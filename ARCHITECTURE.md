# Architecture — where does a change go

**Last verified**: 2026-11-23 · **Owner**: @neckermann

This is an index, not a duplicate — [SPEC.md](SPEC.md) is the full,
authoritative architecture reference (data model, backend/frontend
structure, feature flags, auth model, the dispatch system,
deployment topology). This doc exists to answer "where does my change
belong" quickly, pointing into SPEC.md's sections rather than
restating them.

## Quick index: what kind of change, which section

| If you're... | Start at |
|---|---|
| Adding/changing a database field | [SPEC.md § 1](SPEC.md) (data model), then [CONTRIBUTING.md § Extending the data model](CONTRIBUTING.md#extending-the-data-model) and [§ Database migrations](CONTRIBUTING.md#database-migrations) |
| Adding a new API route | [SPEC.md § 2.2](SPEC.md) (route inventory) and § 2.1 (middleware stack — auth/feature-gate ordering) |
| Writing backend logic shared across routes | [SPEC.md § 2.3](SPEC.md) (utility layer) |
| Adding/changing an external integration (email, GroupMe, WhatsApp, Joshua Project, AI extraction) | [SPEC.md § 2.5](SPEC.md), and [RUNBOOK.md](RUNBOOK.md) for its env vars |
| Adding a new admin or public page | [SPEC.md § 3.1-3.2](SPEC.md) (routing, page inventory) |
| Reusing an existing UI pattern instead of writing a new one | [STYLE-GUIDE.md](STYLE-GUIDE.md), [SPEC.md § 3.3](SPEC.md) |
| Gating something behind a feature flag | [SPEC.md § 4](SPEC.md) — see "One rule this index exists to reinforce" below |
| Touching permissions/roles | [SPEC.md § 5](SPEC.md) |
| Touching dispatch (email/GroupMe/WhatsApp, review gate, urgent broadcast) | [SPEC.md § 6](SPEC.md) |
| Limiting what a guest (trip leader or care team member) can reach | [SPEC.md § 5.1-5.2](SPEC.md), then "Cross-cutting pieces" below |
| Recording who did something, or showing who last edited a record | [SPEC.md § 5.6](SPEC.md) (audit log), then "Cross-cutting pieces" below |
| Deciding what a restricted/non-public partner should ever expose | [SPEC.md § 7](SPEC.md) (public vs. admin surface boundary) |
| Touching deploy config, Render, or migrations in production | [SPEC.md § 8](SPEC.md), [RUNBOOK.md](RUNBOOK.md) |

## One rule this index exists to reinforce

A new feature is gated behind `requireFeature` on the backend (404
when off) **and** hidden from every nav/tile client-side — not just
admin-role-gated. The only exceptions are integrations whose own
setup flow requires configuring credentials before the toggle can mean
anything (GroupMe, Joshua Project, AI Extraction) — see
[SPEC.md § 4](SPEC.md) for the registry and
[CONTRIBUTING.md](CONTRIBUTING.md) for the upgrade-safety reasoning
behind gating at all.

## Cross-cutting pieces you will meet

Four mechanisms reach across many routes and models. Each lives in one
place on purpose: use it, don't re-derive it.

- **Guest reach and care teams** (`backend/src/utils/guestAccess.js`,
  `routes/careTeams.js`, `middleware/requireAuth.js`). A guest has no
  access from the role itself, only from grants: a `TripAccess` row (a
  trip leader) and/or a `CareTeamMember` seat (a care team member).
  `guestAccess.js` holds the single answer to "which partners and trips may
  this person read" (`resolveGuestReach`, `canReadPartner`, `canReadTrip`);
  a route asks it instead of checking `role` itself. Staff on a care team
  keep their full role and gain only the care-team features. Details:
  [SPEC.md § 5.1-5.2](SPEC.md).
- **Audit Log** (`utils/auditLog.js`, `middleware/auditSettings.js`,
  `utils/auditPruneScheduler.js`). `recordAudit` / `recordAuditSafe` write an
  event (who, what, which record, IP); settings changes are diffed and
  recorded by the settings middleware, with secrets stored as "changed",
  never their value. The scheduled jobs prune entries older than the retention
  setting every night. New sensitive actions add an entry to `AUDIT_ACTIONS`
  and call the helper. Details: [SPEC.md § 5.6](SPEC.md).
- **Last edited by** (the `lastEditedBy` Prisma extension in
  `prismaClient.js`, and `utils/lastUpdated.js`). Any model with the three
  `lastEditedById` / `lastEditedByName` / `lastEditedAt` columns is stamped
  automatically on every write made inside a signed-in request (the actor
  comes from `utils/actorContext.js`); the seed, the scheduled jobs and public forms
  stamp nothing. Only the row written directly is stamped, so a family
  member's edit stamps that row, not its partner. "Last updated" on a
  partner or trip is therefore read-time: `lastUpdated.js` runs one UNION
  over the record and its section tables, rather than the extension also
  writing the parent (a second write could block on a parent row the
  request's transaction already holds).
- **Sending church filter** (`utils/sendingChurch.js`). One `sendingChurch`
  query parameter works on every list about partners or things that belong
  to a partner; `withSendingChurch(where, value)` merges it onto a list's
  `where.partner`. A new such list takes the parameter and the shared
  `FilterBar` field rather than its own filter.

## Known rough edges

[SPEC.md § 9](SPEC.md) lists things noticed while documenting the
app that aren't bugs severe enough to block operation, but are worth
knowing before you touch adjacent code. Check it before assuming a
confusing-looking piece of code is accidental.
