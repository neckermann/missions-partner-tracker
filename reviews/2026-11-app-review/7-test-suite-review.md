# Test suite review (issue #552)

Read-only review of the `dev` snapshot. Nothing was run; counts are from grep and are approximate.

**Summary**
1. Backend unit tests: 59 files, about 537 tests. Route tests (they boot the real app and database): 94 files, about 1,105 tests, 28,300 lines.
2. Frontend component tests (vitest): 94 files, about 560 tests. Browser tests (Playwright): 30 files, about 156 tests.
3. Coverage is strong for backup, masking, and sign-in. The thinnest areas are the sending of real notifications over WhatsApp/GroupMe, and several repo rules that nothing enforces.
4. No test is skipped for good and no CI step is allowed to fail. Several tests can never fail, and a few depend on leftover database rows or on timing.
5. Of the five written rules checked, one is enforced by a guard, one partly, and three not at all.

## 1. Coverage of what matters

- **Sign-in and two-factor: good.** `routes/twoFactorRequirement.test.js` (17), `recoveryCodes.test.js` (12), `totpReplay.test.js` (4), `accountLoginLimit`, `passwordless`, `revocation`, `sessionVersion`, plus e2e `auth-boundary.spec.js` and `two-factor-requirement.spec.js`. Gap (medium): the app's own two-factor setup steps (`/mfa/setup`, `/mfa/verify-setup`, `/mfa/disable` in `routes/auth.js:591-660`) are only touched in passing by `twoFactorRequirement.test.js` and `recoveryCodes.test.js`, with no test file of their own.
- **Restricted-partner masking: good.** `maskData.test.js` (42 tests), `reportMasking`, `dispatchEligibility`, `keyDateReminderEmail`, and route tests in `prayerRequests`, `supportNeeds`, `photos`, `emailDispatchDelivery`. Low risk.
- **Public/private line: good for photos, thin for files.** `routes/photos.test.js:129-140` checks public vs private photo access; `publicPartners`, `publicSettings`, `settingsExposure`, `guestScope` and e2e `public-bundle.spec.js` cover pages. Partner files (`routes/partnerFiles.js`) are only reached through `fileUploadVerification.test.js` (upload checks), not an "outsider cannot download a private file" test (medium).
- **Notification sending and queue: mixed.** The queue and approval logic is well covered (`dispatches` 37, `dispatchOrchestrator` 18, `dispatchEligibility`, e2e `pending-dispatches`). GroupMe and WhatsApp have 21 and 20 route tests, but they use fake senders, so a change in the real service goes unnoticed (low; unavoidable). No test checks that a restricted partner's text is blocked on the WhatsApp/GroupMe path through the full scheduler beyond the cases in `dispatches.test.js:268-338`.
- **Backup and restore: very good.** `routes/backups.test.js` and `backupStream.test.js` (28 tests) include a real delete-then-restore round trip (`backupStream.test.js:85`, `backups.test.js:247`), tampering, cut-short files, wrong passphrase. Gap (low): no test restores into a database whose schema is older than the backup.
- **Upgrades/migrations: thin (high).** `schemaCheck.test.js` (11 unit) and `routes/schemaCheck.test.js` (3) cover the version check. Nothing tests that migrations apply cleanly on top of an existing populated database. CI only applies them to an empty one (`ci.yml` "Apply migrations and seed").

**Untested or nearly so:** upgrade of a populated database; private-file download refusal; two-factor setup/disable as their own flows; real-service sending (WhatsApp/GroupMe/Postmark) against the live provider.

## 2. Tests that pass for the wrong reason

