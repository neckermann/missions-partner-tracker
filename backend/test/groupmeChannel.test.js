const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
// groupmeChannel.js transitively requires prismaClient.js, which reads
// DATABASE_URL eagerly at require time -- same reason whatsappChannel.test.js
// needs this. A real (random, test-only) FIELD_ENCRYPTION_KEY is needed too,
// since postToGroupMe decrypts the stored access token -- same pattern as
// crypto.test.js/whatsappAuthState.test.js.
require("dotenv").config({ quiet: true });
process.env.FIELD_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
const { encryptField } = require("../src/utils/crypto");
const { MAX_MESSAGE_LENGTH, postMessage, postToGroupMe } = require("../src/utils/groupmeChannel");

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function groupmeJson(status, body) {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => body };
}

describe("postMessage", () => {
  test("the limit matches GroupMe's documented 1,000 characters", () => {
    assert.equal(MAX_MESSAGE_LENGTH, 1000);
  });

  // #244: this used to silently truncate to 999 chars + "…" instead of
  // refusing -- packMessages (messagePacking.js) is what's actually
  // responsible for keeping every message under the limit now, so a
  // message arriving here over-length means that guarantee broke
  // upstream, not something to paper over by cutting it again.
  test("rejects text over the limit instead of truncating it", async () => {
    await assert.rejects(
      () => postMessage("token", "g1", "x".repeat(MAX_MESSAGE_LENGTH + 1)),
      /over the 1000 limit/
    );
  });

  test("posts text at exactly the limit, unmodified", async () => {
    let sentText;
    global.fetch = async (url, options) => {
      sentText = JSON.parse(options.body).message.text;
      return groupmeJson(202, { response: null });
    };
    const text = "x".repeat(MAX_MESSAGE_LENGTH);
    await postMessage("token", "g1", text);
    assert.equal(sentText, text);
  });
});

describe("postToGroupMe", () => {
  const settings = {
    groupmeAccessToken: encryptField("fake-token"),
    groupmeGroupId: "main-group",
    groupmePrayerTopicId: "prayer-topic",
    groupmeOneTimeNeedTopicId: "needs-topic",
    // no newsletter topic on purpose -- falls back to groupmeGroupId
  };
  const partnerById = new Map([["p1", { id: "p1", displayName: "Jane Doe", isRestricted: false }]]);
  const prayer = (id, text) => ({
    id,
    type: "prayerRequestCreated",
    partnerId: "p1",
    payload: { partnerName: "Jane Doe", requestText: text },
  });
  const need = (id) => ({
    id,
    type: "supportNeedCreated",
    partnerId: "p1",
    payload: { partnerName: "Jane Doe", description: "A laptop", requestedAmount: 900 },
  });

  test("related requests collapse into one message per Topic, routed to their own Topic", async () => {
    const sent = [];
    global.fetch = async (url, options) => {
      sent.push({ url: String(url), text: JSON.parse(options.body).message.text });
      return groupmeJson(202, { response: null });
    };

    const ids = await postToGroupMe(
      [prayer("a", "Pray for health"), prayer("b", "Pray for visas"), need("c")],
      partnerById,
      settings
    );

    assert.deepEqual([...ids].sort(), ["a", "b", "c"]);
    assert.equal(sent.length, 2);
    const prayerMsg = sent.find((m) => m.url.includes("/groups/prayer-topic/"));
    assert.match(prayerMsg.text, /Pray for health/);
    assert.match(prayerMsg.text, /Pray for visas/);
    assert.match(sent.find((m) => m.url.includes("/groups/needs-topic/")).text, /laptop/);
  });

  test("a type with no Topic set falls back to the main group", async () => {
    const sent = [];
    global.fetch = async (url, options) => {
      sent.push({ url: String(url), text: JSON.parse(options.body).message.text });
      return groupmeJson(202, { response: null });
    };
    // A need, not a newsletter -- newsletterCreated's own groupmeText is
    // independently null without APP_BASE_URL set (no link, nothing
    // worth sending -- see dispatchBlurbs.js), which would filter
    // this row out before ever reaching the fallback logic this test is
    // actually about. need()'s groupmeText has no such external
    // dependency. See whatsappChannel.test.js's identical note on its
    // own Announcements-fallback test.
    const noNeedsTopic = { ...settings, groupmeOneTimeNeedTopicId: undefined };
    const ids = await postToGroupMe([need("c")], partnerById, noNeedsTopic);
    assert.equal(ids.size, 1);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].url.includes("/groups/main-group/"));
  });

  test("one Topic failing leaves only its rows unsent", async () => {
    global.fetch = async (url) => {
      if (String(url).includes("/groups/needs-topic/"))
        return groupmeJson(500, { meta: { errors: ["down"] } });
      return groupmeJson(202, { response: null });
    };
    const ids = await postToGroupMe([prayer("a", "Pray"), need("c")], partnerById, settings);
    assert.deepEqual([...ids], ["a"]);
  });

  // #244's core acceptance criterion: a single blurb over 1,000 chars is
  // delivered in full, across multiple messages, not cut short.
  test("a blurb longer than the limit is split across messages, with no text lost", async () => {
    const sent = [];
    global.fetch = async (url, options) => {
      sent.push(JSON.parse(options.body).message.text);
      return groupmeJson(202, { response: null });
    };
    const long = `${"A very long prayer request. ".repeat(100)}end`; // well over 1,000 chars
    const ids = await postToGroupMe([prayer("long", long)], partnerById, settings);

    assert.equal(ids.has("long"), true);
    assert.ok(sent.length > 1, "expected the blurb to span several messages");
    for (const text of sent) assert.ok(text.length <= MAX_MESSAGE_LENGTH);
    assert.equal(sent.join(" ").replace(/\s+/g, " ").includes("end"), true, "no text should be dropped");
  });

  // #244's other acceptance criterion: a failed piece must not stamp the
  // row sent, and must not let a later piece post out of order.
  test("a failed piece of a split request leaves that request unsent and skips its later pieces", async () => {
    let calls = 0;
    global.fetch = async (url, options) => {
      calls += 1;
      if (calls === 2) return groupmeJson(500, { meta: { errors: ["boom"] } });
      JSON.parse(options.body); // still a well-formed request
      return groupmeJson(202, { response: null });
    };
    const long = `${"A very long prayer request. ".repeat(100)}end`;
    const ids = await postToGroupMe(
      [prayer("long", long), prayer("after", "short one")],
      partnerById,
      settings
    );
    assert.equal(ids.has("long"), false);
    assert.equal(ids.has("after"), true);
    assert.equal(calls, 3); // piece 1 ok, piece 2 failed, remaining piece(s) of "long" skipped, then "after"
  });

  test("a restricted partner's text is masked exactly as for WhatsApp/the digests", async () => {
    const sent = [];
    global.fetch = async (url, options) => {
      sent.push(JSON.parse(options.body).message.text);
      return groupmeJson(202, { response: null });
    };
    const restricted = new Map([["p1", { id: "p1", displayName: "Jane Doe", isRestricted: true }]]);
    await postToGroupMe([prayer("a", "Secret location details")], restricted, settings);
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0], /Secret location details/);
    assert.doesNotMatch(sent[0], /Jane Doe/);
  });
});
