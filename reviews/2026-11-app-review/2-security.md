# 2. Security
**Status: Checked by the lead reviewer, 2026-11-26. The findings listed under "Lead check" were re-checked; the rest stand as the helper reported them.**

> **Lead check**
> - **S1, S2, S4 confirmed in part (read in the code):** there is no demo check anywhere in `dispatchOrchestrator.js`, `groupmeChannel.js`, `whatsappChannel.js`, `email.js`, `routes/users.js`, `routes/partnerFiles.js` or `utils/extraction.js`, and `utils/demoMode.js` says in its own comment that only scheduled sends are skipped on a demo. Whether the live demo actually has real GroupMe, Postmark and Anthropic credentials set is **not known**; if it does not, these three do not apply. The claim that the demo login can list and switch to other GroupMe groups was not re-checked.
> - **S3 confirmed (read in the code):** the change-password route bumps the session version with no demo check (`backend/src/routes/auth.js`, about lines 363-367).
> - **S7 reproduced by the lead:** on a fresh local database, three sign-up requests sent at the same moment all returned 201 and all three became admins; a fourth sent afterwards got 409.
> - **S8 confirmed (read in the code).**
> - **S9 reproduced, with a correction to how it is framed:** the public API returned `"E.F."`, `Indonesia` and `West Java` for a restricted partner. This is the documented design, not a bug: SPEC.md § 1.1 and § 7 describe initials, a country-level map pin and the region label as what a restricted partner shows. The finding stands as a question about the default, and it is the owner's decision.
> - **S10 confirmed (read in the code), not tested on Render:** the worker runs the email schedule (`backend/src/worker.js:42`), which signs unsubscribe and confirm links with its own `SESSION_SECRET` (`backend/src/utils/emailDispatchShell.js:73-98`); `render.yaml:125-126` gives the worker a separately generated value, and the comment above it wrongly says the worker never signs anything.
> - **S11 confirmed in part:** a search of the backend and frontend finds no recovery codes.
> - **Not re-checked:** S5, S6, S12 to S18, the hardening table and the 198-route role walk.
**Reviewed:** branch `dev` at e713437 (0.1.0-beta.3), 2026-11-26.

The core of the app is in good shape: I sent every one of the 198 protected routes as five different logins (and probed the public and sign-in routes separately) and found no case where a lower role could read or change something it should not, uploads are checked properly, secrets are never sent back to the browser, and nothing secret is in the git history. The app is **not yet safe to hand to a non-technical church**, for three reasons that are all about defaults rather than bugs in the permission system: a fresh install can be claimed by any stranger before the church gets to it (S7), every new partner is published to the internet unless the admin unticks a box (S8), and a partner marked "restricted" still has their initials, exact country and region published (S9). The **live public demo has its own, more urgent problem**: anyone using the published admin login can make the demo send real messages through the owner's real GroupMe, WhatsApp, email and AI accounts, and can lock every other visitor out (S1 to S6). Fix S1 to S4 on the demo first, then S7 to S9 before inviting churches.

How to read "How I know": *reproduced in the running app* means I sent the request shown to my own local copy (seeded install on port 4120, never-set-up install on port 4121) and saw the result shown. Nothing was sent to the demo or any hosted site.

---

## ⚠ Findings that affect the live public demo (inferred from code and documented configuration, not tested against the demo)

The demo runs this same code with `DEMO_RESET_TOKEN` set, a published admin login, and (per `demo/README.md`, `RUNBOOK.md` and `backend/scripts/reset-demo-data.js`) real GroupMe, Postmark, Anthropic and Joshua Project credentials written back into settings on every nightly reset, plus a preserved WhatsApp session if one is paired. Demo mode switches off **scheduled** email only. The code comment says so directly: "Only scheduled sends are skipped: an email a person adds or clicks to send goes out as anywhere else" (`backend/src/utils/demoMode.js:13`). Everything below follows from that.

I could not test the demo itself, so each finding is inferred. Where the same code path could be exercised locally with demo mode switched on, I did that and say so.

### S1. Anyone with the demo admin login can post any text to the owner's real GroupMe group (and WhatsApp groups), as the owner

- **What is wrong:** Creating a prayer request or one-time need with "urgent" ticked sends it at once to GroupMe, with no check for demo mode. GroupMe posts go out "as the admin's own GroupMe identity" (`groupmeChannel.js:4`), so the message appears to come from the person whose access token is on the demo. The same login can also list every group that GroupMe account belongs to, pick a different one, and send there. The daily GroupMe and WhatsApp posting jobs have no demo check either, and the admin can set the posting hour to the next hour.
- **Where:** `backend/src/utils/dispatchOrchestrator.js:202-286` (`sendUrgentDispatch`, no demo check); `backend/src/utils/dispatchRecording.js:53-56`; `backend/src/utils/groupmeChannel.js:135-165` and `whatsappChannel.js:132` (`runGroupMePass` / `runWhatsAppPass`, no demo check; compare `emailDispatchDelivery.js:193`, which has one); `backend/src/routes/settingsGroupMe.js:117-159` (list groups and topics using the stored token), `:73-112` (re-point to any group id); `backend/src/routes/settingsWhatsApp.js:185-203` (list communities and groups), `:205` (unlink the paired number).
- **Who it affects:** The owner, and every real person in the GroupMe group or WhatsApp community wired to the demo. If the GroupMe token belongs to the owner's personal account, every group that account is in.
- **Evidence:** `reset-demo-data.js:164-190` writes `groupmeAccessToken` and the group and topic ids into settings on each reset and turns the `groupme` feature on when they resolve; `:77-95` and `:245-250` carry a paired WhatsApp session across resets. `grep isDemo` over `backend/src` finds demo checks only in `emailDispatchDelivery.js` (scheduled digest), `careChatDispatch.js`, `keyDateReminderScheduler.js`, `tripReminderScheduler.js`, `reportScheduler.js`, `twoFactor.js`, `passwordless.js`, `auth.js` and `settings.js`. None is on the urgent path or the GroupMe/WhatsApp passes.
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** On a demo, never post to a real chat channel: make `sendUrgentDispatch`, `runGroupMePass` and `runWhatsAppPass` return early when `isDemoInstance()` is true and show "would have posted" in the page instead. Make the GroupMe and WhatsApp settings pages read-only on a demo (no listing groups, no re-pointing, no unlink). Until that ships, remove `GROUPME_ACCESS_TOKEN` from the demo's environment and unpair WhatsApp. If the demo must show a real post, use a throwaway GroupMe account that is in one empty group.
- **How I know:** inferred (code read; high confidence for GroupMe urgent posts, medium for "other groups" because it depends on which account the token belongs to, medium for WhatsApp because it depends on whether a number is paired today).

