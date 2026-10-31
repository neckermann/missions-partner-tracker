// GroupMe integration (Phase 1: Prayer Requests only — see the plan this
// shipped under). Posts as the admin's own GroupMe identity via the
// Messages API (X-Access-Token + POST /groups/:id/messages), not a named
// bot — GroupMe's public API has no "Topics" concept to route to even if
// a bot were used, so everything lands in the configured group's main
// conversation. One group, not per-category routing, for now.
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
async function groupmeRequest(accessToken, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Access-Token": accessToken },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const errors = payload?.meta?.errors?.join(", ") || res.statusText;
    throw new Error(`GroupMe ${path} failed (${res.status}): ${errors}`);
  }
  return payload?.response ?? null;
}

// Creates a new GroupMe group owned by whoever the access token belongs
// to. Returns the full group object (id, share_url, etc.) -- the caller
// decides what to persist.
async function createGroup(accessToken, name) {
  return groupmeRequest(accessToken, "/groups", { name });
}

async function postMessage(accessToken, groupId, text) {
  const trimmed = text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
  await groupmeRequest(accessToken, `/groups/${encodeURIComponent(groupId)}/messages`, {
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
  if (!settings.groupmeAccessToken || !settings.groupmeGroupId) return;

  const accessToken = decryptField(settings.groupmeAccessToken);
  const partnerName = prayerRequest.partner?.displayName || "A partner";
  const text = `🙏 New prayer request from ${partnerName}:\n${prayerRequest.requestText}`;

  try {
    await postMessage(accessToken, settings.groupmeGroupId, text);
  } catch (err) {
    console.error("GroupMe notification failed:", err);
  }
}

module.exports = { createGroup, postMessage, notifyPrayerRequestCreated };
