// GroupMe-only: posting (Prayer Requests, One-Time Needs, and
// Newsletters each to their own configured Topic), its own independent
// daily-hour schedule, and its own stamping. Consolidates the old
// groupme.js (posting/API-client logic, unchanged) and the GroupMe half
// of notificationFlush.js (the other half -- the now-retired email
// mechanism and the cross-channel clearing step -- went to
// notificationOrchestrator.js instead) into one file matching its name.
//
// Posts as the admin's own GroupMe identity via the Messages API
// (X-Access-Token + POST /groups/:id/messages), not a bot -- the Bots
// API has no awareness of Topics at all, and Topics are the whole point
// here. Undocumented in GroupMe's public API reference but real and
// confirmed working: each Topic ("a group chat inside your group chat,"
// per GroupMe's own user-facing docs) is internally a "subgroup" with
// its own id (GET /groups/:groupId/subgroups), and the ordinary
// messages endpoint posts into it when pointed at that id instead of
// the parent group's.
const crypto = require("crypto");
const prisma = require("../prismaClient");
const { decryptField } = require("./crypto");
const { isFeatureEnabled } = require("./features");
const { buildBlurb } = require("./notificationBlurbs");
const { CHANNELS, isEligibleForChannel } = require("./notificationEligibility");
const { shouldFlushDailyChatChannel } = require("./chatSchedule");

const BASE_URL = "https://api.groupme.com/v3";
// GroupMe rejects message text over 1,000 characters outright --
// truncated here rather than left for the API to 400 on.
const MAX_MESSAGE_LENGTH = 1000;

// Every GroupMe response is wrapped in { response, meta } -- success has
// response populated and no meta.errors; failure has response: null and
// meta.code/meta.errors. See https://dev.groupme.com/docs/v3.
async function groupmeRequest(accessToken, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Access-Token": accessToken },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const errors = payload?.meta?.errors?.join(", ") || res.statusText;
    throw new Error(`GroupMe ${path} failed (${res.status}): ${errors}`);
  }
  return payload?.response ?? null;
}

// Lists the groups the token's own account belongs to, for the admin's
// "pick a group" dropdown.
async function listGroups(accessToken) {
  const groups = await groupmeRequest(accessToken, "GET", "/groups?per_page=100");
  return (groups || []).map((g) => ({ id: String(g.id), name: g.name }));
}

// Lists a group's Topics (subgroups).
async function listTopics(accessToken, groupId) {
  const topics = await groupmeRequest(accessToken, "GET", `/groups/${encodeURIComponent(groupId)}/subgroups`);
  return (topics || []).map((t) => ({ id: String(t.id), name: t.topic || t.name || "(untitled topic)" }));
}

async function postMessage(accessToken, targetId, text) {
  const trimmed = text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
  await groupmeRequest(accessToken, "POST", `/groups/${encodeURIComponent(targetId)}/messages`, {
    message: { source_guid: crypto.randomUUID(), text: trimmed },
  });
}

// Greedily packs a topic's own blurbs into as-few messages as fit under
// MAX_MESSAGE_LENGTH, joining whole blurbs with a blank line -- never
// splits one blurb's text across two messages.
function packMessages(blurbs) {
  const messages = []; // [{ text, blurbIds }]
  let current = null;

  for (const blurb of blurbs) {
    const candidateText = current ? `${current.text}\n\n${blurb.groupmeText}` : blurb.groupmeText;
    if (current && candidateText.length > MAX_MESSAGE_LENGTH) {
      messages.push(current);
      current = { text: blurb.groupmeText, blurbIds: [blurb.id] };
    } else {
      current = { text: candidateText, blurbIds: [...(current?.blurbIds || []), blurb.id] };
    }
  }
  if (current) messages.push(current);
  return messages;
}

