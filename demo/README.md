# Operating the live demo

This folder holds the operational details for the one live public demo
(`missions-partner-tracker.onrender.com`) -- not the generic one-click
"Deploy to Render" blueprint any church uses to self-host their own
instance (that's `/render.yaml` at the repo root). It exists purely so
this information survives in version control instead of living only in
the Render dashboard or a maintainer's own machine.

- **`.env`** (gitignored, real secrets) -- the env vars `backend/scripts/
reset-demo-db-remote.js` needs to recover the live demo database
  directly from a local machine, plus the same integration keys
  (GroupMe, Postmark, Pexels, etc.) `reset-demo-data.js` restores into
  `ChurchSettings` on every reset. Never commit this file -- `.gitignore`
  already excludes every `.env`/`.env.*` anywhere in the repo.
- **`render.yaml`** -- the demo's own Render Blueprint: the production
  web service (which also runs the scheduled jobs and the WhatsApp
  connection; there is no separate worker), plus the nightly reset cron job, including the four demo-only env vars
  (`DEMO_RESET_TOKEN`, `DEMO_ADMIN_EMAIL/PASSWORD`, `PEXELS_API_KEY`) that
  must never appear on a real church's instance -- all four stay on the
  web service only. Record-keeping only
  right now -- Render isn't actively syncing from this file; it's what to
  restore from if the demo's services were ever deleted and had to be
  rebuilt.

## Guest logins visitors can try

Besides the admin login (`DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD`), every
reset seeds two **published guest logins** so a visitor can see what a care
team member and a trip leader get. They are created by `seedCareTeamsDemo()`
in `backend/prisma/seed.js`, and **all three logins are listed in the demo
banner** at the top of the public pages (`DemoBanner.jsx`). The guest accounts
are defined once in `backend/src/utils/demoLogins.js`, which both the seed and
the banner read, so the banner always shows what the seed actually created:

| Login                          | Password                                             | What they see                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `care.member@<admin's domain>` | the same as the demo admin's (`DEMO_ADMIN_PASSWORD`) | Four partners they're on the care team for: the same partner page an editor has minus monthly funding, their own prayer requests and one-time needs (no decisions), Newsletters & Docs, and a read-only view of those partners' trips. What they enter is saved but held in Pending Dispatches until the admin approves it. |
| `trip.leader@<admin's domain>` | same                                                 | One upcoming trip they manage, plus its partner read-only. No needs, no money.                                                                                                                                                                                                                                              |

The demo also has the **Audit log** on, with example entries written by the seed
(`seedAuditLogDemo` in `backend/prisma/seed.js`): sign-ins, a couple of failed ones, a role
change, a guest's trip access given and removed, care team changes, settings changes, a backup
download, deletes, and views of a restricted partner. They sit inside the default 90-day
retention window, so a reset (which reseeds them) always leaves a populated page. Real activity
by visitors is recorded too, until the next reset.

It also has **last edited by** data (`seedLastEditedDemo`): most partners, trips, prayer
requests and needs carry a demo editor's name and a date within the last ten weeks, and about one
in seven is left blank, so the **Last updated** column on Partners and Trips has something to sort
and a record's "Last edited by" line something to show. The dates are relative to the reset.

The demo never requires two-factor: a shared, published account can't enrol an
authenticator without locking every other visitor out, so the church-wide
**Two-factor sign-in** switch (Manage Users, #385) is off on a demo and the app
refuses to turn it on while `DEMO_RESET_TOKEN` is set. Every reset sets it off in
`reset-demo-data.js`, and the sign-in check ignores a stored `true` while
`DEMO_RESET_TOKEN` is set, so nothing can lock visitors out. The other guests the
seed creates (for example the lapsed `sam.okafor@<admin's domain>`, who exists
to populate the "Inactive accounts only" filter) have a password nobody is
told. **The published logins also look alike**,
for simplicity: the guests' emails use the demo admin's email domain (so with
`DEMO_ADMIN_EMAIL=demo@missionspartnertracker.com` they are
`care.member@missionspartnertracker.com` and `trip.leader@missionspartnertracker.com`;
`example.org` if no admin email is set), and they share one password: the guests
use `DEMO_ADMIN_PASSWORD`. Set the
optional `DEMO_GUEST_PASSWORD` only if you want them to differ (the banner then
shows each one's password); never reuse any of these anywhere real.

## Passkeys can be tried on a demo; passwordless sign-in is off

A visitor can add and remove a **passkey** (#386) or an authenticator app on a demo, to see how it
works. Because the logins are shared, a demo never asks anyone for a second factor at sign-in, even
when one has been added, and adding or removing one doesn't end the sessions other visitors have
open. My account says so. The next reset removes whatever was added.

The one exception is the owner's own test deployment (the dev demo): set `DEMO_TESTING_SITE=true` (or the older, narrower `DEMO_ALLOW_PASSWORDLESS=true`) on its web service and an admin can switch it on there to try it (it needs an account with a passkey and working email, and the next reset turns it off again). **Never set it on a demo the public can reach**: it would end password sign-in for the shared logins.

The church-wide **Passwordless sign-in** switch is still refused and ignored on a demo (it also
needs working email, which a demo never has). It is shown in the documentation screenshots,
captured from a fixture install, rather than on the demo itself.

The seed leaves a finished trip that hasn't been wrapped up
("Harvest Week team"), so **Trips ready to wrap up** is on the bell and the **Wrap up trip**
wizard can be walked end to end; the older completed trips carry debriefs; partners carry support
preferences; the care team's contact timeline, updates to pass on and key-date alerts are
populated; and the trip applications carry answers to the church-wide and trip questions.

## What a guarded demo never does

A public demo (`DEMO_RESET_TOKEN` set) is **guarded**. Anyone can sign in with its published logins, so
it must not be able to hurt you or anyone else:

- **Nothing leaves the app.** Email (single and batch), GroupMe posts and WhatsApp messages are logged
  (`[demo] ... not sent`) and reported as sent, but never reach Postmark, GroupMe or WhatsApp.
- **No AI spend.** The AI request scan is refused (403).
- **No lock-out.** Changing a password (your own or another account's), sending a setup link and
  completing one are refused, so one visitor cannot sign the others out until the next reset.
- **No tampering with integrations.** Saving the GroupMe, Postmark, WhatsApp, Joshua Project or AI-key
  settings is refused.
- **A reset does not bring the keys back.** `reset-demo-data.js` ignores `ANTHROPIC_API_KEY`, `GROUPME_*`,
  `POSTMARK_API_KEY`, `FROM_EMAIL_ADDRESS` and the webhook values on a guarded demo (so those features stay
  off there) and unlinks any paired WhatsApp number. You can leave those variables set on the service; the
  guarded demo will not use them. Remove them anyway if you do not need them.

**The owner's own test deployment** (the dev demo) is the exception: set `DEMO_TESTING_SITE=true` on its
web service and none of the above applies, so you can try real sends and take screenshots of emails and
chat posts. It also stops the banner publishing that site's logins, so give it its own `DEMO_ADMIN_EMAIL`
and `DEMO_ADMIN_PASSWORD` (the published guest accounts use the admin password unless
`DEMO_GUEST_PASSWORD` is set; if neither is set they fall back to a default that is in this repository).
Set it on the web service only: there is no separate worker any more, so the scheduled jobs see the same
setting. The two remote reset scripts say which they are:
`reset-demo-db-remote.js` is always guarded, `reset-dev-db-remote.js` is always the test deployment.
Keep its address private anyway.

## What a demo never does (scheduled email)

A demo must not send email to its seeded accounts (they are fake addresses, so
the mail only bounces and spends the email plan). Two things guarantee that. The
reset script and the seed turn every feature on **except** the list in
`backend/src/utils/demoMode.js`, which is where a scheduled-email feature would
be kept off (today the list is empty). And the daily key-date job returns early
on a demo (`DEMO_RESET_TOKEN`, or the `demoMode` flag the reset writes, which the scheduled jobs also read), as do the other scheduled emails, so no schedule can email a demo's team members
even though **Key-date reminders are on**: a visitor sees the "Key dates coming
up" alert on the bell and Home page, but nothing is ever sent. To keep another
scheduled-email feature off a demo, add its key to that list.

## Recovering after a migration squash

This project's pre-1.0 convention squashes every schema change into one
baseline migration before it ships (see `CONTRIBUTING.md`). Squashing
replaces the migration folder(s) on disk with new ones the live demo's
own `_prisma_migrations` table has no record of, so the next deploy's
`preDeployCommand` (`prisma migrate deploy`) fails -- expected, not a
sign anything is broken. Render doesn't cut over on a failed pre-deploy,
so the demo stays up on the old version the whole time this is being
fixed.

Fix: `cd backend && npm run demo:reset:remote` for the live public demo,
or `npm run dev:reset:remote` for the dev-test service (both read
`demo/.env`, requires `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` set
to an explicit human confirmation -- see each script's own comment),
then retrigger the deploy. These are independent per RUNBOOK.md's own
note on this failure -- fixing one doesn't fix the other.
