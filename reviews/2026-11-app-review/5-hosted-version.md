# 5. Side quest: could this become a hosted service?
**Status: Checked by the lead reviewer, 2026-11-26.**

> **Lead check**
> - **Confirmed by the lead (read in the code):** 66 models in `backend/prisma/schema.prisma`, none with a church or tenant column; the single settings row is referenced in 59 files under `backend/src`; `User.email` is unique across the whole database; both the web process and the worker set the process-wide time zone from the church's setting at start-up.
> - **Wording to reconcile:** this note says "seven schedulers"; report 1 counts 8 timers started by 7 functions. Both are describing `backend/src/worker.js:42-48`.
> - **Not re-checked:** Render's prices, the WhatsApp lock, and the passkey hostname binding. The note's writer relied on the lead's description of issues #430 and #420 and did not read them.
**Reviewed:** branch `dev` at e713437 (0.1.0-beta.3), 2026-11-26.

A feasibility note to inform a decision, not a design. Pricing and billing are left out on purpose (#420). "Read" means read in the code at the file named; "inferred" means reasoned from that, not confirmed.

## Summary

A hosted version is feasible, but not as a quick pivot: the app is built for exactly one church per copy. **One copy per church** (Route A) needs almost no app change and moderate operator automation. **One shared app** (Route B) is a rewrite of the data layer and background jobs, with a new risk: one church seeing another's restricted partners. Either way, the blockers already found for self-hosters (G1, G2, S7, S8) come first, because the operator would be holding other people's real data. Hosting removes the install problem (U1), not the product problems.

## What the code says today

- **One church is assumed everywhere.** `ChurchSettings` is a single row with the fixed id "singleton" (read: `backend/prisma/schema.prisma:1214`). That id is looked up on 120 lines across 59 files (read: `grep -rn "singleton" backend/src`).
- **No table knows which church it belongs to.** There are 66 models and none has a church or tenant column (read: `schema.prisma`, searched for `churchId`/`tenantId`). A login's email is unique across the whole database, as is a public subscriber's (read: `schema.prisma:1508`, `:1837`).
- **The clock is set once per process.** Both programs copy the church's timezone into `process.env.TZ` at start-up and the schedulers rely on it (read: `backend/src/worker.js:26-39`, `backend/src/server.js:273-286`, `utils/emailDispatchScheduler.js:11`). One process cannot be in two timezones (G12 is the single-church symptom).
- **The worker is one church's worker.** It starts seven schedulers and one long-lived WhatsApp connection (read: `worker.js:42-58`), guarded by one database-wide lock (read: `utils/whatsappClient.js:23,101`). WhatsApp uses an unofficial client library, `baileys` 7.0.0-rc14 (read: `backend/package.json:30`; S18).
- **One key protects every stored secret.** GroupMe, Postmark, AI and WhatsApp credentials are encrypted with the single `FIELD_ENCRYPTION_KEY` environment variable (read: `utils/crypto.js:10-18`, `schema.prisma:1257-1322`, `:1863`).
- **Files live in the database** as bytes: photos, documents, raw emails (read: seven tables with `Bytes` columns in `schema.prisma`; `render.yaml:5-7`).
- **First visitor becomes admin.** `/setup` succeeds for anyone while there are no users (read: `routes/auth.js:93-121`; S7 reproduced a double claim).
- **Upgrades currently mean a reset.** One squashed migration is edited in place before 1.0 (read: SPEC.md § 8.3; G1 reproduced the silent failure).

## The two routes

| | **Route A: one hosted copy per church** | **Route B: one shared app** |
|---|---|---|
| Data model | No change. But the squash-and-reset convention must end first (G1). | A church column on nearly all 66 models; every query filtered by it; `singleton` replaced in 59 files; email uniqueness rethought. |
| Sign-in | No change in the app. The operator creates the first admin, or issues a one-time setup code, closing S7. | Must know which church before sign-in. Sign-up replaces `/setup`. One email cannot join two churches today. Passkeys are tied to the site's hostname (read: `utils/passkeys.js:29`). |
| Settings | No change. Optionally an operator-level default for email sending. | One settings row per church; timezone handled per church on every date calculation instead of per process. |
| Deploy | A script that creates web + worker + database per church, sets matching secrets (S10), and upgrades them all. | One web, one worker; every scheduler loops over churches; WhatsApp becomes many connections in one process, or is dropped. |
| Security posture | Churches are separated by construction: own database, own key. | Separation depends on every query being right. One key for all churches' secrets. Backup download (S14) and unbounded inbound email (S13) become shared-database problems. |
| Size | **Medium.** Mostly operator tooling; little app code. | **Large.** Touches most of the backend, and all 198 protected routes (count from report 2) need re-testing per church. |
| Effect on self-hosters | None. Same code; they also gain the G1/S7 fixes. | Every self-hoster runs multi-church code with one church in it, or the project splits into two codebases. |
| Cost to run | About $20 per church per month: web + database about $13, worker about $7 (read: `render.yaml:16-19`; G5). | Low per church; grows with stored files (inferred). |

**Hard rules.** Route A fits all three as they stand. Route B strains two. "Single origin, relative URLs" survives only if each church gets its own address (a subdomain) and the server picks the church from the hostname. "Schema changes only through `prisma migrate dev`" still holds, but a church column on 66 tables cannot be added by squash-and-reset once anyone has data. "Nothing church-specific hardcoded" is unaffected.

## What hosting would and would not fix for a church

**Goes away:** installing (U1); upgrading, which becomes the operator's job (U2, G1); the worker and its hand-copied key (G4, S10, U8); backups and restore (U7, G2, S14); the race to claim a new site (S7). Email setup (U6, C1, C2) goes away only if the operator provides a shared sending domain, a small change since the Postmark token is per church today (read: `schema.prisma:1322`).

**Stays as it is:** the setup chains and 45 switches (C1 to C15); partners public by default (F1, S8, C3); restricted partners' initials and country published (S9); the care loop off on day one (F2, U5); the weight of trips (F4). These are the product's shape, not its hosting.

## What the operator takes on

- **Other churches' sensitive data**: names, locations and letters of workers in restricted countries. A leak is now the operator's leak (inferred).
- **Abuse.** The demo findings show what strangers do with a shared instance: post to real chat groups (S1), send email under the owner's sender (S2), lock others out (S3), spend the AI key (S4), deface public pages (S5). A shared sending domain or AI key repeats S2 and S4 for every hosted church.
- **WhatsApp.** The operator would hold many churches' WhatsApp sessions through an unofficial client (S18); bans or terms disputes land on the operator (inferred).
- **Uptime, support and restores** (the backup fails to restore today, G2), plus **legal and privacy duties** for holding others' personal data (inferred; not legal advice).

## If I had to choose (a decision for the owner)

Do not pivot now. If a hosted offer is wanted, choose **Route A as a small hand-run pilot** for two or three churches. The main reason: each church's restricted partners stay in a separate database with a separate key and self-hosters are untouched, while Route B bets the most sensitive data on a large rewrite. First steps:

1. End the squash-and-reset convention and make a backup restore cleanly (G1, G2). Nothing hosted is safe before this.
2. Close the first-visitor claim and make new partners private by default (S7, S8).
3. Set up one church by hand as in Route A, write down every step, then script it. Decide whether WhatsApp is offered at all on hosted copies.

## What I couldn't check, and why

I did not run the app or deploy anything, so every size estimate is a judgement from reading, not a measurement. Render's current prices and its limits on creating services by script were not checked (no external hosts). I did not read issues #430 or #420 myself and relied on the task's description, so I cannot say how much interest in hosting exists. Findings cited from reports 0 to 4 are drafts; I re-read the code only for S7, S10, G12 and the cost comment behind G5. Legal and privacy duties depend on where the operator and churches are, and need a qualified person.