- **High: `frontend/src/components/admin/AdminLayout.test.jsx:92`.** `await screen.findByText("Partner Page").catch(() => {});` swallows the failure of the wait. The following assertion on the address still checks the redirect, so it is only mildly weakened, but the intent (the page actually appeared) is not enforced.
- **Medium: `backend/test/routes/notifications.test.js:305`.** `if (item.count === 1) assert.equal(item.linkTo, ...)`. If another trip row is departing soon (leftover from another file), the check silently does nothing. Line 295 has the same weakness: `assert.ok(item.count >= 1)` passes on other people's rows.
- **Medium: `backend/test/routes/systemInfo.test.js:45`.** The `if (onRender) ... else ...` shape means one branch is never exercised in a given environment; CI never runs on Render so the first branch is untested.
- **Medium: `backend/test/features.test.js:119`.** `if (f.withoutEmail !== undefined) assert...` cannot fail for a feature that has no note; the second check at line 124 covers the key case, so only the sentence-quality check is conditional.
- **Low: `backend/test/templatePacks.test.js:26`.** `if (q.field) assert...` skips questions without a field, which is intended.
- **Medium: `backend/test/routes/firstAdminSetup.test.js:49,69`.** Both tests self-skip when the database has any real account. CI sets this up on purpose (`ci.yml`, "created AFTER the route tests"), but on any other database (a developer's, a reused one) the first-run setup race is silently not tested, and a skip is easy to read as a pass.
- **Medium: `frontend/e2e/support-preferences.spec.js:49`.** `test.skip(!startedEmpty, ...)`: skipped whenever the menu already has rows. Same pattern, same reading problem.
- **Low: `.catch(() => {})` in cleanup** (`dispatches.test.js:268,310,338,467`, `revocation.test.js:88`, `guestScope.test.js:325`, `settingsExposure.test.js:61`, `settingsBrandValidation.test.js:26`, `emailDispatchDelivery.test.js:155`, `dispatchOrchestrator.test.js:146`). Cleanup only, so a failure leaves a leftover row rather than hiding a bug, but leftover rows are what feed the notifications problem above.
- **Checks a mock, not behaviour (low).** Several "no email sent" tests assert on a fake mail list (`passwordSetupRequest.test.js:100-116`); fine as long as the fake is wired to the real send path, but a renamed sender would make them pass vacuously. Add a positive control (one send that does register) in the same file.

No `assert.ok(true)`, `|| true`, or empty test bodies were found. Only `plainWords.test.js` has fewer than 3 assertions, which is expected for a scanner.

## 3. Fragile tests

- **Timezone (medium).** CI deliberately runs unit tests under `TZ: America/Los_Angeles` (`ci.yml:108`), but the route tests and e2e step set no timezone, so they run in UTC, the one zone where date bugs hide. `routes/timezoneChange.test.js`, `keyDateChurchDay.test.js` and `digestKeyDates.test.js` are exactly where a west-of-UTC bug would appear.
- **Sleeps (medium).** `routes/passwordSetupRequest.test.js:100,116,150,154,160,164` waits 100 to 500 ms for something not to happen. A slow runner can let the email arrive after the check, giving a false pass, never a false fail; on the positive side (a wait for something that should happen) it would be a flake.
- **Time arithmetic (low).** `dispatchOrchestrator.test.js:189-214` uses "13 days ago" / "15 days ago" around a 14-day rule: safe unless a daylight-saving change falls in the window.
- **Leftover rows (medium).** Route files share one database and one cannot see what another left behind. `notifications.test.js:295-305` is the clearest case; CI's own comment (`ci.yml`, the "Enable the trips feature" step) admits files restore settings to "whatever existed when that file started", so one file's leftovers become the next file's starting point.
- **Order dependence (low).** Several route files hold ordered tests that build on each other (`backups.test.js`, `tripParticipants.test.js`); a filter such as `--test-name-pattern` would break them.
- **Random values (low).** Unique emails use `Date.now()` (`passwordSetupRequest.test.js:67`); two in the same millisecond would collide, unlikely.

## 4. Slow or duplicated tests

- Each of the 94 route files is its own process and boots the whole app and connects to Postgres, then tears down (`helpers.js:29-60`). A large share of the 7 minutes is start-up and the 10-second pool wait that `stopServer` avoids. Merging tiny files by theme (e.g. `passwordSetupRequest`, `passwordSetupValidate`, `passwordValidation`, `forgotPassword`) would cut boots.
- The largest files, `guestScope.test.js` (1,096 lines), `careTeam.test.js` (993) and `dispatches.test.js` (854), build their fixtures per test; sharing one set per `describe` would be faster.
- Sign-in is covered three times: route tests, `frontend/src/pages/Login.test.jsx`, and `auth.spec.js`/`auth-boundary.spec.js`. Keep the route and e2e versions; trim the others to what only they can see.
- `e2e` runs the feature-switching specs serially in a second project (`package.json`: `--workers=1`); that is the long pole. Moving feature on/off checks to route tests (`featureGates`, `featuresOff` already exist) and keeping one e2e smoke per switch would help.
- `accessibility.spec.js`, `contrast.spec.js` and `mobile-layout.spec.js` each visit the same pages; one shared walk could serve all three.

## 5. Guard tests (scan the source)

| Guard | Status |
|---|---|
| `backend/test/plainWords.test.js` (old vocabulary) | Works as its comment says, but a fixed list of 22 phrases: only catches exact wording, and skips lines beginning with `//`, `*`. Low. |
| `frontend/src/iconButtons.test.js` (symbol-only buttons) | Reads all source files; works. |
| `frontend/src/navLinksResolve.test.js` (nav links resolve) | Weaker than its comment: any route anywhere with a matching name or prefix satisfies a link (`some(d => d.startsWith(rel))`), and `/admin` is skipped. If the pattern `to: "/admin..."` stops matching, it finds zero links and still passes. Medium. |
| `backend/test/emailSenders.test.js` (every email sender declares what happens with email off) | Works; catches only direct `require("./email")`. |
| `backend/test/tileCsp.test.js`, `seedSafety.test.js`, `demoGuard.test.js` | Read single files for one specific fact; fine. |
| ESLint rule in `eslint.config.js:147` (no local-time date getters) | Strong, enforced in CI. |

**Written rules and their guards**
- No `window.confirm()` / `prompt()`: **not guarded.** `no-alert` is not in `eslint.config.js`. Currently clean by grep, nothing keeps it so. Medium.
- Relative URLs only (no hardcoded origin): **not guarded.** Source has external links (calendar, help guides) which is fine, but no scan separates those from the app's own address. Medium.
- No hard-coded church name/colours: **not guarded.** `plainWords` only checks internal vocabulary. Medium.
- Migrations never hand-written: **not guarded.** `ci.yml` has no check; only one `init` migration exists (squashed pre-release, by design). Low now, higher at 1.0.
- Documentation links: **guarded** (`npm run check:docs`, `ci.yml` lint job).

## 6. Skipped or disabled tests, and CI steps allowed to fail

- No `describe.skip`, `it.skip`, `test.fixme` or `todo`. Two conditional skips: `firstAdminSetup.test.js:49,69` and `support-preferences.spec.js:49` (see section 2).
- `continue-on-error` and `|| true`: **none** in `.github/workflows/`.
- Lint gates on errors only (`--quiet`, `ci.yml`); warnings are deliberately ignored.

## What to fix first (by harm if left untested)
1. Upgrades: a migration applied to a populated database.
2. Private files and photos reachable by an outsider.
3. The conditional and swallowed checks that hide failures (section 2).
4. Hard-coded church details and un-guarded repo rules (confirm dialogs, absolute URLs).
5. Route tests and e2e under a non-UTC timezone.
6. Flake sources: leftover rows, sleeps.
7. Speed: merge small route files, share fixtures.

## Follow-up issues
1. **Test that upgrading a populated database works.** Load a realistic set of rows, run migrations from the previous release, and check the app and `schemaCheck` still agree. Today CI only migrates an empty database.
2. **Test that private partner files cannot be downloaded by outsiders.** Cover the files route the way `photos.test.js` covers photos: public, private, restricted, signed-out, guest.
3. **Make the checks that can silently skip actually fail.** Remove the conditionals at `notifications.test.js:295-305`, `systemInfo.test.js:45`, `features.test.js:119`, and the swallowed wait at `AdminLayout.test.jsx:92`. Make the self-skipping tests report loudly in CI if they skip.
4. **Add guards for the written rules.** Turn on `no-alert`, add a scan for hard-coded church names and own-origin URLs, and a check that every migration came from `prisma migrate`. Each is a short test or lint rule.
5. **Run route tests and e2e in a US timezone.** Add `TZ: America/Los_Angeles` to those CI steps, as the unit job already does, so date bugs west of UTC show up.
6. **Give two-factor setup and disable their own tests.** Cover `/mfa/setup`, `/mfa/verify-setup` and `/mfa/disable` in `routes/auth.js` directly, including failure cases.
7. **Tighten the nav-link guard.** Fail when zero links are found, match settings pages only against settings routes, and stop skipping `/admin`.
8. **Make route tests clean up after themselves.** Replace swallowed `.catch(() => {})` cleanup with a failing check, and stop relying on counts that other files can change.
9. **Cut route-suite and e2e time.** Merge tiny route files, share fixtures in the three biggest files, trim triple sign-in coverage, and combine the three page-walking accessibility specs.
