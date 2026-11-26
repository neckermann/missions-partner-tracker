// WhatsApp-only posting (Prayer Requests, One-Time Needs, Newsletters, each to
// its configured group in one community), its schedule check and stamping.
// Sibling of groupmeChannel.js; the socket lives in whatsappClient.js.
//
// Schedule: shares GroupMe's daily hour (ChurchSettings.chatDispatchHour) and
// content-type mutes but has its own dedupe cursor (lastWhatsappChatDispatchSentAt)
// and row stamp (whatsappDispatchedAt), so one channel being down never blocks
// or double-stamps the other.
//
// Text comes from buildBlurb()'s groupmeText (channel-neutral despite the name),
// so restricted-partner masking and review gating are inherited. WhatsApp allows
// longer messages, so related blurbs are packed into one.
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { buildBlurb } = require("./dispatchBlurbs");
const { CHANNELS, isEligibleForChannel } = require("./dispatchEligibility");
const { shouldFlushDailyChatChannel } = require("./chatSchedule");
const { splitLongText, packMessages } = require("./messagePacking");
const whatsappClient = require("./whatsappClient");

// WhatsApp's documented Business API text limit is 4,096 characters. The Web
// protocol (Baileys) reportedly allows more, undocumented, so stay under this.
const MAX_MESSAGE_LENGTH = 4000;

// Single source of truth for which ChurchSettings group column serves which
// content type. GROUP_FIELD_BY_EVENT_TYPE (by row type, for eligibility/clearing)
// and GROUP_FIELD_BY_TOPIC_KEY (by blurb topicKey, GroupMe's field name reused as
// a channel-neutral label, for posting) are derived from it so they can't drift.
const GROUP_MAPPINGS = [
  {
    whatsappField: "whatsappPrayerGroupId",
    topicKey: "groupmePrayerTopicId",
    eventTypes: ["prayerRequestCreated", "prayerRequestAnswered"],
  },
  {
    whatsappField: "whatsappOneTimeNeedGroupId",
    topicKey: "groupmeOneTimeNeedTopicId",
    eventTypes: ["supportNeedCreated", "supportNeedDecided"],
  },
  {
    whatsappField: "whatsappNewsletterGroupId",
    topicKey: "groupmeNewsletterTopicId",
    eventTypes: ["newsletterCreated"],
  },
  {
    whatsappField: "whatsappCareGroupId",
    topicKey: "groupmeCareTopicId",
    eventTypes: ["keyDateComing", "quietPartner", "updateToPassOn"],
  },
];
const GROUP_FIELD_BY_EVENT_TYPE = Object.fromEntries(
  GROUP_MAPPINGS.flatMap((m) => m.eventTypes.map((type) => [type, m.whatsappField]))
);
const GROUP_FIELD_BY_TOPIC_KEY = Object.fromEntries(GROUP_MAPPINGS.map((m) => [m.topicKey, m.whatsappField]));

// The group a content-type field resolves to: its own pick, else the community's
// Announcements group (whatsappAnnouncementGroupId, resolved when the community is
// picked). With neither, the type has nowhere to go. Shared by hasWhatsAppTarget
// and postToWhatsApp, which key into the same fields differently.
function effectiveGroupId(field, settings) {
  if (!field) return null;
  return settings?.[field] || settings?.whatsappAnnouncementGroupId || null;
}

function resolveWhatsAppGroupId(row, settings) {
  return effectiveGroupId(GROUP_FIELD_BY_EVENT_TYPE[row.type], settings);
}

// True when this row's content type resolves to some WhatsApp group. Used by
// dispatchOrchestrator.js clearDispatchRecords so rows aren't held forever.
//
// Deliberately does NOT check whether WhatsApp is currently paired: every deploy
// has a brief reconnect window where whatsappPairedAt is null, and clearing would
// treat it as a permanent "off". A real unlink clears every group field (see
// routes/settings.js POST /whatsapp/unlink), so "a group resolves" is the stable
// signal. runWhatsAppPass checks getStatus() separately.
function hasWhatsAppTarget(row, settings) {
  return Boolean(resolveWhatsAppGroupId(row, settings));
}

