// GroupMe integration (Phase 1: Prayer Requests only — see the plan this
// shipped under). Posts via a GroupMe Bot, not the admin's own account.
// The group and the bot are both created by the admin directly in
// GroupMe (dev.groupme.com/bots) -- this app never calls the Groups or
// Bots creation endpoints, it only ever posts. bot_id is itself the
// whole credential for POST /bots/post (GroupMe scopes a bot to exactly
// one group at creation time; there's no separate access token to send).
// GroupMe's public API has no "Topics" concept regardless of bot vs.
// user auth, so everything lands in the bot's one group's main
// conversation -- one group, not per-category routing, for now.
const prisma = require("../prismaClient");
const { decryptField } = require("./crypto");
const { isFeatureEnabled } = require("./features");

const BASE_URL = "https://api.groupme.com/v3";
// GroupMe rejects message text over 1,000 characters outright — truncated
// here rather than left for the API to 400 on, since a prayer request's
// own text has no length cap of its own.
const MAX_MESSAGE_LENGTH = 1000;

async function postMessage(botId, text) {
  const trimmed = text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
  const res = await fetch(`${BASE_URL}/bots/post`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot_id: botId, text: trimmed }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const errors = payload?.meta?.errors?.join(", ") || res.statusText;
    throw new Error(`GroupMe /bots/post failed (${res.status}): ${errors}`);
  }
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
  if (!settings.groupmeBotId) return;

  const botId = decryptField(settings.groupmeBotId);
  const partnerName = prayerRequest.partner?.displayName || "A partner";
  const text = `🙏 New prayer request from ${partnerName}:\n${prayerRequest.requestText}`;

  try {
    await postMessage(botId, text);
  } catch (err) {
    console.error("GroupMe notification failed:", err);
  }
}

module.exports = { postMessage, notifyPrayerRequestCreated };