### S2. The demo can be used to send email with attacker-chosen wording to any address, from the owner's verified sender

- **What is wrong:** Several things an admin "clicks to send" go out through the demo's real Postmark account with no demo check: adding a user sends a welcome email to whatever address is typed; an urgent prayer request is emailed to every active login and every confirmed public subscriber, regardless of their digest choice; trip, meeting and survey emails go to whatever participant or partner addresses are entered. The wording is largely the visitor's: the church name appears in subject lines ("Set up your {church name} missions tracker account"), and the urgent email body is the prayer request text. So a visitor can add a list of strangers' addresses as users and then email them all a message of their choosing. Separately, with no login at all, the public "subscribe" form sends a confirmation email to any address typed in.
- **Where:** `backend/src/routes/users.js:300-390` (welcome email on create; note the "forgot password" path *does* skip demos at `auth.js:490`, this one does not); `dispatchOrchestrator.js:222-277` (urgent email to all logins and subscribers; `DIGEST_RECIPIENT_ROLES` includes guests); `backend/src/utils/welcomeEmails.js:54`; `backend/src/routes/publicSubscribe.js` (`POST /`; limit is 10 per 15 minutes per IP address, no per-address limit); `backend/src/routes/settingsEmail.js:96-97` (the From address and server token can be replaced).
- **Who it affects:** The owner's Postmark account and sending domain (spam complaints, suspension, cost) and whoever receives the mail.
- **Evidence:** `reset-demo-data.js:146-159,192-195` restores `POSTMARK_API_KEY` and `FROM_EMAIL_ADDRESS` and turns `outboundEmail` on when both are present. The same script subscribes the demo admin, described as "a real inbox the operator reads" (`:115-123`). Locally, in demo mode with email off, `POST /api/users {"email":"anyone@hillsidecommunity.org","role":"admin"}` returned 201, so nothing in demo mode refuses adding arbitrary addresses.
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** On a demo, send email only to the demo admin's own address (drop every other recipient in `utils/email.js`, one place), and turn the public subscribe form into a "this would email you" notice. Make Email settings read-only on a demo.
- **How I know:** inferred (code read; high confidence if the Postmark variables are set on the demo as the docs describe).

### S3. Any visitor can change the shared demo password and lock everyone else out until the next reset

