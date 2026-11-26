// GroupMe-only posting (Prayer Requests, One-Time Needs, Newsletters, each to its
// configured Topic), its own daily-hour schedule and stamping.
//
// Posts as the admin's own GroupMe identity via the Messages API (X-Access-Token
// + POST /groups/:id/messages), not a bot: the Bots API doesn't know Topics. A
// Topic is internally a "subgroup" with its own id (GET /groups/:groupId/subgroups;
// undocumented but confirmed), and the ordinary messages endpoint posts into it
// when given that id.
const crypto = require("crypto");
const prisma = require("../prismaClient");
const { decryptField } = require("./crypto");
const { isGuardedDemo } = require("./demoMode");
const { isFeatureEnabled } = require("./features");
const { buildBlurb } = require("./dispatchBlurbs");
const { CHANNELS, isEligibleForChannel } = require("./dispatchEligibility");
const { shouldFlushDailyChatChannel } = require("./chatSchedule");
const { packMessages } = require("./messagePacking");

const BASE_URL = "https://api.groupme.com/v3";
// GroupMe rejects text over 1,000 characters. packMessages (below) guarantees
// every message is under this by splitting an over-long blurb across messages;
// truncating dropped text while the row was still stamped sent (#244).
const MAX_MESSAGE_LENGTH = 1000;

// Every GroupMe response is { response, meta }: success has response populated and
// no meta.errors; failure has response: null and meta.code/meta.errors. See https://dev.groupme.com/docs/v3.
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

// Lists the groups the token's account belongs to, for the "pick a group" dropdown.
async function listGroups(accessToken) {
  const groups = await groupmeRequest(accessToken, "GET", "/groups?per_page=100");
  return (groups || []).map((g) => ({ id: String(g.id), name: g.name }));
}

// Lists a group's Topics (subgroups).
async function listTopics(accessToken, groupId) {
  const topics = await groupmeRequest(accessToken, "GET", `/groups/${encodeURIComponent(groupId)}/subgroups`);
  return (topics || []).map((t) => ({ id: String(t.id), name: t.topic || t.name || "(untitled topic)" }));
}

// Throws rather than truncating: packMessages already guarantees messages are
// under MAX_MESSAGE_LENGTH, so firing means that guarantee broke, and cutting
// text here would hide it (the #244 failure).
async function postMessage(accessToken, targetId, text) {
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`postMessage received ${text.length} chars, over the ${MAX_MESSAGE_LENGTH} limit`);
  }
  // A public demo posts nothing to a real group (utils/demoMode.js).
  if (isGuardedDemo()) {
    console.log("[demo] GroupMe post not sent");
    return;
  }
  await groupmeRequest(accessToken, "POST", `/groups/${encodeURIComponent(targetId)}/messages`, {
    message: { source_guid: crypto.randomUUID(), text },
  });
}

// Takes already-eligible DispatchRecord rows, builds each blurb and posts to its
// type's Topic (falling back to the main group), packed to minimize messages.
// Returns the Set of row ids that posted; one Topic failing (bad token, deleted
// Topic) must not stop other rows stamping groupmeDispatchedAt.
async function postToGroupMe(eligibleRows, partnerById, settings) {
  const sentIds = new Set();
  if (!settings?.groupmeAccessToken) return sentIds;

  let accessToken;
  try {
    accessToken = decryptField(settings.groupmeAccessToken);
  } catch (err) {
    // An undecryptable stored token (e.g. FIELD_ENCRYPTION_KEY rotated) must not
    // take down the pass; rows stay queued for the next one.
    console.error("GroupMe post failed to decrypt the stored access token:", err);
    // Record the failure for every row bound for GroupMe (the "Dispatch send failures" notification), not just log it.
    await prisma.dispatchRecord.updateMany({
      where: { id: { in: eligibleRows.map((r) => r.id) } },
      data: { groupmeError: `Could not decrypt stored GroupMe token: ${err.message}` },
    });
    return sentIds;
  }

  const blurbs = eligibleRows
    .map((row) => buildBlurb(row, partnerById.get(row.partnerId), settings))
    .filter((blurb) => blurb?.groupmeText); // a blurb with no groupmeText (e.g. a newsletter that never resolved a link) has nothing to send

  const byTopic = new Map();
  for (const blurb of blurbs) {
    if (!byTopic.has(blurb.topicKey)) byTopic.set(blurb.topicKey, []);
    byTopic.get(blurb.topicKey).push(blurb);
  }

  for (const [topicKey, topicBlurbs] of byTopic) {
    const targetId = settings[topicKey] || settings.groupmeGroupId;
    if (!targetId) continue; // nothing configured to send to -- stays queued

    // failedParts holds a split blurb's id once a piece fails: later pieces
    // (message.partOf) are skipped rather than posted out of order, leaving the
    // whole blurb queued instead of stamped sent on partial delivery (#244).
    const failedParts = new Set();
    for (const message of packMessages(topicBlurbs, MAX_MESSAGE_LENGTH)) {
      if (message.partOf && failedParts.has(message.partOf)) continue;
      try {
        await postMessage(accessToken, targetId, message.text);
        message.completes.forEach((id) => sentIds.add(id));
      } catch (err) {
        // One message's failure must not stop the pass; its rows stay queued. Recorded, not just logged.
        console.error("GroupMe post failed:", err);
        await prisma.dispatchRecord.updateMany({
          where: { id: { in: message.completes } },
          data: { groupmeError: err.message },
        });
        if (message.partOf) failedParts.add(message.partOf);
      }
    }
  }

  return sentIds;
}

// GroupMe's daily-hour check, shared with WhatsApp via chatSchedule.js (see
// test/groupmeChannel.test.js). A single daily batch hour suits a chat channel
// better than a weekly/monthly tier.
function shouldFlushGroupMe(settings, now) {
  return shouldFlushDailyChatChannel(settings, now, "lastGroupmeChatDispatchSentAt");
}

// Schedule check + pass; no-op if the feature is off or the hour/dedupe gate
// fails. The cross-channel clearing step lives in emailDispatchScheduler.js,
// keeping this and dispatchOrchestrator.js a one-way dependency. Returns nothing.
async function runGroupMePass(settings, now) {
  if (!isFeatureEnabled(settings?.enabledFeatures, "groupme")) return;
  if (!shouldFlushGroupMe(settings, now)) return;

  const rows = await prisma.dispatchRecord.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length > 0) {
    const partners = await prisma.partner.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
      select: { id: true, displayName: true, fieldDisplayName: true, isRestricted: true, isPublic: true },
    });
    const partnerById = new Map(partners.map((p) => [p.id, p]));

    const eligibleRows = rows.filter((row) =>
      isEligibleForChannel(row, CHANNELS.GROUPME, partnerById.get(row.partnerId), settings, true)
    );
    if (eligibleRows.length > 0) {
      const sentIds = await postToGroupMe(eligibleRows, partnerById, settings);
      if (sentIds.size > 0) {
        await prisma.dispatchRecord.updateMany({
          where: { id: { in: [...sentIds] } },
          data: { groupmeDispatchedAt: now, groupmeError: null },
        });
      }
    }
  }

  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { lastGroupmeChatDispatchSentAt: now },
  });
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  listGroups,
  listTopics,
  postMessage,
  postToGroupMe,
  shouldFlushGroupMe,
  runGroupMePass,
};
