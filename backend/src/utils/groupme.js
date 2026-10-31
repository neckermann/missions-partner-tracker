// GroupMe integration (Phase 1: Prayer Requests only — see the plan this
// shipped under). Posts as the admin's own GroupMe identity via the
// Messages API (X-Access-Token + POST /groups/:id/messages), not a bot
// — the Bots API has no awareness of Topics at all, and Topics are the
// whole point here.
//
// Topics are undocumented in GroupMe's public API reference but real
// and confirmed working: each Topic (a "group chat inside your group
// chat," per GroupMe's own user-facing docs) is internally a "subgroup"
// with its own id (GET /groups/:groupId/subgroups), and the ordinary
// messages endpoint posts into it when pointed at that id instead of
// the parent group's — no separate endpoint, no topic_id parameter,
// just the same POST /groups/:id/messages aimed at a different id. The
// admin picks the parent group and the Prayer Requests topic from live
// API calls in the settings UI (routes/settings.js), never hand-typed.
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

// Fire-and-log, not fire-and-throw: a church's GroupMe setup being broken
// or GroupMe being down should never block saving a prayer request. The
// caller (routes/prayerRequests.js) still wraps this in its own
// try/catch as a second layer, since a bug in here (not just the network
// call) shouldn't take the request down either.
async function notifyPrayerRequestCreated(prayerRequest) {
  const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) return;
  if (!isFeatureEnabled(settings.enabledFeatures, "groupme")) return;
  if (!settings.groupmeAccessToken) return;

  // Posts into the Prayer Requests topic once one's configured; falls
  // back to the main group conversation if the admin has saved a token
  // and group but hasn't picked a topic yet, so the integration is
  // usable at every stage of setup rather than all-or-nothing.
  const targetId = settings.groupmePrayerTopicId || settings.groupmeGroupId;
  if (!targetId) return;

  const accessToken = decryptField(settings.groupmeAccessToken);
  const partnerName = prayerRequest.partner?.displayName || "A partner";
  const text = `🙏 New prayer request from ${partnerName}:\n${prayerRequest.requestText}`;

  try {
    await postMessage(accessToken, targetId, text);
  } catch (err) {
    console.error("GroupMe notification failed:", err);
  }
}

module.exports = { listGroups, listTopics, postMessage, notifyPrayerRequestCreated };
