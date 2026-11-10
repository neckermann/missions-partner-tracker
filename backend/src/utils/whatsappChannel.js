// WhatsApp-only: posting (Prayer Requests, One-Time Needs, and
// Newsletters each to their own configured group inside one WhatsApp
// community), its schedule check, and its own stamping. The sibling of
// groupmeChannel.js -- same shape, same one-way dependencies, so
// digestScheduler.js composes the two identically. The socket itself lives
// in whatsappClient.js; nothing here touches Baileys directly.
//
// Schedule: WhatsApp shares GroupMe's daily send hour
// (ChurchSettings.groupmeDigestHour -- the column keeps its name so forks
// upgrade without a rename; the admin UI calls it the chat schedule) and
// its three content-type mutes, but has its own dedupe cursor
// (lastWhatsappDigestSentAt) and its own per-row stamp (whatsappSentAt).
// A church that turns both channels on simply gets both posting at the
// same hour; one being down never blocks or double-stamps the other.
//
// Message text comes from buildBlurb()'s groupmeText -- the one place
// restricted-partner masking and review gating are decided, so WhatsApp
// inherits all of it with no extra code (the field is channel-neutral chat
// text despite its name). Only the packing differs: WhatsApp allows much
// longer messages, so several related blurbs collapse into one message.
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { buildBlurb } = require("./notificationBlurbs");
const { CHANNELS, isEligibleForChannel } = require("./notificationEligibility");
const whatsappClient = require("./whatsappClient");

// WhatsApp's documented text limit through the Business API is 4,096
// characters. The regular app / Web protocol (what Baileys speaks)
// reportedly allows far more, but that isn't documented anywhere
// authoritative, so stay safely under the documented figure.
const MAX_MESSAGE_LENGTH = 4000;

// Which ChurchSettings group column each notification type posts to,
// keyed by the NotifiableEvent row type (for eligibility/clearing, which
// look at rows) and by the blurb's topicKey (for posting, which looks at
// blurbs).
const GROUP_FIELD_BY_EVENT_TYPE = {
  prayerRequestCreated: "whatsappPrayerGroupId",
  prayerRequestAnswered: "whatsappPrayerGroupId",
  supportNeedCreated: "whatsappOneTimeNeedGroupId",
  supportNeedDecided: "whatsappOneTimeNeedGroupId",
  newsletterCreated: "whatsappNewsletterGroupId",
};
const GROUP_FIELD_BY_TOPIC_KEY = {
  groupmePrayerTopicId: "whatsappPrayerGroupId",
  groupmeOneTimeNeedTopicId: "whatsappOneTimeNeedGroupId",
  groupmeNewsletterTopicId: "whatsappNewsletterGroupId",
};

// True when WhatsApp is paired and this row's notification type has a
// group picked. Unlike GroupMe there is no "main conversation" fallback,
// so a type with no group is simply not a WhatsApp notification at all --
// and notificationOrchestrator.js's clearNotifiableEvents uses this to
// avoid holding such rows in the queue forever.
function hasWhatsAppTarget(row, settings) {
  if (!settings?.whatsappPairedAt) return false;
  const field = GROUP_FIELD_BY_EVENT_TYPE[row.type];
  return Boolean(field && settings[field]);
}

// Splits one over-long text into pieces under `max`, preferring paragraph
// breaks, then line breaks, then sentence ends, then spaces, and only as a
// last resort mid-word. Never drops or alters characters beyond trimming
// the whitespace at each split point.
function splitLongText(text, max) {
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = -1;
    for (const sep of ["\n\n", "\n", ". ", " "]) {
      const at = window.lastIndexOf(sep);
      // Don't cut so early that a tiny first piece is left behind.
      if (at >= max * 0.5) {
        cut = at + (sep === ". " ? 1 : 0);
        break;
      }
    }
    if (cut === -1) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Greedily packs a group's blurbs into as-few messages as fit under `max`,
// joining whole blurbs with a blank line. A blurb that is itself longer
// than `max` is split into continuation messages instead of truncated.
// Returns [{ text, completes: [blurbId], partOf?: blurbId }]: `completes`
// are the blurbs fully delivered once this message lands; `partOf` marks
// every piece of a split blurb (so a failed piece skips the rest of that
// blurb and leaves it queued, rather than stamping a half-sent item).
function packMessages(blurbs, max = MAX_MESSAGE_LENGTH) {
  const messages = [];
  let current = null;

  const flush = () => {
    if (current) messages.push(current);
    current = null;
  };

  for (const blurb of blurbs) {
    const text = blurb.groupmeText;
    if (text.length > max) {
      flush();
      const pieces = splitLongText(text, max);
      pieces.forEach((piece, i) => {
        const last = i === pieces.length - 1;
        messages.push({ text: piece, completes: last ? [blurb.id] : [], partOf: blurb.id });
      });
      continue;
    }
    const candidate = current ? `${current.text}\n\n${text}` : text;
    if (current && candidate.length > max) {
      flush();
      current = { text, completes: [blurb.id] };
    } else {
      current = { text: candidate, completes: [...(current?.completes || []), blurb.id] };
    }
  }
  flush();
  return messages;
}

// Takes already-eligible NotifiableEvent rows (the caller filtered through
// isEligibleForChannel), builds each row's blurb, and posts to each type's
// own configured group. Returns the Set of row ids that actually posted --
// one group failing (not a member any more, anti-ban pause) must not stop
// rows headed elsewhere from stamping whatsappSentAt.
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
    const groupId = field && settings?.[field];
    if (!groupId) continue; // no group picked for this type -- not sent
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push(blurb);
  }

  for (const [groupId, groupBlurbs] of byGroup) {
    const failedParts = new Set();
    for (const message of packMessages(groupBlurbs)) {
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

const MIN_GAP_MS_DAILY = 20 * 60 * 60 * 1000; // ~20h, not a full 24h, so a slightly-early tick never skips a day

// Pure (no I/O, no Date.now()) so it's directly unit-testable with a fixed
// `now`. Same daily-hour rule as GroupMe's shouldFlushGroupMe, reading the
// shared hour but WhatsApp's own cursor.
function shouldFlushWhatsApp(settings, now) {
  if (settings?.groupmeDigestHour == null) return false; // no chat schedule configured yet
  if (now.getHours() !== settings.groupmeDigestHour) return false;
  const sinceLast = settings.lastWhatsappDigestSentAt ? now - settings.lastWhatsappDigestSentAt : Infinity;
  return sinceLast >= MIN_GAP_MS_DAILY;
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

  const rows = await prisma.notifiableEvent.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length > 0) {
    const partners = await prisma.partner.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
      select: { id: true, displayName: true, isRestricted: true, isPublic: true },
    });
    const partnerById = new Map(partners.map((p) => [p.id, p]));

    const eligibleRows = rows.filter(
      (row) =>
        !row.whatsappSentAt &&
        hasWhatsAppTarget(row, settings) &&
        isEligibleForChannel(row, CHANNELS.WHATSAPP, partnerById.get(row.partnerId), settings, true)
    );
    if (eligibleRows.length > 0) {
      const sentIds = await postToWhatsApp(eligibleRows, partnerById, settings);
      if (sentIds.size > 0) {
        await prisma.notifiableEvent.updateMany({
          where: { id: { in: [...sentIds] } },
          data: { whatsappSentAt: now },
        });
      }
    }
  }

  await prisma.churchSettings.update({ where: { id: "singleton" }, data: { lastWhatsappDigestSentAt: now } });
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
