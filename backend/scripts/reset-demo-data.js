// Wipes and reseeds the database with fresh fake data, for a public demo deployment that resets
// on a schedule (see ADMIN_GUIDE.md § Demo mode). Requires DEMO_ADMIN_EMAIL/DEMO_ADMIN_PASSWORD
// so a misconfigured demo can't reset into a state nobody can log into. Also reads the optional
// JOSHUA_PROJECT_API_KEY, ANTHROPIC_API_KEY, GROUPME_* and Postmark/webhook vars to restore
// those integrations after the reset wipes ChurchSettings. Safe to run manually (`npm run
// demo:reset`) or via the opt-in POST /api/demo/reset route.
require("dotenv").config({ quiet: true });
const path = require("path");
const { execFileSync } = require("child_process");
const prisma = require("../src/prismaClient");
const { FEATURE_KEYS } = require("../src/utils/features");
const { demoDisabledFeatureFlags, isGuardedDemo } = require("../src/utils/demoMode");
const { encryptField } = require("../src/utils/crypto");
const { listGroups, listTopics } = require("../src/utils/groupmeChannel");

const BACKEND_DIR = path.join(__dirname, "..");

function run(cmd, args, { shell = false } = {}) {
  execFileSync(cmd, args, { cwd: BACKEND_DIR, stdio: "inherit", env: process.env, shell });
}

// GROUPME_* env vars give a group/topic *name*, not an id, so this does the same live lookup and
// match-by-name as the settings UI (routes/settings.js). Returns null (and logs why) rather than
// throwing: a demo reset must still succeed if GroupMe is unreachable or a name is stale.
async function resolveGroupmeConfig() {
  const accessToken = process.env.GROUPME_ACCESS_TOKEN;
  const groupName = process.env.GROUPME_GROUP_NAME;
  if (!accessToken || !groupName) return null;

  try {
    const groups = await listGroups(accessToken);
    const group = groups.find((g) => g.name === groupName);
    if (!group) {
      console.warn(`GroupMe setup skipped -- no group named "${groupName}" for this access token.`);
      return null;
    }

    const topics = await listTopics(accessToken, group.id);
    const findTopic = (envVar) => {
      const name = process.env[envVar];
      if (!name) return null;
      const topic = topics.find((t) => t.name === name);
      if (!topic) {
        console.warn(
          `GroupMe topic "${name}" (${envVar}) not found in group "${groupName}" -- leaving unset.`
        );
      }
      return topic;
    };

    return {
      accessToken,
      groupId: group.id,
      groupName: group.name,
      prayerTopic: findTopic("GROUPME_PRAYER_NAME"),
      needTopic: findTopic("GROUPME_ONETIME_NEEDS_NAME"),
      newsletterTopic: findTopic("GROUPME_NEWSLETTER_NAME"),
    };
  } catch (err) {
    console.warn(`GroupMe setup skipped -- couldn't reach the GroupMe API: ${err.message}`);
    return null;
  }
}

