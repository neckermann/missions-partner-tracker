// Wipes and reseeds the database with fresh fake data, for a public demo
// deployment that resets on a schedule (see ADMIN_GUIDE.md § Demo mode).
// Requires DEMO_ADMIN_EMAIL/DEMO_ADMIN_PASSWORD so a misconfigured demo
// can't reset into a state nobody can log into. Also reads
// JOSHUA_PROJECT_API_KEY, ANTHROPIC_API_KEY, the GROUPME_* vars, and the
// Postmark/webhook vars if set (all optional) to restore those
// integrations after the reset wipes ChurchSettings -- see the comments
// below. Safe to run manually (`npm run demo:reset`) or via the opt-in
// POST /api/demo/reset route.
require("dotenv").config({ quiet: true });
const path = require("path");
const { execFileSync } = require("child_process");
const prisma = require("../src/prismaClient");
const { FEATURE_KEYS } = require("../src/utils/features");
const { encryptField } = require("../src/utils/crypto");
const { listGroups, listTopics } = require("../src/utils/groupmeChannel");

const BACKEND_DIR = path.join(__dirname, "..");

function run(cmd, args, { shell = false } = {}) {
  execFileSync(cmd, args, { cwd: BACKEND_DIR, stdio: "inherit", env: process.env, shell });
}

