// WhatsApp-only: posting (Prayer Requests, One-Time Needs, and
// Newsletters each to their own configured group inside one WhatsApp
// community), its schedule check, and its own stamping. The sibling of
// groupmeChannel.js -- same shape, same one-way dependencies, so
// emailDispatchScheduler.js composes the two identically. The socket itself lives
// in whatsappClient.js; nothing here touches Baileys directly.
//
// Schedule: WhatsApp shares GroupMe's daily send hour
// (ChurchSettings.chatDispatchHour) and its three content-type mutes,
// but has its own dedupe cursor (lastWhatsappChatDispatchSentAt) and its
// own per-row stamp (whatsappDispatchedAt). A church that turns both
// channels on simply gets both posting at the same hour; one being down
// never blocks or double-stamps the other.
//
// Message text comes from buildBlurb()'s groupmeText -- the one place
// restricted-partner masking and review gating are decided, so WhatsApp
// inherits all of it with no extra code (the field is channel-neutral chat
// text despite its name). Only the packing differs: WhatsApp allows much
// longer messages, so several related blurbs collapse into one message.
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { buildBlurb } = require("./dispatchBlurbs");
const { CHANNELS, isEligibleForChannel } = require("./dispatchEligibility");
const { shouldFlushDailyChatChannel } = require("./chatSchedule");
const { splitLongText, packMessages } = require("./messagePacking");
const whatsappClient = require("./whatsappClient");

// WhatsApp's documented text limit through the Business API is 4,096
// characters. The regular app / Web protocol (what Baileys speaks)
// reportedly allows far more, but that isn't documented anywhere
// authoritative, so stay safely under the documented figure.
const MAX_MESSAGE_LENGTH = 4000;

// Single source of truth for which ChurchSettings group column serves
// which content type. GROUP_FIELD_BY_EVENT_TYPE (keyed by the
// DispatchRecord row type, for eligibility/clearing which look at raw
// rows) and GROUP_FIELD_BY_TOPIC_KEY (keyed by a blurb's topicKey --
// GroupMe's own ChurchSettings field name, reused as a channel-neutral
// label -- for posting, which looks at blurbs) are both DERIVED from
// this one list so the two can never drift out of sync with each other
// the way two hand-maintained copies could.
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
];
const GROUP_FIELD_BY_EVENT_TYPE = Object.fromEntries(
  GROUP_MAPPINGS.flatMap((m) => m.eventTypes.map((type) => [type, m.whatsappField]))
);
const GROUP_FIELD_BY_TOPIC_KEY = Object.fromEntries(GROUP_MAPPINGS.map((m) => [m.topicKey, m.whatsappField]));

// The group a content-type field resolves to: its own picked group, or
// -- same idea as GroupMe's main-group fallback -- the community's
// Announcements group (whatsappAnnouncementGroupId, auto-resolved when
// the community is picked; see whatsappClient.js's
// findAnnouncementGroup and routes/settings.js's PUT /whatsapp). Only
// with neither set does a type have nowhere to go. Shared by
// hasWhatsAppTarget (keyed by row.type via GROUP_FIELD_BY_EVENT_TYPE)
// and postToWhatsApp (keyed by a blurb's topicKey via
// GROUP_FIELD_BY_TOPIC_KEY) -- same fallback rule, two different lookup
// keys into the same settings fields.
function effectiveGroupId(field, settings) {
  if (!field) return null;
  return settings?.[field] || settings?.whatsappAnnouncementGroupId || null;
}

function resolveWhatsAppGroupId(row, settings) {
  return effectiveGroupId(GROUP_FIELD_BY_EVENT_TYPE[row.type], settings);
}

// True when this row's content type resolves to some WhatsApp
// group -- its own pick or the Announcements fallback.
// dispatchOrchestrator.js's clearDispatchRecords uses this to avoid
// holding a row in the queue forever when neither is ever going to
// exist.
//
// Deliberately does NOT check whether WhatsApp is *currently* paired --
// an earlier version did, and it was a real bug: every deploy causes a
// brief, normal reconnect window where whatsappPairedAt is momentarily
// null even though the number is coming right back, and clearing
// treated that exactly like a deliberate, permanent "off." A real
// deliberate unlink already clears every group field (including the
// Announcements fallback) too (see routes/settings.js's POST
// /whatsapp/unlink), so "a group resolves" is the correct, stable
// signal for "this church still wants this channel for this content
// type" -- it survives a transient reconnect and correctly goes false
// on a real unlink. The one caller that actually needs "is it connected
// right now" (runWhatsAppPass) already has its own separate, more
// precise whatsappClient.getStatus() check upstream of this one, same
// as sendWhatsAppUrgent in dispatchOrchestrator.js -- this function
// was never their only guard against sending while disconnected.
function hasWhatsAppTarget(row, settings) {
  return Boolean(resolveWhatsAppGroupId(row, settings));
}

// Takes already-eligible DispatchRecord rows (the caller filtered through
// isEligibleForChannel), builds each row's blurb, and posts to each type's
// own configured group. Returns the Set of row ids that actually posted --
// one group failing (not a member any more, anti-ban pause) must not stop
// rows headed elsewhere from stamping whatsappDispatchedAt.
async function postToWhatsApp(eligibleRows, partnerById, settings) {
  const sentIds = new Set();

  const blurbs = eligibleRows
    .map((row) => buildBlurb(row, partnerById.get(row.partnerId)))
    .filter((blurb) => blurb?.groupmeText); // e.g. a newsletter that never resolved a link has nothing to send

  // Group by destination group id, so two types mapped to the same
  // WhatsApp group still pack into shared messages.
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
        // One message's failure must never stop the rest of the pass --
        // those rows just stay queued for the next one. Log the reason,
        // never the text.
        console.error("WhatsApp post failed:", err.message);
        if (message.partOf) failedParts.add(message.partOf);
      }
    }
  }

  return sentIds;
}

// Same daily-hour rule as GroupMe's shouldFlushGroupMe (shared via
// chatSchedule.js), reading the shared hour but WhatsApp's own cursor.
function shouldFlushWhatsApp(settings, now) {
  return shouldFlushDailyChatChannel(settings, now, "lastWhatsappChatDispatchSentAt");
}

// WhatsApp's schedule check + pass. A no-op if the feature's off, the
// hour/dedupe gate doesn't pass, or the number isn't currently connected --
// in that last case the cursor is deliberately NOT stamped, so the next
// minute's tick retries within the same hour instead of waiting a day
// (connections drop and come back routinely; a missed hour shouldn't mean a
// missed day).
async function runWhatsAppPass(settings, now) {
  if (!isFeatureEnabled(settings?.enabledFeatures, "whatsapp")) return;
  if (!shouldFlushWhatsApp(settings, now)) return;
  if (whatsappClient.getStatus().status !== "connected") return;

  const rows = await prisma.dispatchRecord.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length > 0) {
    const partners = await prisma.partner.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
      select: { id: true, displayName: true, isRestricted: true, isPublic: true },
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
          data: { whatsappDispatchedAt: now },
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