async function resetDemoData() {
  const email = process.env.DEMO_ADMIN_EMAIL;
  const password = process.env.DEMO_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD must both be set to reset demo data");
  }

  // Snapshot the live WhatsApp session before `migrate reset` wipes it, so a throwaway
  // dev/demo site doesn't need a fresh QR scan on every reset. Only for this script's
  // self-reset flow: a real backup/restore deliberately never carries it (see ADMIN_GUIDE.md),
  // so a leaked backup can't hijack a linked device. `whatsappPairedAt` signals that there is
  // a session worth keeping.
  const existingAuthEntries = await prisma.whatsAppAuthEntry.findMany({ select: { key: true, value: true } });
  const existingWhatsAppSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      whatsappPhoneNumber: true,
      whatsappPairedAt: true,
      whatsappCommunityId: true,
      whatsappCommunityName: true,
      whatsappAnnouncementGroupId: true,
      whatsappAnnouncementGroupName: true,
      whatsappPrayerGroupId: true,
      whatsappPrayerGroupName: true,
      whatsappOneTimeNeedGroupId: true,
      whatsappOneTimeNeedGroupName: true,
      whatsappNewsletterGroupId: true,
      whatsappNewsletterGroupName: true,
    },
  });
  // A guarded public demo does not keep a linked WhatsApp number across resets (the reset unlinks it).
  const whatsappSnapshot =
    existingWhatsAppSettings?.whatsappPairedAt && !isGuardedDemo() ? existingWhatsAppSettings : null;

  // Drops and recreates the schema from migrations, rather than maintaining a cascade-aware
  // deleteMany order. `npx` is a .cmd file on Windows, which Node can't launch without a shell
  // (EINVAL otherwise); the shell is scoped to this one call, which takes no variable or
  // sensitive arguments. The `node` calls below, one of which takes the admin email/password,
  // run without a shell, so execFileSync passes args through with no injection risk.
  //
  // No --skip-seed/--skip-generate: Prisma 7's `migrate reset` has neither flag and doesn't
  // auto-run the configured seed, so the explicit `node prisma/seed.js` below can't
  // double-seed.
  run("npx", ["prisma", "migrate", "reset", "--force"], {
    shell: process.platform === "win32",
  });

  // Admin and Church Settings are created before the seed step: seed.js reads both (the admin
  // for created/updatedBy attribution, ChurchSettings to decide which missionaries are "sent
  // by our church") and silently treats either as absent if missing.
  run("node", ["prisma/createAdmin.js", email, password]);

  // createAdmin.js never sets a cadence: it is shared with a real church's first-admin
  // bootstrap, which must not auto-subscribe someone to email. The demo admin is different:
  // DEMO_ADMIN_EMAIL is a real inbox the operator reads, so subscribing it lets a reset double
  // as a live end-to-end send test. The other seeded users stay unsubscribed (seed.js
  // ADDITIONAL_USERS): their @example.org addresses are fake.
  await prisma.user.update({
    where: { email: email.toLowerCase().trim() },
    data: { cadence: "biweekly" },
  });

  // The "this is a live demo, here's how to log in" message is rendered by DemoBanner.jsx from
  // DEMO_RESET_TOKEN/DEMO_ADMIN_EMAIL/DEMO_ADMIN_PASSWORD (routes/publicSettings.js), so
  // churchName/publicTagline/aboutText stay free to show a real church's branding.
  //
  // `migrate reset` empties ChurchSettings, so every registry feature (src/utils/features.js)
  // is turned back on explicitly: aiExtraction defaults to off, and a visitor should see the
  // whole app working.
  //
  // The Joshua Project and Anthropic keys live in ChurchSettings (admin-managed), which the
  // reset wipes; the env vars are this demo's own billable keys, set on the Render service and
  // never committed. Their feature toggles are turned on only when the matching key exists, as
  // are GroupMe and Postmark: a toggle with no key behind it does nothing or errors on click,
  // which is worse than starting off.
  //
  // A guarded public demo (utils/demoMode.js) never gets the paid or outward-facing keys back (Anthropic,
  // GroupMe, Postmark), even if the service still has them set: a visitor could spend them or post to a
  // real group. Those features simply stay off there. The owner's own test deployment
  // (DEMO_TESTING_SITE=true) restores them as before.
  const guarded = isGuardedDemo();
  if (guarded) console.log("Guarded public demo: not restoring the Anthropic, GroupMe or Postmark keys.");
  const joshuaProjectApiKey = process.env.JOSHUA_PROJECT_API_KEY;
  const anthropicApiKey = guarded ? undefined : process.env.ANTHROPIC_API_KEY;
  const groupmeConfig = guarded ? null : await resolveGroupmeConfig();

  // Postmark's server token covers sending and receiving, but sending needs a From address and
  // receiving needs the inbound webhook's basic-auth credentials (routes/inboundEmail.js).
  // Pointing Postmark's inbound webhook at /api/inbound-email/postmark is done by hand in
  // Postmark's dashboard; it isn't stored in ChurchSettings.
  const postmarkApiKey = guarded ? undefined : process.env.POSTMARK_API_KEY;
  const fromEmailAddress = guarded ? undefined : process.env.FROM_EMAIL_ADDRESS;
  const webhookUsername = guarded ? undefined : process.env.WEBHOOK_USERNAME;
  const webhookPassword = guarded ? undefined : process.env.WEBHOOK_PASSWORD;
  const outboundEmailReady = Boolean(postmarkApiKey && fromEmailAddress);
  const inboundEmailReady = Boolean(postmarkApiKey && webhookUsername && webhookPassword);

  const enabledFeatures = {
    ...Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])),
    joshuaProject: Boolean(joshuaProjectApiKey),
    aiExtraction: Boolean(anthropicApiKey),
    groupme: Boolean(groupmeConfig),
    outboundEmail: outboundEmailReady,
    inboundEmail: inboundEmailReady,
    // Features a demo never turns on (it must not email its fake seeded accounts); see
    // utils/demoMode.js.
    ...demoDisabledFeatureFlags(),
  };
  const integrationKeys = {
    ...(joshuaProjectApiKey ? { joshuaProjectApiKey: encryptField(joshuaProjectApiKey) } : {}),
    ...(anthropicApiKey ? { anthropicApiKey: encryptField(anthropicApiKey) } : {}),
    ...(groupmeConfig
      ? {
          groupmeAccessToken: encryptField(groupmeConfig.accessToken),
          groupmeGroupId: groupmeConfig.groupId,
          groupmeGroupName: groupmeConfig.groupName,
          ...(groupmeConfig.prayerTopic
            ? {
                groupmePrayerTopicId: groupmeConfig.prayerTopic.id,
                groupmePrayerTopicName: groupmeConfig.prayerTopic.name,
              }
            : {}),
          ...(groupmeConfig.needTopic
            ? {
                groupmeOneTimeNeedTopicId: groupmeConfig.needTopic.id,
                groupmeOneTimeNeedTopicName: groupmeConfig.needTopic.name,
              }
            : {}),
          ...(groupmeConfig.newsletterTopic
            ? {
                groupmeNewsletterTopicId: groupmeConfig.newsletterTopic.id,
                groupmeNewsletterTopicName: groupmeConfig.newsletterTopic.name,
              }
            : {}),
        }
      : {}),
    ...(postmarkApiKey ? { postmarkServerToken: encryptField(postmarkApiKey) } : {}),
    ...(fromEmailAddress ? { emailFromAddress: fromEmailAddress } : {}),
    ...(webhookUsername ? { inboundEmailWebhookUsername: webhookUsername } : {}),
    ...(webhookPassword ? { inboundEmailWebhookPassword: encryptField(webhookPassword) } : {}),
    // The address partners send newsletters to; matches the `To:` header on the seeded
    // inbound .eml fixtures (seed.js buildFakeEml/seedUnmatchedEmails). Informational only.
    inboundEmailAddress: "receive@updates.missionspartnertracker.com",
  };

  // Filled in beyond churchName: the Sending Church auto-fill (routes/partners.js
  // syncSendingChurch) copies these into every seeded "sent by us" missionary, so blank fields
  // would show a mostly empty Sending Church box.
  const churchDetails = {
    churchName: "Missions Partner Tracker Demo",
    contactFirstName: "Alex",
    contactLastName: "Morgan",
    contactEmail: "missions@example.org",
    phone: "(309) 555-0100",
    websiteLink: "https://missions.example.org",
    addressLine1: "100 Fellowship Way",
    city: "Rock Island",
    stateProvinceRegion: "IL",
    postalCode: "61201",
    country: "USA",
    publicTagline: "Supporting our missionary and organization partners around the world",
    aboutText:
      "We partner with missionaries and organizations serving around the world, supporting them in prayer, finances, and care.",
    // Set explicitly: this demo is a US-based church and should show a US timezone, not
    // whatever the schema default is.
    timezone: "America/Chicago",
    // On for the demo (default false) so visitors can see the restricted-partner review
    // workflow in Pending Dispatches.
    allowRestrictedPartnerDispatch: true,
    // The demo's seeded and shared accounts have no authenticator, and visitors must sign in
    // with just a password. Switched off on every reset so a requirement turned on by a
    // first-run /setup can't outlive it; isTwoFactorRequired() also ignores the setting on a
    // demo.
    requireTwoFactor: false,
  };

  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      ...churchDetails,
      enabledFeatures,
      ...integrationKeys,
      ...whatsappSnapshot,
      demoMode: true,
    },
    update: { ...churchDetails, enabledFeatures, ...integrationKeys, ...whatsappSnapshot, demoMode: true },
  });

  // Restore the WhatsApp session snapshotted before the reset. The table is empty again, so
  // this is a plain recreate. Each `value` is already an encryptField() ciphertext
  // (whatsappAuthState.js), copied as-is.
  if (whatsappSnapshot && existingAuthEntries.length > 0) {
    await prisma.whatsAppAuthEntry.createMany({ data: existingAuthEntries });
  }

  // Seeded last, so the admin and Church Settings exist for it to read.
  run("node", ["prisma/seed.js"]);
}

if (require.main === module) {
  resetDemoData()
    .then(() => {
      console.log("Demo data reset complete.");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { resetDemoData };
