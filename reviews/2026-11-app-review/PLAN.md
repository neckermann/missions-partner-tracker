# Plan: acting on the November 2026 review

**Written:** 2026-11-26, from `README.md` and a spot-check of the code. Nothing here has been started.

## 1. Review of the review

I re-checked the claims the plan depends on most, against the current branch:

| Finding | Re-check | Result |
|---|---|---|
| A2 new partners public | `AdminPartnerForm.jsx:32` | Confirmed: `isPublic: true` in the form's initial state |
| A6 backup restore | `backup.js:94, 148-156` | Confirmed: `surveyUpload` is in the model list, absent from `BYTES_FIELDS` |
| A3 setup race | `routes/auth.js:114-140` | Confirmed: `user.count()` then `user.create()`, no transaction or lock. The comment above it ("only ever succeeds once") is false |
| A7 worker secrets | `render.yaml:120-142` | Confirmed: worker has its own generated `SESSION_SECRET`, with a comment saying it never signs anything; `FIELD_ENCRYPTION_KEY` is `sync: false` |
| B9 proxy hops | `server.js:77` | Confirmed: `trust proxy` fixed at 1 |
| A5 | `SPEC.md § 8.3` | The spec says a mismatched deploy "fails safely" at `preDeployCommand`; the review says it succeeds silently. Not re-run, but SPEC and RUNBOOK disagree with each other, so the docs need fixing either way |

Not re-run: A1 (needs the live demo, which is off limits and not mine to touch), A5's reproduction, A7 on a real Render deploy, A8, A10. These stay "believed".

**Where I would adjust the review:**

