# Sign-in deep dive (issue #549)

Snapshot: `dev` branch at /tmp/wt_review. All paths below are inside it. Read-only review.

## Summary

1. The code is sturdier than the docs suggest. Passkeys are already offered first at first sign-in; the guides and the setup page still say "authenticator app".
2. The biggest real risks are lock-outs, not break-ins: a church that changes its web address loses every passkey, and a passkey-only person gets no recovery codes.
3. Three controls for one idea (church-wide requirement, per-person box, "stop requiring it") should become one setting plus one admin button.
4. Emailed sign-in links are reasonably safe (15 minutes, single use, one a minute) but add a mailbox-takeover path for accounts with no second factor yet.
5. Recovery works for churches with two admins; a one-admin church needs a shell and a developer-ish step that most volunteers cannot do.

## 1. Is the bar right for volunteers?

**Finding.** A fresh install turns two-factor on for everyone (`backend/src/routes/auth.js:166-173`) and gives no session until the first admin enrols (`auth.js:97-99`). That is a sound default for an app that shows every partner's private details to every account (`ADMIN_GUIDE.md:307-314`). But the first-run experience is confusing: the setup page says "you'll be asked to set up ... an authenticator app" (`frontend/src/pages/Setup.jsx:45`), and the install guide lists a phone authenticator as a requirement (`ADMIN_GUIDE.md:60-62`, `:90-92`). In fact the enrolment screen already offers a passkey first, as "the simplest way" (`frontend/src/pages/Login.jsx:200-209`).

**Gaps.**
- Choosing the passkey path signs the person straight in with no recovery codes and no nudge to add a second device (`Login.jsx:161-169`; codes are only issued for the app, `auth.js:646`). A sole admin on one laptop passkey is one lost laptop from a shell-only recovery (see Q5).
- Passkey setup needs a "discoverable" credential (`passkeys.js:82`), which some older security keys cannot make. The app falls back to the authenticator app, which is fine.

**Gentlest safe path:** passkey (with a prompt to add a second one) first, authenticator app second, emailed link only as a way in, never as a replacement factor (Q3). Keep the default on. **Severity: medium** (wording and missing second-device nudge). Not covered by queued work.

## 2. Passkeys: reliability, address mismatch, lost device

**Reliability.** Up to 5 per person (`utils/passkeys.js:6`). Challenges are signed, single-use and stored in the database, so they survive restarts (`utils/passkeys.js:50-70`). Browser errors are translated into plain sentences (`frontend/src/utils/passkeyError.js:4-20`). I cannot judge real-world phone and password-manager behaviour from code alone; the end-to-end test (`frontend/e2e/passkeys.spec.js`) uses a simulated device.

**Address mismatch (high for churches that move or add a domain).** A passkey is tied to the host name from `APP_BASE_URL`, falling back to Render's address (`utils/passkeys.js:11-33`). Only that one address is accepted as the origin (`:30`). Consequences:
- Visiting by a different address (www versus bare domain, the old `onrender.com` address after adding a custom domain) can fail: the browser may refuse (message at `passkeyError.js:12-13`) or the server says only "That passkey couldn't be verified" (`routes/passkeys.js:130`), with no hint about the address.
- Changing domain makes every existing passkey useless (`ADMIN_GUIDE.md:285-290` says so). In a church where people have only passkeys, or passwordless mode is on, nobody can get in, because a person who owns a passkey is never sent an email link (`auth.js:279`). Only a shell command or another admin's reset gets people back.
- Nothing in the admin screens warns when the configured address differs from the address the admin is browsing. Not decidable from code whether System Info shows it; I found no check.

**Lost device.** An admin's Reset MFA deletes all that person's passkeys and codes (`routes/users.js:674-679`); the person then enrols again. Self-service removal needs a password (`routes/passkeys.js:188-190`). **Problem (medium):** accounts made while passwordless is on start with no password (`routes/users.js:333-336`), so those people cannot remove a lost passkey or make recovery codes themselves (`passkeys.js:190`, `auth.js:701`); only an admin can.

