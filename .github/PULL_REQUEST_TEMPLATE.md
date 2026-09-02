**What does this change and why?**


**Checklist**
- [ ] I read [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] Tests pass (`cd backend && npm test`), and I added/updated tests if this touches masking logic (`backend/src/utils/maskData.js`) or auth
- [ ] If this adds a new env var, I updated `backend/.env.example` (or `frontend/.env.example`) with a comment explaining it
- [ ] If this adds/changes a database field, I hand-wrote a migration under `backend/prisma/migrations/` matching the existing style, and updated `schema.prisma` to match
- [ ] If this is a breaking change (new required env var, required migration, changed API shape), I added an entry under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md)
- [ ] This doesn't hardcode anything specific to one church (name, colors, terminology) — that belongs in Church Settings or an env var, not application code, so forks stay easy to upgrade (see [UPGRADING.md](../UPGRADING.md))

**Does this affect deployment?**
(`.github/workflows/`, `backend/.platform/`, env vars needed in production) — call it out here since it's the hardest part of the repo to test outside a real deploy.