1. **The ranking is right on safety but A5 is mis-sequenced.** Every schema-touching item (A7's heartbeat, B13's passage setting, possibly A4 and B3) is cheaper *before* the baseline freezes, because pre-1.0 they are edited into the one migration. After the freeze each needs a real migration. So the freeze decision (A5) should be made first, even though its code work comes later.
2. **A3 and the small half of A9 and A10 touch the same code** (`auth.js` setup route, first-admin creation, 2FA enrolment). One PR, not three.
3. **A1's urgent step is not code.** Removing credentials from the demo's environment is a Render dashboard action. `AGENTS.md` lists it as permitted, but also warns the tooling may refuse it. It needs the owner, today, and I cannot verify the result.
4. **A4 is two things:** a small move of two settings (do it) and two design decisions (owner's call). Only the move is plannable now.
5. **A8's choice decides how much of A7 and docs work is wasted.** If the owner picks "hosted for non-technical churches", the install-path polish shrinks.
6. **The review leaves out an owner-side question:** it says "no church has real data yet". Everything in wave 2 assumes that is true. Please confirm.

## 2. Decisions needed from the owner (these gate work)

| # | Decision | Blocks | My recommendation |
|---|---|---|---|
| D1 | Freeze the migration baseline at which release? | A5, and the timing of every schema change | Freeze at the next beta after wave 1 and 2 land, so their schema changes squash in once |
| D2 | Should the public directory and map start switched off on a new install? | A2 | Yes, offer them in first-run setup |
| D3 | Restricted partners: no initials and continent-level only by default? | A4 | Yes, church opts in to more |
| D4 | Care-team guests: make visibility and restricted status staff-only, or hold changes for approval? | A4 | Staff-only; simplest and fails safe |
| D5 | Install route: default names, web-editor steps, or "use hosted" | A8, A7 docs | Default names in the Blueprint; it removes the terminal step and costs nothing |
| D6 | Remove WhatsApp, Viewer role, "Trips departing soon" alert? | B4, C2, C3 | Decide later; not blocking |
| D7 | Confirm no church has real data yet | A5 | Needed before wave 2 |

### Answers (2026-11-26)

| # | Answer | Effect on the plan |
|---|---|---|
| D1 | Keep squashing until 1.0 | A5 shrinks: no freeze, `CLAUDE.md` and `CONTRIBUTING.md` rules stay. Remaining A5 work: start-up/health-check refusal on a mismatched database, correct SPEC § 8.3 and UPGRADING.md, and a plain "installs made today must be wiped on upgrade" warning in README, UPGRADING.md and the marketing page. Schema changes can go in any wave (edited into the baseline) |
| D2 | Public directory and map off on a new install, offered in first-run setup | A2 grows: change the defaults, and add the choice to setup |
| D3 | Keep current behavior (initials, country, region) | A4 only moves the two settings to a page that always exists. No default change |
| D4 | Guests cannot change visibility or restricted status | A4 gains a backend check plus UI hidden for guests, with tests |
| D5 | Blueprint default names | A8: drop the `name-instance` step, add a Deploy to Render button, list true requirements and cost |
| D7 | No church has real data yet | Confirmed; wipe-on-upgrade is acceptable for now |

Still open: D6 (WhatsApp, Viewer role, "Trips departing soon" alert), not blocking.

## 3. Waves

Each work item is one branch off `dev` and one PR into `dev` (per `CONTRIBUTING.md § Feature branches`), with tests. Sizes are the review's. Nothing goes to `main` without the owner's usual `dev` check on dev-test.

### Wave 0: today, owner only

- **A1 stop-gap.** Remove or revoke the real GroupMe, Postmark and Anthropic values in the demo environment, then reset. No code.
- File issues for A1 to A10 once the owner approves the text in `README.md` (the review deliberately filed none). A9 is covered by #477.

### Wave 1: safe defaults and small, independent fixes (about 1.5 weeks)

These do not depend on any decision except D2 to D4 for the optional parts, and none changes the schema, so they can run in parallel.

| Item | Work | Notes |
|---|---|---|
| A1 code | Demo-mode guards on urgent dispatch, chat posts, hand-triggered email, AI scan, password and email change on published accounts, integration settings | `demoMode.js` already exists and is used in six places; extend it. Test: with `DEMO_RESET_TOKEN` set, nothing reaches Postmark, GroupMe, WhatsApp or Anthropic |
| A2 | Form opens with "Show on public site" unticked; plain-language line; visible status after save | Test: all defaults means not returned by `/api/public/partners`. D2 is a follow-up |
| A6 | Add `surveyUpload` to `BYTES_FIELDS`; round-trip test that fills every table including every binary column | Also review the version guard, which compares migration names |
| B1 | Stamp only rows that reached a recipient | Small, high value, isolated |
| B9 | Configurable proxy hop count and a per-account sign-in limit | |
| B12, B13 | Seed fixes. B13 is a schema change, so hold it for wave 2 | |

### Wave 2: install, first run and the schema (about 3 weeks)

Do in this order:

1. **A3 + A9's small piece + A10** (one PR): atomic first-admin creation, setup code, `/` redirects to `/setup` or shows an empty state, first admin joins the missions team, contact log and key-date reminders on by default, recovery codes, documented clear-2FA command, `FIELD_ENCRYPTION_KEY` required at start-up.
2. **A7** (including the heartbeat table): worker shares the web service's secrets, last-seen record, admin warning, true cost in every place. Heartbeat is a schema change, so it goes in before the freeze.
3. **A4 move** (and D3, D4 once decided): move the two settings to a page that always exists. Also B13's setting if wanted.
4. **A5 (reduced, per D1)**: start-up mismatch check so a bad upgrade never goes live, fix SPEC § 8.3 and the UPGRADING.md "easy way", and add the wipe-on-upgrade warning to README, UPGRADING.md and the marketing page. No freeze, so the hard rules stay as they are.
5. **A8** per D5, plus the corrected requirements text.

### Wave 3: "fix soon" (B group), grouped

- **Docs pass (B14):** SPEC § 4/§ 5 numbering, the Care teams count, `APP_BASE_URL` as required, stale screenshots. Bundle with A8's doc changes.
- **#477 bundle:** B3, B4, B5, B11, B15 plus the rest of A9. Large; fold into the existing issue instead of creating new ones.
- **B2 and B6:** email "on but not ready" and backups without a command line. Medium each.
- **B7, B8, B10:** scheduling and email-receiving fixes, small each.

### Later (C group)

Not planned. C1, C2, C3 and C4 are decisions first.

## 4. Verification and safety

- Backend: `cd backend && npm test && npm run test:routes`; frontend: `npm run test:e2e`. Set `APP_BASE_URL` locally (B14 notes 15 route tests fail without it).
- Never force a notification schedule to fire against a configured environment (`WORKFLOW.md § Testing live sends`). Tests for A1, A7 and B1 should use stubs for the sending layer.
- Schema changes before the freeze use `prisma migrate dev`, squashed into the baseline, never hand-written. dev-test's database will need the documented reset after each.
- Anything on Render or a database reset needs a human in the loop (`AGENTS.md`); I will stop and ask.

## 5. Suggested next steps

1. Answer D1 to D5 and D7, or tell me to proceed with my recommendations.
2. Do Wave 0.
3. I start Wave 1 with A1 code, A2 and A6, which are the most self-contained.