**Should the passkey button show whenever any account has one?** Today it shows only if an admin ticks "Show Sign in with a passkey" (`AdminUsers.jsx:442-459`, `auth.js:116`, `passwordless.js:23-30`), default off, so people who added a passkey never see the button unless an admin finds the box. The button signs in with biometric/PIN required (`passkeys.js:333`, `:379`), which is as strong as password plus second step, and no email is asked for, so it reveals nothing. Recommendation: yes, show it whenever the browser supports passkeys and the site address is set, and remove the setting. **Severity: low.**

## 3. Passwordless sign-in links

**What is solid.** Lifetime 15 minutes, only the fingerprint of the link is stored, single use through one conditional update, older links deleted when a new one is made, one link per account per minute, identical reply for every address, sent after replying so timing leaks nothing (`utils/passwordless.js:10-12, 78-105`; `auth.js:262-290`). Only an account without a passkey gets a link (`auth.js:279`). The link does not skip a second factor: after redeeming it, an enrolled person still needs their code (`auth.js:82-92, 301`). The link page spends the link from a script, not on page load of the raw HTML (`frontend/src/pages/SignInLink.jsx:15-30`), so simple mail scanners do not burn it; scanners that run scripts could, and the person would just ask again.

**Risks.**
- **Medium: forwarded mail or shared mailbox.** Anyone who can open the email within 15 minutes signs in as that person if the account has no second factor yet. Because passwordless implies two-factor, the next step is forced enrolment (`auth.js:97`), where the intruder can enrol their own passkey. For a person with an authenticator app, the intruder is stopped at the code. For a person with no factor yet (right after switching passwordless on, or a brand-new account), the mailbox is the whole account. A shared "missions@" inbox is the practical danger.
- **Low: rate limits.** All link requests and redeems share one 10-per-15-minutes limit per internet address (`server.js:168-171`). A small church behind one router, several volunteers signing in at a service, can hit it. There is no per-account limit on redeem, but the token is 256-bit, so guessing is not realistic.
- **Low: no notice to the person** when a link is requested, a passkey is added, or MFA is reset (no email send in `routes/passkeys.js`, `routes/users.js:662-684`). The audit log records them (`utils/auditLog.js:24-34`), but only admins see it.

**Better or worse for "I can't get in"?** Better for forgotten passwords and for the first sign-in; worse when email is the single point of failure. Email problems lock out everyone, and there is no fallback to passwords (`ADMIN_GUIDE.md:298-300`). The guard that stops turning email off while it is on (`routes/settings.js:302-306`) helps; it cannot stop a Postmark account lapsing. Overall: acceptable as an optional mode, not as a default.

## 4. The two-factor model

Today: church-wide switch (`ChurchSettings.requireTwoFactor`, also implied by passwordless, `utils/twoFactor.js:16`), a per-person "require at first sign-in" box (`routes/users.js:127`, `auth.js:97`), and "Stop requiring it" (`AdminUsers.jsx:433`). Plus a separate "Passkey sign-in" tick and a passwordless switch: five sign-in controls on one screen (`AdminUsers.jsx:415-484`).

The per-person box only matters when the church-wide switch is off, and nothing else uses it. Reset MFA already puts a person back through enrolment.

