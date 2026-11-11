# Architecture — where does a change go

**Last verified**: 2026-11-11 · **Owner**: @neckermann

This is an index, not a duplicate — [SPEC.md](../SPEC.md) is the full,
authoritative architecture reference (data model, backend/frontend
structure, feature flags, auth model, the notification system,
deployment topology). This doc exists to answer "where does my change
belong" quickly, pointing into SPEC.md's sections rather than
restating them.

## Quick index: what kind of change, which section

| If you're... | Start at |
|---|---|
| Adding/changing a database field | [SPEC.md § 1](../SPEC.md) (data model), then [CONTRIBUTING.md § Extending the data model](../CONTRIBUTING.md#extending-the-data-model) and [§ Database migrations](../CONTRIBUTING.md#database-migrations) |
| Adding a new API route | [SPEC.md § 2.2](../SPEC.md) (route inventory) and § 2.1 (middleware stack — auth/feature-gate ordering) |
| Writing backend logic shared across routes | [SPEC.md § 2.3](../SPEC.md) (utility layer) |
| Adding/changing an external integration (email, GroupMe, WhatsApp, Joshua Project, AI extraction) | [SPEC.md § 2.5](../SPEC.md), and [docs/RUNBOOK.md](RUNBOOK.md) for its env vars |
| Adding a new admin or public page | [SPEC.md § 3.1-3.2](../SPEC.md) (routing, page inventory) |
| Reusing an existing UI pattern instead of writing a new one | [docs/STYLE-GUIDE.md](STYLE-GUIDE.md), [SPEC.md § 3.3](../SPEC.md) |
| Gating something behind a feature flag | [SPEC.md § 4](../SPEC.md) — see "One rule this index exists to reinforce" below |
| Touching permissions/roles | [SPEC.md § 5](../SPEC.md) |
| Touching notifications (email/GroupMe/WhatsApp, review gate, urgent broadcast) | [SPEC.md § 6](../SPEC.md) |
| Deciding what a restricted/non-public partner should ever expose | [SPEC.md § 7](../SPEC.md) (public vs. admin surface boundary) |
| Touching deploy config, Render, or migrations in production | [SPEC.md § 8](../SPEC.md), [docs/RUNBOOK.md](RUNBOOK.md) |

## One rule this index exists to reinforce

A new feature is gated behind `requireFeature` on the backend (404
when off) **and** hidden from every nav/tile client-side — not just
admin-role-gated. The only exceptions are integrations whose own
setup flow requires configuring credentials before the toggle can mean
anything (GroupMe, Joshua Project, AI Extraction) — see
[SPEC.md § 4](../SPEC.md) for the registry and
[CONTRIBUTING.md](../CONTRIBUTING.md) for the upgrade-safety reasoning
behind gating at all.

## Known rough edges

[SPEC.md § 9](../SPEC.md) lists things noticed while documenting the
app that aren't bugs severe enough to block operation, but are worth
knowing before you touch adjacent code. Check it before assuming a
confusing-looking piece of code is accidental.
