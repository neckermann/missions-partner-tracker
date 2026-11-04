// GroupMe integration: Prayer Requests, One-Time Needs, and Newsletters
// each post to their own configured Topic. Posts as the admin's own
// GroupMe identity via the Messages API (X-Access-Token + POST
// /groups/:id/messages), not a bot — the Bots API has no awareness of
// Topics at all, and Topics are the whole point here.
//
// Topics are undocumented in GroupMe's public API reference but real
// and confirmed working: each Topic (a "group chat inside your group
// chat," per GroupMe's own user-facing docs) is internally a "subgroup"
// with its own id (GET /groups/:groupId/subgroups), and the ordinary
// messages endpoint posts into it when pointed at that id instead of
// the parent group's — no separate endpoint, no topic_id parameter,
// just the same POST /groups/:id/messages aimed at a different id. The
// admin picks the parent group and each notification type's topic from
// live API calls in the settings UI (routes/settings.js), never
// hand-typed.
//
// As of #129, this file no longer posts live on its own -- the message
// text/topic-routing logic that used to live here moved to
// utils/notificationBlurbs.js (shared with the email digest), and this
// file's own job is just sendPendingNotificationsBatch below: pack
// already-built blurbs into as-few messages as fit per topic and send
// them. Nothing outside this file and routes/notifications.js calls
// sendPendingNotificationsBatch directly.
const crypto = require("crypto");
const prisma = require("../prismaClient");
const { decryptField } = require("./crypto");
const { isFeatureEnabled } = require("./features");

const BASE_URL = "https://api.groupme.com/v3";
// GroupMe rejects message text over 1,000 characters outright — truncated
// here rather than left for the API to 400 on, since a prayer request's
// own text has no length cap of its own.
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
// "pick a group" dropdown. per_page=100 rather than paging -- a church
// admin's own GroupMe account realistically isn't in hundreds of groups.
async function listGroups(accessToken) {
  const groups = await groupmeRequest(accessToken, "GET", "/groups?per_page=100");
  // GroupMe's own group ids are JSON strings, but a subgroup's (below)
  // come back as JSON numbers -- coerced to string on both so whichever
  // one the admin picks round-trips cleanly through the settings PUT,
  // which (correctly) only accepts strings for an id that's otherwise
  // opaque to this app.
  return (groups || []).map((g) => ({ id: String(g.id), name: g.name }));
}

// Lists a group's Topics (subgroups). A topic's display name comes back
// as either `topic` or `name` depending on the GroupMe client version
// that created it -- both observed in practice, so both are checked.
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
// splits one blurb's text across two messages. A single blurb too long
// to ever fit on its own still gets sent (and truncated by postMessage
// itself), since refusing to send it at all would be worse.
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

// Sends every given blurb to its own event type's configured Topic
// (falling back to the main group if that topic isn't set, same as this
// app's pre-#129 behavior), packed to minimize message count. Returns
// the Set of blurb ids that were actually sent successfully -- the
// caller (routes/notifications.js's flush route) uses this to stamp
// groupmeSentAt only on rows that really went out, leaving a failed
// topic's rows queued for the next flush without touching rows that
// succeeded.
async function sendPendingNotificationsBatch(blurbs) {
  const sentIds = new Set();
  const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) return sentIds;
  if (!isFeatureEnabled(settings.enabledFeatures, "groupme")) return sentIds;
  if (!settings.groupmeAccessToken) return sentIds;

  let accessToken;
  try {
    accessToken = decryptField(settings.groupmeAccessToken);
  } catch (err) {
    // A corrupted/undecryptable stored token (e.g. FIELD_ENCRYPTION_KEY
    // rotated since this was saved) must never take down the whole
    // flush -- the email phase hasn't even run yet at this point in
    // routes/notifications.js. Every row just stays queued for GroupMe
    // (retried next flush) the same way a per-message postMessage
    // failure below already leaves its own rows queued.
    console.error("GroupMe batch notification failed to decrypt the stored access token:", err);
    return sentIds;
  }

  const byTopic = new Map();
  for (const blurb of blurbs) {
    // A blurb with no groupmeText (e.g. a newsletter notification that
    // never resolved a link -- see notificationBlurbs.js) has nothing
    // to send; it's simply never marked sent and stays queued, same as
    // this app's pre-#129 behavior of silently not posting it.
    if (!blurb.groupmeText) continue;
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
        // One message's failure (a transient GroupMe outage, a revoked
        // token discovered mid-batch) must never stop the rest of the
        // batch -- those rows just stay queued for the next flush.
        console.error("GroupMe batch notification failed:", err);
      }
    }
  }

  return sentIds;
}

module.exports = {
  listGroups,
  listTopics,
  postMessage,
  sendPendingNotificationsBatch,
};