**Simplest model that still helps a locked-out person:** one church setting, "Everyone signs in with two steps" (on by default); one admin action per person, "Let them start over" (today's Reset MFA); passkey button always on; passwordless as an advanced option hidden behind email being ready. Remove the per-person box and the passkey checkbox. **Severity: medium** (confusion, not harm). Not queued.

One more safeguard to check: turning the requirement on needs the admin to have enrolled (`settings.js:285-292`); turning it off has no confirm text (`AdminUsers.jsx:115-141` only asks when turning on). Fine, and audited by the generic settings recorder (`middleware/auditSettings.js:46-115`).

## 5. Recovery and lock-out

**Built and merged (not repeated as new):** recovery codes (ten, single-use, shared wrong-code limit, `auth.js:342-377, 646`), `clear-two-factor` (`backend/scripts/clear-two-factor.js`), required encryption key.

**Are they enough? Mostly, with holes.**
- **High for one-admin churches:** with one admin and a lost phone and no codes, the only route is the shell command (`ADMIN_GUIDE.md:698-712`). On Render that is the Shell tab, which a volunteer may not have, and the command line is a real barrier. The app does warn ("You are the only administrator", `AdminUsers.jsx:406-411`) but only on the Manage Users page, and the install guide does not say "add a second admin first".
- **Medium:** recovery codes exist only for authenticator-app users (`auth.js:702-706`). A passkey-only person has no fallback code.
- **Medium:** the clear command signs out and wipes factors but needs the person to still know their password, or `createAdmin.js` first (`ADMIN_GUIDE.md:712`). With passwordless on and email down, the shell is the only path.
- **Medium:** if the encryption key is ever lost or changed, all app-based two-factor stops working (`ADMIN_GUIDE.md:714-725`); the guide covers this, but restore-from-backup onto a new install with a new key would hit it silently (not decidable from code; `utils/backup.js` has no key handling).
- Reset MFA cannot be used on your own account (`routes/users.js:664-666`), by design.

## 6. Sessions and abuse

- Session: 8 hours, fixed, httpOnly, Secure, SameSite=Lax (`utils/jwt.js:6, 36-44`). Every request re-reads the account, so deactivation and role changes bite at once (`middleware/requireAuth.js:72-109`). Password change, MFA changes and admin resets end other sessions (`auth.js:444-447`, `users.js:595-597`). Sign-out-everywhere is being added separately, not re-proposed.
- Rate limits: per-address on login 20/15 min (`server.js:143-146`), codes 10/15 min (`:147`), setup links, passkey routes (`:166-188`); per-account failure limit of 10 per 15 minutes, in memory, for passwords and codes (`utils/accountLoginLimiter.js:9-18`). Good layering.
- **Low:** the per-account limit lets someone who knows an admin's email keep that admin locked out by failing repeatedly; it is documented as accepted (`accountLoginLimiter.js:6-8`). For a one-admin church this is a quiet way to block the only admin. There is no unlock short of waiting or restarting the app.
- **Low:** the per-address limits are shared by everyone behind one church router (see Q3).
- **Low:** passkey-only sign-in has no per-account limit (`routes/passkeys.js:343-398`); acceptable, since a guess needs the person's private key.
- **Audit trail:** good coverage of sign-in, failures with reasons, passkey, code, link request and reset events (`utils/auditLog.js:18-34, 39`), and switch changes via the settings recorder. Gaps: a failed or expired link redeem is not recorded (`auth.js:296-300`); a successful link redeem shows only as a later login. **Low.**

## 7. Hosted and demo

- There is no shared hosted service: each church runs its own copy (`CONTRIBUTING.md:4`, `UPGRADING.md:21`). "Hosted" here means the church's own Render site, where the address rules in Q2 apply and `APP_BASE_URL` falls back to Render's address (`utils/passkeys.js:12`).
- Public demo (`DEMO_RESET_TOKEN`): two-factor is never required (`utils/twoFactor.js:11`), never asked at sign-in even if added (`auth.js:85`), passwordless is refused (`utils/passwordless.js:17-19`), account failure limits are skipped (`auth.js:209-218, 331-340`), password changes are refused (`auth.js:34`, `:481`), and adding or removing factors does not sign others out (`utils/demoMode.js:84-86`). Sound for shared logins.
- **Low:** on a demo a visitor can still add up to 5 passkeys to a shared login and use "Sign in with a passkey" as that account (`routes/passkeys.js:329-398` has no demo check). It resets on the next demo reset; harmless but untidy and could fill the 5 slots.
- The owner's test site (`DEMO_TESTING_SITE`, `demoMode.js:56-58`) allows passwordless; docs warn never to set it on a public demo (`demo/README.md:77`). **Low:** a single mistaken variable would end password sign-in for published logins; a visible warning in System Info would help.

## Recommended target design

1. **One church setting:** "Everyone signs in with two steps", on by default. Remove the per-person box.
2. **Passkey first, app second:** the first-run screen and all docs say so. After a passkey is added, prompt for a second one (a phone and a laptop) or an authenticator app. Give recovery codes to everyone who finishes enrolment, whatever the method.
3. **Passkey button always shown** when the browser supports it and the site address is set. Remove the checkbox.
4. **One admin button per person:** "Let them start over" (existing Reset MFA), plus a plain-language "second admin" step in first-run and the install guide.
5. **Emailed link kept optional**, with a rule that a link never creates a first factor for an account that already has data worth protecting: new accounts only, or require the admin to approve the first enrolment. Email the person when a passkey is added, removed or reset.
6. **Address safety:** a banner for admins when the address in the browser differs from `APP_BASE_URL`; accept the old address for sign-in during a move.

## Follow-up issues (ranked by harm to a church)

1. **Warn and survive when the site address changes (passkeys)**
   Today a changed domain, or visiting by a second address, silently breaks passkeys, and a passkey owner is never sent a link, so everyone can be locked out. Show an admin warning when the browsing address differs from `APP_BASE_URL`, give a clearer error than "couldn't be verified", and let admins list extra allowed addresses for a move. Priority: high.

2. **Make the one-admin church safe by default**
   A sole admin who loses a phone must use a server command most volunteers cannot run. Prompt for a second admin at first sign-in and in Manage Users, and add a one-page "how to recover your only admin" with screenshots; consider a time-delayed emailed unlock for sole admins. Priority: high.

3. **Give everyone recovery codes and a second-device prompt, not only app users**
   Passkey-only people get no fallback and no nudge to add another device. Issue codes after any enrolment and prompt for a second passkey. Priority: high.

4. **Fix first-run wording and docs to match the code (passkey first)**
   Setup page, install guide and USER_GUIDE tell people they need an authenticator app, but passkeys are already offered first. Update `Setup.jsx:45`, `ADMIN_GUIDE.md:60-62, 90-92` and the recovery section. Priority: medium.

5. **Collapse the sign-in switches into one setting and one reset button**
   Remove the per-person "require at first sign-in" box and the "Show passkey button" checkbox; show the passkey button whenever supported. Keep Reset MFA, renamed "Let them start over". Priority: medium.

6. **Let passwordless-created accounts manage their own passkeys**
   People with no password cannot remove a lost passkey or regenerate codes because those need the current password. Accept a fresh passkey tap or an emailed link instead. Priority: medium.

7. **Tighten the emailed-link risk for accounts without a second factor**
   Forwarded mail or a shared inbox can enrol an attacker's passkey on an account with no factor yet. Require admin approval for first enrolment of an existing account, or a short note in the email about shared inboxes. Priority: medium.

8. **Email people when their sign-in methods change**
   Notify on passkey added or removed, MFA reset, recovery code used and link requested; record failed link redeems in the audit log. Priority: medium.

9. **Soften the per-account lockout and shared-address limits**
   One router for a whole church can exhaust the 10-request link limit, and anyone knowing an admin's email can keep them locked out. Add an admin "unlock" button and base address limits on address plus account. Priority: low.

10. **Tidy the public demo's passkey behaviour**
    Visitors can fill a shared login's five passkey slots and sign in with them; refuse passkey sign-in on a guarded demo and show a warning in System Info if the testing-site variable is set. Priority: low.