// The admin's own GroupMe settings UI (routes/settings.js) resolves a
// group/topic by live API lookup, never a hand-typed id -- GROUPME_* env
// vars give this script a *name* for the group and each topic (the way
// a human would recognize them), not an id, so it has to do the same
// live lookup+match-by-name the UI does before it has anything to save.
// Returns null (and logs why) rather than throwing on anything that
// doesn't resolve -- a demo reset must still succeed even if GroupMe is
// unreachable or a name's gone stale, same reasoning the Joshua
// Project/Anthropic keys below are optional.
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

  // Drops and recreates the schema from migrations — simpler and more
  // robust than hand-maintaining a cascade-aware deleteMany order that
  // could drift as the schema evolves. `npx` is a .cmd file on Windows,
  // which Node genuinely cannot launch without a shell (confirmed: it
  // fails with EINVAL otherwise) — shell is scoped to just this one call,
  // which takes no variable/sensitive arguments, so there's nothing here
  // for an unescaped shell to matter for. The two `node` calls below (one
  // of which takes the admin email/password) run without a shell at
  // all — node.exe is a real executable, so execFileSync passes their
  // args through directly with no injection risk.
  //
  // No --skip-seed/--skip-generate here -- Prisma 7's `migrate reset`
  // removed both flags outright (not just renamed), and also stopped
  // auto-running the configured seed command on reset at all, so there's
  // no double-seed risk from the explicit `node prisma/seed.js` call
  // below.
  run("npx", ["prisma", "migrate", "reset", "--force"], {
    shell: process.platform === "win32",
  });

  // Admin and Church Settings are created *before* the seed step below --
  // seed.js reads both (an existing admin for created/updatedBy
  // attribution, an existing ChurchSettings row to decide which seeded
  // missionaries are marked "sent by our church") and silently treats
  // either as absent if they don't exist yet. They used to be created
  // after seeding, which meant every demo reset seeded with no admin
  // attribution and a 0% chance of any "sent by us" missionary, no matter
  // what seed.js's own odds said -- ChurchSettings didn't exist until the
  // very last step.
  run("node", ["prisma/createAdmin.js", email, password]);

  // The "this is a live demo, here's how to log in" message is no longer
  // stuffed into aboutText -- it's rendered by DemoBanner.jsx instead,
  // from DEMO_RESET_TOKEN/DEMO_ADMIN_EMAIL/DEMO_ADMIN_PASSWORD directly
  // (see routes/publicSettings.js), so churchName/publicTagline/aboutText
  // stay free to demonstrate what a real church's own branding looks
  // like, same as everywhere else in the seeded data.
  //
  // migrate reset above drops and recreates the schema, so ChurchSettings
  // starts empty every time -- every registry feature (see
  // src/utils/features.js) needs to be explicitly turned back on here,
  // not just left to its own default, since aiExtraction's default is off.
  // A visitor exploring the public demo should see the whole app working,
  // not accidentally find half of it toggled off.
  //
  // Same reasoning as DEMO_ADMIN_EMAIL/PASSWORD above: these two
  // integrations' API keys live in ChurchSettings now (admin-managed,
  // not env vars -- see each field's own comment in schema.prisma),
  // which `migrate reset` above wipes along with everything else. Both
  // env vars here are this demo's own real, billable keys, set directly
  // on the Render service and never committed anywhere in this repo.
  //
  // Their *feature* toggles are turned on only when the matching key is
  // actually present -- unlike every other feature above, which has no
  // key to be missing in the first place, flipping one of these two on
  // with no key saved would show a toggle that does nothing (Joshua
  // Project) or errors on click (AI scanning), which is worse than just
  // leaving it off until the key shows up on a later reset. GroupMe and
  // Postmark (sending/receiving) get the exact same treatment below, for
  // the exact same reason -- a visitor flipping to a "configured"-looking
  // GroupMe/Email page with nothing actually behind it is a worse demo
  // than the toggle honestly starting off.
  const joshuaProjectApiKey = process.env.JOSHUA_PROJECT_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const groupmeConfig = await resolveGroupmeConfig();

  // Postmark's own server token covers both sending and receiving, but
  // each direction needs its own extra piece before it actually works:
  // sending needs a From address, receiving needs the inbound webhook's
  // own basic-auth credentials (checked in routes/inboundEmail.js) --
  // Postmark's inbound webhook itself still has to be pointed at this
  // demo's /api/inbound-email/webhook URL by hand in Postmark's own
  // dashboard; that's not something stored in ChurchSettings at all.
  const postmarkApiKey = process.env.POSTMARK_API_KEY;
  const fromEmailAddress = process.env.FROM_EMAIL_ADDRESS;
  const webhookUsername = process.env.WEBHOOK_USERNAME;
  const webhookPassword = process.env.WEBHOOK_PASSWORD;
  const outboundEmailReady = Boolean(postmarkApiKey && fromEmailAddress);
  const inboundEmailReady = Boolean(postmarkApiKey && webhookUsername && webhookPassword);

  const enabledFeatures = {
    ...Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])),
    joshuaProject: Boolean(joshuaProjectApiKey),
    aiExtraction: Boolean(anthropicApiKey),
    groupme: Boolean(groupmeConfig),
    outboundEmail: outboundEmailReady,
    inboundEmail: inboundEmailReady,
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
  };

  // Filled in beyond just churchName -- this is also what the Sending
  // Church auto-fill/sync (see routes/partners.js's syncSendingChurch)
  // copies into every seeded "sent by us" missionary below, so leaving
  // phone/contactName/contactEmail/websiteLink/address blank here meant
  // every one of those demo partners showed a Sending Church box that was
  // mostly empty too.
  const churchDetails = {
    churchName: "Missions Partner Tracker Demo",
    contactName: "Alex Morgan",
    contactEmail: "missions@example.org",
    phone: "(309) 555-0100",
    websiteLink: "https://missions.example.org",
    address: {
      addressLine1: "100 Fellowship Way",
      city: "Rock Island",
      stateProvinceRegion: "IL",
      postalCode: "61201",
      country: "USA",
    },
    publicTagline: "Supporting our missionary and organization partners around the world",
    aboutText:
      "We partner with missionaries and organizations serving around the world, supporting them in prayer, finances, and care.",
    // Set explicitly rather than left to schema.prisma's own default --
    // this demo is itself a real example of a US-based church, so it
    // should show a real US timezone, not whatever the schema default
    // happens to be at the moment (which exists for a church that's never
    // touched this setting at all, a different case from this one).
    timezone: "America/Chicago",
    // Defaults to false for a real church (see schema.prisma's own
    // comment on this field) -- turned on here so a demo visitor can
    // actually see the restricted-partner review workflow in Pending
    // Notifications instead of that content being silently unrecorded.
    allowRestrictedPartnerNotifications: true,
  };

  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...churchDetails, enabledFeatures, ...integrationKeys },
    update: { ...churchDetails, enabledFeatures, ...integrationKeys },
  });

  // Seeded last, now that both the admin and Church Settings above exist
  // for it to read.
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