// Takes already-eligible NotifiableEvent rows (the caller already
// filtered through isEligibleForChannel), builds each row's blurb, and
// posts to each type's own configured Topic (falling back to the main
// group if that topic isn't set), packed to minimize message count.
// Returns the Set of row ids that actually posted successfully -- one
// Topic failing (a bad GroupMe token, a deleted Topic) must not block
// rows headed to a different Topic from stamping groupmeSentAt.
async function postToGroupMe(eligibleRows, partnerById, settings) {
  const sentIds = new Set();
  if (!settings?.groupmeAccessToken) return sentIds;

  let accessToken;
  try {
    accessToken = decryptField(settings.groupmeAccessToken);
  } catch (err) {
    // A corrupted/undecryptable stored token (e.g. FIELD_ENCRYPTION_KEY
    // rotated since this was saved) must never take down the whole pass
    // -- every row just stays queued for GroupMe (retried next pass).
    console.error("GroupMe post failed to decrypt the stored access token:", err);
    return sentIds;
  }

  const blurbs = eligibleRows
    .map((row) => buildBlurb(row, partnerById.get(row.partnerId)))
    .filter((blurb) => blurb?.groupmeText); // a blurb with no groupmeText (e.g. a newsletter that never resolved a link) has nothing to send

  const byTopic = new Map();
  for (const blurb of blurbs) {
    if (!byTopic.has(blurb.topicKey)) byTopic.set(blurb.topicKey, []);
    byTopic.get(blurb.topicKey).push(blurb);
  }

  for (const [topicKey, topicBlurbs] of byTopic) {
    const targetId = settings[topicKey] || settings.groupmeGroupId;
    if (!targetId) continue; // nothing configured to send to -- stays queued

    for (const { text, blurbIds } of packMessages(topicBlurbs)) {
      try {
        await postMessage(accessToken, targetId, text);
        blurbIds.forEach((id) => sentIds.add(id));
      } catch (err) {
        // One message's failure must never stop the rest of the pass --
        // those rows just stay queued for the next one.
        console.error("GroupMe post failed:", err);
      }
    }
  }

  return sentIds;
}

// Weekly/biweekly/monthly's own minimum-gap constants live in
// digestScheduler.js now (GroupMe no longer shares any of those tiers);
// this is GroupMe's own, much simpler daily check, shared with
// WhatsApp's identical one via chatSchedule.js -- see
// test/groupmeChannel.test.js. GroupMe never actually had its own
// schedule before this (see schema.prisma's own comment on
// groupmeDigestHour) -- a single daily batch hour, not a tier pick,
// fits a chat-style channel better than any weekly/monthly tier would
// have.
function shouldFlushGroupMe(settings, now) {
  return shouldFlushDailyChatChannel(settings, now, "lastGroupmeDigestSentAt");
}

// GroupMe's own schedule check + pass -- no awareness of the
// cross-channel clearing step that must run after it; that lives in
// digestScheduler.js instead (registers this as its own independent
// cron alongside the email tiers' tick), so this file and
// notificationOrchestrator.js stay a one-way dependency. A no-op if the
// feature's off or the hour/dedupe gate doesn't pass. Returns nothing
// -- callers read back what was stamped via the usual query.
async function runGroupMePass(settings, now) {
  if (!isFeatureEnabled(settings?.enabledFeatures, "groupme")) return;
  if (!shouldFlushGroupMe(settings, now)) return;

  const rows = await prisma.notifiableEvent.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length > 0) {
    const partners = await prisma.partner.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
      select: { id: true, displayName: true, isRestricted: true, isPublic: true },
    });
    const partnerById = new Map(partners.map((p) => [p.id, p]));

    const eligibleRows = rows.filter((row) =>
      isEligibleForChannel(row, CHANNELS.GROUPME, partnerById.get(row.partnerId), settings, true)
    );
    if (eligibleRows.length > 0) {
      const sentIds = await postToGroupMe(eligibleRows, partnerById, settings);
      if (sentIds.size > 0) {
        await prisma.notifiableEvent.updateMany({
          where: { id: { in: [...sentIds] } },
          data: { groupmeSentAt: now },
        });
      }
    }
  }

  await prisma.churchSettings.update({ where: { id: "singleton" }, data: { lastGroupmeDigestSentAt: now } });
}

module.exports = {
  listGroups,
  listTopics,
  postMessage,
  postToGroupMe,
  shouldFlushGroupMe,
  runGroupMePass,
};