// Takes already-eligible DispatchRecord rows, builds each blurb and posts to its
// type's group. Returns the Set of row ids that posted; one group failing (left
// the group, anti-ban pause) must not stop other rows stamping whatsappDispatchedAt.
async function postToWhatsApp(eligibleRows, partnerById, settings) {
  const sentIds = new Set();

  const blurbs = eligibleRows
    .map((row) => buildBlurb(row, partnerById.get(row.partnerId), settings))
    .filter((blurb) => blurb?.groupmeText); // e.g. a newsletter that never resolved a link has nothing to send

  // Group by destination group id so two types sharing a group pack into shared messages.
  const byGroup = new Map();
  for (const blurb of blurbs) {
    const field = GROUP_FIELD_BY_TOPIC_KEY[blurb.topicKey];
    const groupId = effectiveGroupId(field, settings);
    if (!groupId) continue; // no group picked, and no Announcements fallback -- not sent
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push(blurb);
  }

  for (const [groupId, groupBlurbs] of byGroup) {
    const failedParts = new Set();
    for (const message of packMessages(groupBlurbs, MAX_MESSAGE_LENGTH)) {
      if (message.partOf && failedParts.has(message.partOf)) continue;
      try {
        await whatsappClient.sendText(groupId, message.text);
        message.completes.forEach((id) => sentIds.add(id));
      } catch (err) {
        // One message's failure must not stop the pass; its rows stay queued.
        // Log the reason, never the text. Recorded for the "Dispatch send failures" notification.
        console.error("WhatsApp post failed:", err.message);
        await prisma.dispatchRecord.updateMany({
          where: { id: { in: message.completes } },
          data: { whatsappError: err.message },
        });
        if (message.partOf) failedParts.add(message.partOf);
      }
    }
  }

  return sentIds;
}

// Same daily-hour rule as GroupMe's shouldFlushGroupMe (chatSchedule.js), with WhatsApp's own cursor.
function shouldFlushWhatsApp(settings, now) {
  return shouldFlushDailyChatChannel(settings, now, "lastWhatsappChatDispatchSentAt");
}

// Schedule check + pass. No-op if the feature is off, the hour/dedupe gate fails,
// or the number isn't connected; in that last case the cursor is NOT stamped so
// the next minute retries within the same hour.
async function runWhatsAppPass(settings, now) {
  if (!isFeatureEnabled(settings?.enabledFeatures, "whatsapp")) return;
  if (!shouldFlushWhatsApp(settings, now)) return;
  if (whatsappClient.getStatus().status !== "connected") return;

  const rows = await prisma.dispatchRecord.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length > 0) {
    const partners = await prisma.partner.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
      select: { id: true, displayName: true, fieldDisplayName: true, isRestricted: true, isPublic: true },
    });
    const partnerById = new Map(partners.map((p) => [p.id, p]));

    const eligibleRows = rows.filter(
      (row) =>
        !row.whatsappDispatchedAt &&
        hasWhatsAppTarget(row, settings) &&
        isEligibleForChannel(row, CHANNELS.WHATSAPP, partnerById.get(row.partnerId), settings, true)
    );
    if (eligibleRows.length > 0) {
      const sentIds = await postToWhatsApp(eligibleRows, partnerById, settings);
      if (sentIds.size > 0) {
        await prisma.dispatchRecord.updateMany({
          where: { id: { in: [...sentIds] } },
          data: { whatsappDispatchedAt: now, whatsappError: null },
        });
      }
    }
  }

  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { lastWhatsappChatDispatchSentAt: now },
  });
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  GROUP_FIELD_BY_EVENT_TYPE,
  hasWhatsAppTarget,
  splitLongText,
  packMessages,
  postToWhatsApp,
  shouldFlushWhatsApp,
  runWhatsAppPass,
};