- **What is wrong:** "Change password" works on the published admin login. It also signs out every other visitor. The same can be done from Manage Users (change the admin's email or password, or make a second admin and delete or demote the published one), and the two published guest logins can be deleted.
- **Where:** `backend/src/routes/auth.js:341-376` (no demo check; compare `endOtherSessions()` in `demoMode.js:55`, which protects two-factor changes but is not used here); `backend/src/routes/users.js:540-640` and `:679`.
- **Who it affects:** Every demo visitor, for up to 24 hours (reset runs daily at 08:00 UTC, `demo/render.yaml`).
- **Evidence:** Local copy started with `DEMO_RESET_TOKEN`, `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD` set (port 4121). Two sessions A and B signed in with the published password, then:
  ```
  POST /api/auth/change-password  (session A)  {"currentPassword":"<published>","newPassword":"OnlyIKnowThis99!"}  -> 200 {"ok":true}
  GET  /api/auth/me               (session B)  -> 401
  POST /api/auth/login            (published password)  -> 401 {"error":"Invalid credentials"}
  ```
  For comparison, the two lockouts the code *does* guard both held: `PUT /api/settings {"requireTwoFactor":true}` -> 400 "Two-factor can't be required on the public demo"; `{"requirePasswordless":true}` -> 400.
- **Severity:** causes real confusion (the demo is the shop window; a locked demo looks like a broken product)
- **Recommendation:** On a demo refuse: changing any password, changing email/role/active on the published logins, and deleting them. One helper ("is this a published demo login?") used in `auth.js` change-password and `users.js` PUT/DELETE.
- **How I know:** reproduced in the running app (my local copy in demo mode); that it applies to the live demo is inferred.

### S4. The demo's real Anthropic key can be spent by any visitor, on any document, with any model

- **What is wrong:** With the admin login a visitor can upload any PDF or image (up to 10 MB), press "Scan for requests", and the file is sent to the AI service on the owner's key. The model name is a free-text setting the same login can change. The only limit is 30 scans per 15 minutes per IP address. The scan result comes back to the visitor, so with a crafted document this is in effect free use of the owner's key (up to 8,192 tokens of output per call, `extraction.js:135`).
- **Where:** `backend/src/routes/partnerFiles.js:194` (`POST /:id/extract`); `backend/src/utils/extraction.js:63-86,131-150`; `backend/src/routes/settings.js:413` (model is admin-editable); `backend/src/server.js:183-184` (limit).
- **Who it affects:** The owner (cost).
- **Evidence:** `reset-demo-data.js:139,156,166` restores `ANTHROPIC_API_KEY` and turns `aiExtraction` on when it is set. There is no local key, so this is code review only.
- **Severity:** causes real confusion
- **Recommendation:** On a demo, return a canned example result for the seeded newsletters and never call the API; or cap scans per day for the whole instance (not per IP) and lock the model field on a demo. Set a spend limit on the key in the Anthropic console today.
- **How I know:** inferred (read in the code; no API key exists locally).

### S5. A visitor can put their own pictures, links and wording on the demo's public pages

- **What is wrong:** The admin login can upload photos that are then served to everyone with no login, change the church name, tagline and about text shown on the public home page, and set partner links and the "online giving" link to any address, including one that leads to a look-alike donation page. It stays until the next reset. Uploaded photos are served with a one-year "cache forever" instruction, so a browser or cache that fetched one keeps it after the reset.
- **Where:** `backend/src/routes/partners.js` (`POST /:id/image`); `backend/src/routes/photos.js` (`GET /:id/raw`: `Cache-Control: public, max-age=31536000, immutable`, no login); `backend/src/routes/settings.js:246`; `backend/src/routes/settingsTrips.js:27` (`onlineGivingUrl` any string); `backend/src/routes/partnerLinks.js:21` (`url` any string).
- **Who it affects:** Demo visitors; the owner's reputation and domain.
- **Evidence:** Locally: `POST /api/partner-links {"type":"website","url":"javascript:alert(document.domain)"}` as an editor -> 201, and the link then appears in `GET /api/public/partners/<id>` with no login. (The browser refuses to run that particular kind of link because of the site's content policy, see S17; an ordinary `https://` link to a hostile site works as a normal link.) Only real JPEG/PNG/WebP images are accepted as photos, so this is about unwanted images, not about running code.
- **Severity:** causes real confusion
- **Recommendation:** This is the price of a public admin demo; decide how much to accept (a decision for the owner). Cheap reductions: on a demo, disable photo and logo upload, and make links and giving URL read-only; shorten the photo cache time; reset more often than daily.
- **How I know:** inferred for the demo; the two building blocks were reproduced in the running app.

### S6. What the demo admin login can read: no secrets, but some real details

- **What is wrong:** Good news first: none of the stored keys can be read back. I planted marker values in all five encrypted settings columns locally and fetched every admin page's data; none came back, and the backup file contains only the encrypted form. What the published login *can* read on the demo is: the WhatsApp phone number the demo is paired with, the names of the owner's GroupMe groups and WhatsApp communities (S1), the inbound email address and the username half of the inbound webhook login, the demo admin's real email address, and a full database backup.
- **Where:** `backend/src/routes/settingsWhatsApp.js:37` (`phoneNumber`); `settingsEmail.js:41` (`webhookUsername`); `backend/src/routes/settings.js:291-298` (the response to saving general settings also includes `inboundEmailWebhookUsername`); `backend/src/routes/backups.js`.
- **Who it affects:** The owner.
- **Evidence:** Local scan: of all admin GET routes, only `GET /api/settings/whatsapp` returned a planted value (the phone number); `PUT /api/settings` echoed the planted webhook username. In demo mode locally, `GET /api/backups/download` -> 200.
- **Severity:** minor
- **Recommendation:** On a demo, blank the phone number and webhook username in responses and refuse the backup download.
- **How I know:** reproduced in the running app (which fields come back); that the demo holds real values is inferred.

### Also true on the demo (details in the main list)

- **S13** (inbound email): if the demo's inbound address is live, anyone who emails it adds a stored email to the demo database with no login.
- **S7** (setup claim): each nightly reset empties the user table for a few seconds before the admin is recreated, and `/api/auth/setup` is open in that gap. Harmless on a demo whose admin is public anyway, but it is the same hole.
- The reset endpoint itself (`routes/demo.js`) is sound: constant-time comparison, a 401 on any wrong token, not present at all without `DEMO_RESET_TOKEN`. It has no rate limit, which does not matter if the token is the documented 32 random bytes.
- I found no way to pivot from the demo to the server or other systems: uploads live in the database and are never executed, every outbound request goes to a fixed host (GroupMe, Postmark, Anthropic, Joshua Project, GitHub, OpenStreetMap), and the reset runs fixed commands.

---

## Findings for every church install

### S7. A stranger can claim a brand-new install before the church does, and two people can both become the first admin

- **What is wrong:** Between "Deploy" finishing and the church opening the site, the address accepts a first-admin sign-up from anyone on the internet. Nothing ties that first sign-up to the person who deployed (no setup code, no check of the deployer's email). The app also tells any visitor that it is unclaimed. If a stranger gets there first, the church sees an ordinary sign-in page with no account that works and no explanation. Worse, the "only ever succeeds once" check is not airtight: two sign-ups arriving together both succeed, so a stranger who times it against the real admin ends up as a second, unnoticed administrator.
- **Where:** `backend/src/routes/auth.js:93-156` (`GET /setup-status`, `POST /setup`: count users, then create, with nothing stopping two requests passing the count together); `ADMIN_GUIDE.md:93-97` (the instruction, with no warning).
- **Who it affects:** Every new church. The window is minutes for someone who follows the guide straight through, and days for someone who deploys on Friday and comes back Monday. Render addresses are guessable from the church name and new sites are routinely scanned.
- **Evidence:** Never-set-up local copy (port 4121):
  ```
  GET  /api/auth/setup-status                      -> {"needed":true, ...}        (no login)
  POST /api/auth/setup {"email":"stranger1@hillsidecommunity.org","password":"…"}  -> 201   } sent at the
  POST /api/auth/setup {"email":"stranger2@hillsidecommunity.org","password":"…"}  -> 201   } same moment
  select email, role from "User";  -> stranger1…|admin, stranger2…|admin
  POST /api/auth/setup {"email":"church@hillsidecommunity.org", …}  -> 409 "Setup has already been completed for this instance."
  ```
  The guide's whole instruction is: "Visit your new site and go to `/setup` … to create your first admin account, right in the browser."
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Require a one-time setup code that only the deployer can see. On Render, add a generated `SETUP_CODE` variable to `render.yaml` and have the setup page ask for it (the guide then says "copy the setup code from your Render dashboard"); elsewhere print it in the server log at first start. Make the create step atomic (one transaction that fails if any user exists, or a unique "first admin" marker row). After setup, show the new admin "You are the only account" on the first screen so a second account stands out.
- **How I know:** reproduced in the running app.

### S8. New partners are published to the internet by default

- **What is wrong:** On a fresh install the public directory and public map are both on. In the New Partner wizard, "Show on public site" starts ticked and "Restricted-access location" starts unticked. An admin who types a name and country and accepts what the three wizard steps offer has published that family's name and country to anyone, with no login, and a map pin for their city once an address is added. The only explanation of either box is a hover tooltip, which does not appear on a phone or tablet. The database default is the safe one (not public); it is the wizard that flips it.
- **Where:** `frontend/src/pages/AdminPartnerForm.jsx:32-33` (`isPublic: true, isRestricted: false`), `:172-190` (explanations only in `title=`); `backend/src/utils/features.js` (`publicDirectory` and `publicMap` default on); `backend/prisma/schema.prisma` Partner (`isPublic @default(false)`).
- **Who it affects:** Every partner entered by an admin who accepts the defaults, most seriously a worker in a sensitive country whom the admin did not think to mark.
- **Evidence:** What the screen tells the admin, in full: the label "Show on public site" with hover text "Whether this partner appears in the public directory and map at all. Leave off for a partner you're not ready to list yet." and the label "Restricted-access location" with hover text "Masks the name to initials and coarsens the map pin to a country centroid on the public site." Locally, `GET /api/public/partners` with no login returns each public partner's name, country, region, overview, photo and coordinates to 15 decimal places (these are city-level: the app looks up the city, never the street, `utils/geocode.js:5`).
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Start "Show on public site" unticked, and make the visibility step a plain three-way choice with the consequence written under each option in normal text: "Private (only people who sign in)", "Public (name, country, city pin and photo visible to anyone)", "Public but protected (see S9)". Consider shipping with the public directory and map off until the admin turns them on from a screen that says what becomes visible (a decision for the owner, since the public directory is a headline feature).
- **How I know:** reproduced in the running app (public output) and read in the code (wizard defaults).

### S9. "Restricted" partners still have their initials, exact country and region published

- **What is wrong:** Marking a partner restricted while leaving them public does not hide who or where they are as much as the label suggests. The public pages still show the initials of the real name, the exact country, and the free-text "Field / Region" label. The app's own settings page admits that "initials plus country can be enough to re-identify who that is to someone who knows the local mission community", yet initials are the default, and the switch to turn them off is on the Dispatch Settings page, not where a partner's visibility is set. The wizard's tooltip for the region field says it is "Shown publicly even if this partner is restricted-access, since it doesn't reveal their exact location -- e.g. 'West Africa' rather than the specific country", but the specific country is published as well.
- **Where:** `backend/src/utils/maskData.js` (`toPublicPartner`: the shared `base` object carries `fieldDisplayName`, `fipsCountryCode` and `country` for restricted partners; `maskedDisplayName` returns initials unless `restrictedPartnerInitialsEnabled === false`); `frontend/src/pages/AdminDispatchSettings.jsx:172-188`; `frontend/src/pages/AdminPartnerForm.jsx:122`.
- **Who it affects:** Workers in sensitive locations: the people for whom a mistake has the highest cost.
- **Evidence:** Seeded partner "Erin Farnsworth", restricted and public, fetched with no login:
  ```
  GET /api/public/partners  ->  {"displayName":"E.F.","country":"Indonesia","fipsCountryCode":"ID",
        "fieldDisplayName":"West Java","isRestricted":true,"gpsLat":-5,"gpsLng":120, …}
  ```
  The list is also ordered by the real name, so the masked entry sits where the real name would.
- **Severity:** blocks adoption or is unsafe
- **Recommendation:** Make the safe behaviour the default: a restricted partner is **not** on the public site unless the admin deliberately chooses "show a masked entry", and a masked entry shows a generic label and a continent or region the admin typed, with no initials and no country. Move the initials switch next to the restricted setting, default off. Sort masked entries last. Put one sentence on the partner page whenever restricted and public are both on: "Anyone can see: E.F., Indonesia, West Java."
- **How I know:** reproduced in the running app.

### S10. The one-click Render setup gives the background worker the wrong secrets

- **What is wrong:** The Render blueprint creates two services. It generates a separate signing secret for each, on the stated belief that the worker "never signs or verifies a session itself, so this value never needs to match". That is not true: the worker sends the scheduled email digests and trip reminders, and it signs the "unsubscribe" link and the "Open your trip page" button in them. The website then rejects those links because they were signed with a different secret. Second, the worker's encryption key is left for a human to copy across by hand, but the Admin Guide tells the reader that the keys "are generated automatically, nothing to enter" and to leave the prompted variables blank. A church that follows the guide gets a worker that cannot read the stored GroupMe, Postmark or WhatsApp credentials, so scheduled sends quietly fail.
- **Where:** `render.yaml` worker section (`SESSION_SECRET generateValue: true` with the comment quoted above; `FIELD_ENCRYPTION_KEY sync: false` "MUST be the exact same value … copied by hand"); `ADMIN_GUIDE.md:85-89`; `backend/src/utils/emailDispatchShell.js:73,91` and `backend/src/utils/tripAccessToken.js:25` (signing); `backend/src/utils/emailDispatchDelivery.js:151`, `tripReminderScheduler.js:113` (called from the worker).
- **Who it affects:** Every church that deploys with the blueprint and uses email digests or trip reminders. Recipients who cannot unsubscribe mark the mail as spam, which puts the church's email account at risk.
- **Evidence:** Locally I built both links twice, once with the website's secret and once with a separately generated one, and opened them on the website:
  ```
  signed with the website's secret:   GET /api/auth/unsubscribe?token=…  -> 200     GET /api/public/trips/participants/access?token=… -> 200
  signed with a different secret:     GET /api/auth/unsubscribe?token=…  -> 400 "This unsubscribe link isn't valid."     … -> 401 {"error":"Invalid or expired link"}
  ```
  That a blueprint deploy produces two different values is read from `render.yaml`, not tested on Render.
- **Severity:** causes real confusion
- **Recommendation:** Give both services the same two secrets automatically. Render supports this with an environment group (define `SESSION_SECRET` and `FIELD_ENCRYPTION_KEY` once with `generateValue: true` and attach the group to both services), which removes the hand-copy step entirely. Fix the comment and the guide. Add a line to the About App page that says whether the worker has been seen recently and whether it could decrypt (the guide notes "no live 'worker is/isn't running' check exists yet").
- **How I know:** reproduced in the running app (the mismatch behaviour); read in the code (that the blueprint causes it).

### S11. A church with one admin who loses their phone is locked out for good

- **What is wrong:** A fresh install rightly requires two-factor sign-in for everyone. But there are no recovery codes, an admin cannot reset their own two-factor, and the only reset is done by *another* admin. A small church typically has one admin. If that person loses or replaces their phone, nobody can get in, and the only way back is editing the database by hand. The command-line helper that creates an admin does not clear two-factor either. The guides do not mention this situation at all. The same lockout happens to everyone at once if the encryption key is lost or regenerated (for example by deleting and recreating the Render services), because the stored authenticator secrets can no longer be read.
- **Where:** `backend/src/routes/users.js:655-658` (reset refuses your own account); `backend/src/routes/auth.js:577-580` (cannot switch off while required); `backend/prisma/createAdmin.js` (upsert does not touch `mfaEnabled`/`mfaSecret`); `backend/src/routes/auth.js:281` (decrypt at sign-in).
- **Who it affects:** Any church with a single admin, which is the audience this review is written for.
- **Evidence:** `grep -n -i "locked out\|lost .*authenticator\|recovery code\|backup code" ADMIN_GUIDE.md USER_GUIDE.md` returns nothing relevant.
- **Severity:** causes real confusion
- **Recommendation:** Show one-time recovery codes when two-factor is set up and require the admin to confirm they saved them. On the setup screen and in Manage Users, nudge strongly for a second admin ("You are the only administrator. If you lose your phone, no one can get in."). Add a documented, one-line rescue command (`npm run admin:reset-mfa -- email`) and a short "Locked out?" section in the Admin Guide.
- **How I know:** read in the code.

### S12. Sign-in throttling only works when exactly one proxy sits in front of the app

- **What is wrong:** All the "too many attempts" limits count by visitor address, and the app is hard-wired to assume exactly one proxy in front of it. With none (the app reachable directly, which the guide's "plain VPS" option allows if nginx is skipped or the port is left open), a visitor can pick their own address by adding a header and is never limited. With two (for example Cloudflare in front of Render or in front of nginx), every visitor shares one counter, so 20 sign-in attempts by anyone locks out the whole church for 15 minutes. The guide lists the limits but never mentions this assumption.
- **Where:** `backend/src/server.js:73-77` (`app.set("trust proxy", 1)`); `ADMIN_GUIDE.md:380-396`, `:482`.
- **Who it affects:** Churches hosting anywhere other than plain Render, or adding a CDN.
- **Evidence:** My local copy has no proxy in front of it:
  ```
  23 wrong sign-ins with the same  X-Forwarded-For: 203.0.113.9   -> 20 × 401, then 429 429 429
  30 wrong sign-ins with a different X-Forwarded-For each time     -> 30 × 401, never limited
  X-Forwarded-For: 10.9.9.1, 203.0.113.9 (what one real proxy would produce) -> counted as 203.0.113.9 (correct)
  ```
- **Severity:** causes real confusion
- **Recommendation:** Make the number of trusted proxies a setting with 1 as the default, document it in one paragraph, and show "Your address as this site sees it" on the About App page so an admin can tell at a glance whether it is right. Add a second, per-account counter on sign-in so throttling does not depend on addresses alone.
- **How I know:** reproduced in the running app. Whether Render really presents exactly one hop I could not check (see the last section).

### S13. Email receiving trusts a weak sender check, and anyone can fill the database through it

- **What is wrong:** When email receiving is on, a message is filed automatically as a partner's newsletter, and announced to the church's chat and digests as "New newsletter from …", if the From address matches a partner and the message passed a basic sending-server check. That check proves which server sent the message, not that the From line is genuine, so someone who knows a missionary's address and the church's inbound address can plant a document under that missionary's name. Separately, every message sent to the inbound address is stored in the database in full (up to 15 MB each) whether or not it matches anyone, with no cap on how many, and the cheapest database plan is small.
- **Where:** `backend/src/routes/inboundEmail.js:53` (`isSenderVerified`: `Received-SPF: pass` or `DKIM_VALID`), `:150` (auto-file, then `notifyNewsletterCreated`), `:161` (store unmatched); `backend/src/server.js:113,188` (15 MB body, 60 requests per 15 minutes).
- **Who it affects:** Churches that turn on Email (Receiving). It is off by default.
- **Evidence:** Code read. The webhook login itself is sound (username and password compared in constant time, throttled, wrong or missing credentials give 401).
- **Severity:** causes real confusion
- **Recommendation:** Never auto-file: put every inbound message in the review queue, with a "from a known partner address" hint, and announce only after a person assigns it. Keep the queue bounded (delete unassigned messages after 30 days, cap total size, refuse when full). If auto-filing stays, require a DKIM pass for the From domain itself.
- **How I know:** read in the code.

### S14. The backup is an unprotected file holding everything, and the restore guide suggests putting it on a public file host

- **What is wrong:** "Download Backup" produces one plain compressed file with every partner (restricted ones unmasked), every uploaded document, and every login's password hash. It is not password-protected and lands in the admin's Downloads folder. The screen and guide do warn about this clearly. But the restore instructions then say the "simplest path" to get the file onto the server is "a temporary, unlisted file host". Any admin session can download it with no password re-check.
- **Where:** `backend/src/routes/backups.js`; `backend/src/utils/backup.js`; `ADMIN_GUIDE.md:1598-1602`; `frontend/src/pages/AdminSystemInfo.jsx:139-144` (the warning).
- **Who it affects:** Every church that takes a backup, and every partner in it.
- **Evidence:** Local download: `GET /api/backups/download` -> 200, 79 KB `.ndjson.gz`; opened with standard tools, it lists 50 tables including `user` rows with `passwordHash` values beginning `$2b$12`. Stored integration keys appear only in encrypted form. The download is recorded in the audit log and limited to 5 per 15 minutes.
- **Severity:** causes real confusion
- **Recommendation:** Ask for a passphrase at download and encrypt the file with it (the restore script asks for the same passphrase). Ask for the admin's password again before download. Rewrite the restore step so it never involves a third-party host (Render's shell can receive a file by paste or `scp`).
- **How I know:** reproduced in the running app (contents); read in the docs (restore advice).

### S15. Partner photos stay reachable by their web address with no login, whatever the partner's settings

- **What is wrong:** Every partner photo is served to anyone who has its address, with no login, including photos of partners who are restricted, not public, or archived, and browsers are told to keep it for a year. The addresses are long random strings, so they cannot be guessed. The practical risk is the partner who starts public and is later marked restricted or private: their photo was already handed out on the public page and still loads from the same address afterwards.
- **Where:** `backend/src/routes/photos.js` (`GET /:id/raw`).
- **Who it affects:** A partner whose situation becomes sensitive after they were listed publicly.
- **Evidence:** Locally, with no cookie: `GET /api/photos/4f2fdcd2-…/raw` (restricted partner's photo) -> 200; `GET /api/photos/2abede52-…/raw` (non-public partner's photo) -> 200.
- **Severity:** minor
- **Recommendation:** Serve a photo without login only while its partner is public and not restricted; otherwise require a session. When a partner becomes restricted or private, give its photos new addresses. Cut the cache time to a day.
- **How I know:** reproduced in the running app.

### S16. AI scanning sends restricted partners' letters to an outside company with no extra warning, and guests can trigger it

- **What is wrong:** The feature is off by default and its description is honest ("the one feature here that sends data to a third party"). Results are suggestions a person must accept, which also limits what a booby-trapped document can do. Two gaps: the "Scan for requests" button looks and behaves the same on a restricted partner's newsletter, so a letter from a worker in a sensitive country goes to the AI provider on one click; and the button is available to editors and to care-team guests for their partner, each click costing the church money.
- **Where:** `backend/src/routes/partnerFiles.js:194` (allowed for anyone who can write to that partner; no `isRestricted` check); `frontend/src/pages/AdminPartnerFiles.jsx:297`.
- **Who it affects:** Restricted partners; the church's AI bill.
- **Evidence:** Code read only: no API key exists locally, so I could not run a scan or test a hostile document.
- **Severity:** minor
- **Recommendation:** Refuse scanning for restricted partners unless the admin has ticked a clearly worded setting; show "This sends the whole file to Anthropic" in the confirm step; limit scanning to admin and editor.
- **How I know:** read in the code.

### S17. Link fields accept any text; the site's content policy is the only thing stopping a script link

- **What is wrong:** Partner links, the online giving link, the church website and trip album links are saved as typed, with no check that they are ordinary web addresses. An editor can save a link that is really a script. I confirmed the browser refuses to run it because of the site-wide content policy, so today this is not exploitable; it is one layer of protection where there should be two.
- **Where:** `backend/src/routes/partnerLinks.js:21`, `partners.js:235`, `settingsTrips.js:27`, `trips.js:98`; `frontend/src/pages/PublicPartnerDetail.jsx:112`.
- **Who it affects:** Public visitors, if the content policy were ever loosened.
- **Evidence:** `POST /api/partner-links {"url":"javascript:alert(document.domain)"}` as editor -> 201; it is returned by `GET /api/public/partners/<id>` and rendered as a link; clicking it in Chromium produced no dialog and the console message "Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self''".
- **Severity:** minor
- **Recommendation:** Accept only `http://` and `https://` addresses in every link field (the email builder already has this check, `emailTemplate.js:27`).
- **How I know:** reproduced in the running app.

### S18. Dependencies: one reported issue of little practical weight, and one unofficial library worth a decision

- **What is wrong / Evidence:** `npm audit` on 2026-11-26:

  | Where | Production dependencies | Development-only |
  |---|---|---|
  | `backend/` | 3 "high", all the same chain: `prisma` 7.10.1 -> `@prisma/config` -> `effect` 3.20.0 ("ReDoS in Schema.TemplateLiteral"). npm counts it as production because `@prisma/client` names `prisma` as a peer. | none besides the above |
  | `frontend/` | 0 | 0 |
  | repo root | 0 | 0 |

  The flagged code is in the Prisma command-line tool's config loader, which runs at deploy time and is not reachable from web requests. npm's suggested fix is a downgrade to Prisma 6.12, which would break the app; wait for a patched 7.x instead.

  Separately, WhatsApp posting uses `baileys` pinned to a release candidate (`7.0.0-rc14`) through `baileys-antiban` 4.10.0. Baileys is an unofficial client that reverse-engineers WhatsApp; it holds a live session for a real phone number, can break without notice, and can get the number banned. The Admin Guide says this plainly ("It's unofficial, and WhatsApp can ban the number. Use a dedicated number …"), and the stored session is encrypted and left out of backups.
- **Where:** `backend/package.json`.
- **Who it affects:** Churches that turn on WhatsApp (off by default).
- **Severity:** minor
- **Recommendation:** Do nothing about the Prisma report beyond upgrading when a fix ships. For WhatsApp: a decision for the owner whether a feature built on an unofficial, pre-release library belongs in a product aimed at non-technical churches, or should be labelled "experimental" on the screen where it is switched on.
- **How I know:** reproduced (the audit was run); read in the code (versions).

---

## Smaller hardening items

| # | Item | Where | How I know |
|---|---|---|---|
| H1 | Signing out only clears the browser cookie; a copied session keeps working for up to 8 hours. (`POST /api/auth/logout`, then the old cookie on `GET /api/partners` -> 200.) | `auth.js:799`, `jwt.js` | reproduced |
| H2 | Passwords need only 8 characters, with no check against common passwords and no per-account lockout. Two-factor being on by default makes this acceptable. | `utils/password.js`, `server.js:127` | read in the code |
| H3 | The backup download limit counts requests before checking who is asking, so 5 anonymous requests from the same address block the admin's download for 15 minutes (my own route walk did this to me). Matters only together with S12. | `server.js:179` | reproduced |
| H4 | Confirming a public digest subscription happens on opening the link (a GET). Mail scanners that pre-open links will confirm on the recipient's behalf. Unsubscribe and RSVP correctly use a confirm button. | `publicSubscribe.js` (`GET /confirm`) | read in the code |
| H5 | The public settings response lists every feature switch, including which integrations are on. Harmless, but more than the public pages need. | `publicSettings.js` (`enabledFeatures`) | reproduced |
| H6 | Trip documents uploaded by staff are accepted on the browser's word about their type; partner files, photos, logos and public uploads all check the actual content. Download is still safe (forced to a harmless type). | `trips.js:866` | read in the code |
| H7 | The seeded sample logins (`pat-reynolds@example.org` and others) share a password written in `prisma/seed.js`, while `demo/README.md` says they "have a password nobody is told". No effect while the demo admin is public anyway. | `seed.js:2431` | read in the code |
| H8 | No request-origin check beyond the cookie's SameSite=Lax setting. Fine on `*.onrender.com`; a church using `missions.theirchurch.org` shares "same site" with every other subdomain of their church domain. | `utils/jwt.js` (`setSessionCookie`) | read in the code |
| H9 | Running without `NODE_ENV=production` only logs a warning; the session cookie is then sent over plain HTTP. The Render blueprint sets it correctly; a self-hoster will not see a server log. | `config/env.js:83` | read in the code |
| H10 | The page's small inline theme script is blocked by the site's own content policy in the built app (console: "Executing inline script violates … script-src 'self'"). Not a security problem; the saved light/dark theme is not applied before first paint. Passing it on for whoever owns that area. | `frontend/index.html:15` | reproduced |

---

## What is done well (please do not break)

Each of these was checked, not assumed.

- **Roles and guest scoping hold everywhere.** I listed the mounted routes from the real Express app (252; the passkey sub-routes are mounted in a way my lister missed, so I read those by hand) and sent each of the 198 that sit behind a login as: no login, viewer, editor, a guest with one trip, and a guest with one care-team seat, using ids of records *outside* the guests' reach. The public, sign-in and token-link routes were probed separately. No-login got 401 on every protected route. Guests got 403 on every other partner's records, files, photos-by-partner, prayer requests, needs, contact log, surveys, trips and trip sub-records, reports and the full booklet data; their list views contained only their own partner. Viewers got 403 on every write except the contact log (documented as intended). Editors got 403 on users, settings, audit, backups, system info, template packs and every delete. With valid bodies, a guest posting to another partner got 403, and "urgent"/"approve now" sent by a care-team guest were ignored.
- **Features that are switched off return 404**, not a permission error (inbound email and email settings routes with the feature off: 404 for every signed-in role).
- **Stored keys are write-only.** With marker values planted in all five encrypted columns, no route returned any of them; they are encrypted with AES-256-GCM (`utils/crypto.js`) and refuse to decrypt anything not in the encrypted format.
- **The app refuses to start with a missing, short or placeholder `SESSION_SECRET`**, and `.env.example` deliberately ships it empty.
- **Session handling is careful:** the role is re-read from the database on every request, password and role changes end other sessions, special-purpose tokens (unsubscribe, two-factor pending, trip page) cannot be used as a session, and codes cannot be replayed.
- **Sign-in gives nothing away:** one generic error, a dummy password check for unknown addresses so timing does not differ, and "forgot password" / "email me a link" answer identically for any address.
- **Uploads are checked by content, not by name** (JPEG/PNG/WebP/PDF/Office signatures; no SVG or HTML), files download with a safe type and as attachments unless verified, and the survey photo preview is served in a sandbox.
- **HTML in emails is escaped.** I built the admin and public digests with script and image payloads in every user-controlled slot; the HTML came out escaped. Brand colours and fonts are restricted to safe values.
- **Restricted partners are kept out of chat and email by default** (`allowRestrictedPartnerDispatch` off), and when it is on, their items are held for a person to review.
- **Spreadsheet exports neutralise formula characters** (`utils/csv.js`), raw SQL uses only fixed table names, there is no route that fetches an address supplied by a user, and the sign-in "return to" address only accepts paths inside the app.
- **Nothing secret is in the git history.** I searched all 1,012 commits for key patterns (Anthropic, Postgres URLs with passwords, private keys, Render/GitHub/Neon tokens, session secrets, demo passwords and tokens); every hit was a test placeholder or an example line.

### Role walk, condensed

Status codes by role for a sample of the 198 non-public routes tested (full table in my scratch folder, see below). "400" on a write means permission passed and the empty test body was rejected.

| Route | no login | viewer | editor | trip guest | care guest |
|---|---|---|---|---|---|
| `GET /api/partners/:id` (other partner) | 401 | 200 | 200 | 403 | 403 |
| `GET /api/partner-files/:id/download` (other partner) | 401 | 200 | 200 | 403 | 403 |
| `GET /api/prayer-requests?partnerId=` (other partner) | 401 | 200 | 200 | 403 | 403 |
| `GET /api/support-needs?partnerId=` (other partner) | 401 | 200 | 200 | 403 | 403 |
| `GET /api/trips/:id` (other trip) | 401 | 200 | 200 | 403 | 403 |
| `GET /api/trips/documents/:id/download` (other trip) | 401 | 200 | 200 | 403 | 403 |
| `GET /api/reports`, `GET /api/partners?include=full` | 401 | 200 | 200 | 403 | 403 |
| `PUT /api/partners/:id` | 401 | 403 | 200 | 403 | 403 |
| `DELETE /api/partners/:id` | 401 | 403 | 403 | 403 | 403 |
| `GET /api/users`, `PUT /api/settings`, `GET /api/audit`, `GET /api/system-info` | 401 | 403 | 403 | 403 | 403 |
| `GET /api/backups/download` | 401 | 403 | 403 | 403* | 403* |
| `GET /api/settings/groupme`, `/whatsapp`, `/ai-extraction`, `/joshua-project` | 401 | 403 | 403 | 403 | 403 |

\* showed 429 in the raw run because the per-address limit of 5 had been used up by earlier rows (H3); `requireRole("admin")` covers the whole router.

---

## What I couldn't check, and why

- **The live demo and dev-test site.** Off limits by instruction. Every demo finding is reasoning from the code plus `demo/README.md`, `RUNBOOK.md`, `demo/render.yaml` and `reset-demo-data.js`. In particular I do not know which of the optional integration variables are actually set on the demo today, whether a WhatsApp number is paired, or whose GroupMe account the token belongs to. The owner can settle S1, S2 and S4 in a minute by looking at the demo's Render environment.
- **How many proxies Render puts in front of the app (S12).** I could only test with none. The owner can check on the demo without any tools: open the Audit log and look at the address recorded for their own sign-in. If it is their real home or office address, the setting is right for Render.
- **Real sends on any channel.** No credentials exist locally and I was told not to add any or force a schedule. So GroupMe, WhatsApp, Postmark and the inbound webhook were reviewed in code, and the email HTML was built but not sent.
- **The AI scan.** No API key locally: code review only. I did not test what a deliberately hostile document can make the scan return.
- **The WhatsApp link between the website and the worker.** I did not start the worker (not permitted for this review) and did not trace how pairing and group listing cross between the two processes, so the WhatsApp parts of S1 are less certain than the GroupMe parts.
- **A real Render blueprint deploy (S10).** I showed what happens when the two services have different signing secrets and read from `render.yaml` that they will; I did not deploy to Render to watch it.
- **Passkeys end to end.** Reviewed in code (origin and site checks, user verification required, challenge single-use); not exercised with a real authenticator.
- **Timing differences on sign-in.** The dummy password check is there; I did not measure response times.
- **Front-end pages one by one.** I searched the front end for places that insert raw HTML (one: the booklet preview, which escapes what it inserts) and tested one public page in a browser; I did not click through every admin screen looking for display bugs.

Scratch files (the route lister, the role-walk script and its full output, audit JSON, and the demo-mode test) are in `/tmp/claude-0/-home-user-missions-partner-tracker/f2c4cd1e-b574-5284-a231-a151b8f69f79/scratchpad/security/` (`listroutes.js`, `walk.js`, `walk.tsv`, `routes.txt`, `audit-*.json`, `xss-email.js`, `jsurl.js`). Local test logins created: `editor@`, `viewer@`, `tripguest@`, `careguest@hillsidecommunity.org` on database `mpt_security`.
