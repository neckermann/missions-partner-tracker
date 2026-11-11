const { test, describe, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
// whatsappChannel.js transitively requires prismaClient.js, which reads
// DATABASE_URL eagerly at require time -- same reason
// digestScheduler.test.js needs this. Everything exercised here is pure or
// mocks the WhatsApp client; no DB is touched.
require("dotenv").config({ quiet: true });
const whatsappClient = require("../src/utils/whatsappClient");
const {
  MAX_MESSAGE_LENGTH,
  hasWhatsAppTarget,
  splitLongText,
  packMessages,
  postToWhatsApp,
  shouldFlushWhatsApp,
} = require("../src/utils/whatsappChannel");
const { CHANNELS, isEligibleForChannel } = require("../src/utils/notificationEligibility");

afterEach(() => mock.restoreAll());

const blurb = (id, text, topicKey = "groupmePrayerTopicId") => ({ id, groupmeText: text, topicKey });

describe("splitLongText", () => {
  test("returns short text unsplit", () => {
    assert.deepEqual(splitLongText("hello", 100), ["hello"]);
  });

  test("every piece is within the limit and no words are lost", () => {
    const text = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const pieces = splitLongText(text, 300);
    assert.ok(pieces.length > 1);
    for (const piece of pieces) assert.ok(piece.length <= 300, `piece of ${piece.length} chars`);
    assert.equal(pieces.join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "));
  });

  test("prefers paragraph breaks over mid-sentence cuts", () => {
    const first = "a".repeat(60);
    const second = "b".repeat(60);
    assert.deepEqual(splitLongText(`${first}\n\n${second}`, 100), [first, second]);
  });

  test("hard-cuts a single unbroken run as a last resort", () => {
    const pieces = splitLongText("x".repeat(250), 100);
    assert.deepEqual(
      pieces.map((p) => p.length),
      [100, 100, 50]
    );
  });
});

describe("packMessages", () => {
  test("combines several blurbs into one message, separated by a blank line", () => {
    const messages = packMessages([blurb("a", "one"), blurb("b", "two"), blurb("c", "three")]);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, "one\n\ntwo\n\nthree");
    assert.deepEqual(messages[0].completes, ["a", "b", "c"]);
  });

  test("starts a new message rather than overflow the limit, never splitting a blurb that fits", () => {
    const big = "x".repeat(60);
    const messages = packMessages([blurb("a", big), blurb("b", big), blurb("c", big)], 130);
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0].completes, ["a", "b"]);
    assert.deepEqual(messages[1].completes, ["c"]);
    for (const m of messages) assert.ok(m.text.length <= 130);
  });

  test("a blurb longer than the limit is split, completing only on its last piece", () => {
    const long = `${"word ".repeat(100)}end`;
    const messages = packMessages([blurb("a", "short"), blurb("b", long), blurb("c", "after")], 120);
    const pieces = messages.filter((m) => m.partOf === "b");
    assert.ok(pieces.length > 1);
    assert.deepEqual(
      pieces.slice(0, -1).flatMap((m) => m.completes),
      []
    );
    assert.deepEqual(pieces.at(-1).completes, ["b"]);
    for (const m of messages) assert.ok(m.text.length <= 120);
    // the short blurbs on either side are untouched
    assert.deepEqual(messages[0].completes, ["a"]);
    assert.deepEqual(messages.at(-1).completes, ["c"]);
  });

  test("the default limit is under WhatsApp's documented 4,096", () => {
    assert.ok(MAX_MESSAGE_LENGTH < 4096);
  });
});

describe("hasWhatsAppTarget", () => {
  const settings = { whatsappPairedAt: new Date(), whatsappPrayerGroupId: "1@g.us" };

  test("true when paired and the row's type has a group picked", () => {
    assert.equal(hasWhatsAppTarget({ type: "prayerRequestCreated" }, settings), true);
    assert.equal(hasWhatsAppTarget({ type: "prayerRequestAnswered" }, settings), true);
  });

  test("false for a type with no group picked -- there is no main-group fallback", () => {
    assert.equal(hasWhatsAppTarget({ type: "supportNeedCreated" }, settings), false);
    assert.equal(hasWhatsAppTarget({ type: "newsletterCreated" }, settings), false);
  });

  test("still true during a momentary disconnect -- a group pick, not live pairing, is the signal", () => {
    // A transient reconnect (every deploy causes one) must not look the
    // same as a deliberate unlink to clearNotifiableEvents -- a real
    // unlink clears the group fields too (see routes/settings.js's POST
    // /whatsapp/unlink), so "group picked" alone is what's actually
    // stable here.
    assert.equal(
      hasWhatsAppTarget({ type: "prayerRequestCreated" }, { ...settings, whatsappPairedAt: null }),
      true
    );
  });

  test("false with no settings at all", () => {
    assert.equal(hasWhatsAppTarget({ type: "prayerRequestCreated" }, null), false);
  });

  test("false for an unknown row type", () => {
    assert.equal(hasWhatsAppTarget({ type: "somethingElse" }, settings), false);
  });
});

describe("shouldFlushWhatsApp", () => {
  const NINE_AM = new Date(2026, 0, 7, 9, 0, 0);

  test("not configured (no shared chat hour) never fires", () => {
    assert.equal(shouldFlushWhatsApp({ groupmeDigestHour: null }, NINE_AM), false);
    assert.equal(shouldFlushWhatsApp(null, NINE_AM), false);
  });

  test("fires at the shared hour, once per ~day, on its own cursor", () => {
    const settings = { groupmeDigestHour: 9, lastWhatsappDigestSentAt: null };
    assert.equal(shouldFlushWhatsApp(settings, NINE_AM), true);
    assert.equal(shouldFlushWhatsApp({ ...settings, groupmeDigestHour: 10 }, NINE_AM), false);
    const sixHoursAgo = new Date(NINE_AM - 6 * 60 * 60 * 1000);
    assert.equal(shouldFlushWhatsApp({ ...settings, lastWhatsappDigestSentAt: sixHoursAgo }, NINE_AM), false);
    const yesterday = new Date(NINE_AM - 24 * 60 * 60 * 1000);
    assert.equal(shouldFlushWhatsApp({ ...settings, lastWhatsappDigestSentAt: yesterday }, NINE_AM), true);
  });

  test("GroupMe having already sent this hour never blocks WhatsApp", () => {
    const settings = {
      groupmeDigestHour: 9,
      lastGroupmeDigestSentAt: NINE_AM,
      lastWhatsappDigestSentAt: null,
    };
    assert.equal(shouldFlushWhatsApp(settings, NINE_AM), true);
  });
});

describe("WhatsApp shares GroupMe's content-type mutes", () => {
  const partner = { isRestricted: false, isPublic: false };
  const prayerRow = { type: "prayerRequestCreated" };
  const needRow = { type: "supportNeedCreated" };
  const newsRow = { type: "newsletterCreated" };

  test("each mute suppresses WhatsApp exactly as it does GroupMe", () => {
    const muted = {
      notifyGroupMePrayerRequests: false,
      notifyGroupMeOneTimeNeeds: false,
      notifyGroupMeNewsletters: false,
    };
    for (const row of [prayerRow, needRow, newsRow]) {
      assert.equal(isEligibleForChannel(row, CHANNELS.WHATSAPP, partner, muted, true), false);
      assert.equal(isEligibleForChannel(row, CHANNELS.GROUPME, partner, muted, true), false);
      assert.equal(isEligibleForChannel(row, CHANNELS.WHATSAPP, partner, {}, true), true);
    }
  });

  test("a restricted partner's unreviewed row is held on WhatsApp too", () => {
    const restricted = { isRestricted: true, isPublic: false };
    const settings = { allowRestrictedPartnerNotifications: true };
    assert.equal(
      isEligibleForChannel({ ...prayerRow, reviewedAt: null }, CHANNELS.WHATSAPP, restricted, settings, true),
      false
    );
    assert.equal(
      isEligibleForChannel(
        { ...prayerRow, reviewedAt: new Date() },
        CHANNELS.WHATSAPP,
        restricted,
        settings,
        true
      ),
      true
    );
  });
});

describe("postToWhatsApp", () => {
  const settings = {
    whatsappPairedAt: new Date(),
    whatsappPrayerGroupId: "prayer@g.us",
    whatsappOneTimeNeedGroupId: "needs@g.us",
    // no newsletter group on purpose
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

  test("related requests collapse into one message per group, routed to their own group", async () => {
    const sent = [];
    mock.method(whatsappClient, "sendText", async (jid, text) => sent.push({ jid, text }));

    const ids = await postToWhatsApp(
      [prayer("a", "Pray for health"), prayer("b", "Pray for visas"), need("c")],
      partnerById,
      settings
    );

    assert.deepEqual([...ids].sort(), ["a", "b", "c"]);
    assert.equal(sent.length, 2);
    const prayerMsg = sent.find((m) => m.jid === "prayer@g.us");
    assert.match(prayerMsg.text, /Pray for health/);
    assert.match(prayerMsg.text, /Pray for visas/);
    assert.match(sent.find((m) => m.jid === "needs@g.us").text, /laptop/);
  });

  test("a type with no group picked is not sent", async () => {
    const sent = [];
    mock.method(whatsappClient, "sendText", async (jid, text) => sent.push({ jid, text }));
    const newsletter = {
      id: "n",
      type: "newsletterCreated",
      partnerId: "p1",
      payload: { partnerName: "Jane Doe", newsletterId: "f1", title: "Fall" },
    };
    const ids = await postToWhatsApp([newsletter], partnerById, settings);
    assert.equal(ids.size, 0);
    assert.equal(sent.length, 0);
  });

  test("one group failing leaves only its rows unsent", async () => {
    mock.method(whatsappClient, "sendText", async (jid) => {
      if (jid === "needs@g.us") throw new Error("[baileys-antiban] Message blocked: paused");
    });
    const ids = await postToWhatsApp([prayer("a", "Pray"), need("c")], partnerById, settings);
    assert.deepEqual([...ids], ["a"]);
  });

  test("a failed piece of a split request leaves that request unsent and skips its later pieces", async () => {
    const sent = [];
    let calls = 0;
    mock.method(whatsappClient, "sendText", async (jid, text) => {
      calls += 1;
      if (calls === 2) throw new Error("boom");
      sent.push(text);
    });
    const long = `${"A very long prayer request. ".repeat(400)}`; // ~11k chars -> 3+ pieces
    const ids = await postToWhatsApp(
      [prayer("long", long), prayer("after", "short one")],
      partnerById,
      settings
    );
    assert.equal(ids.has("long"), false);
    assert.equal(ids.has("after"), true);
    assert.equal(calls, 3); // piece 1 ok, piece 2 failed, remaining pieces skipped, then "after"
  });

  test("a restricted partner's text is masked exactly as for GroupMe", async () => {
    const sent = [];
    mock.method(whatsappClient, "sendText", async (jid, text) => sent.push(text));
    const restricted = new Map([["p1", { id: "p1", displayName: "Jane Doe", isRestricted: true }]]);
    const row = { ...prayer("a", "Secret location details"), reviewedAt: null };
    // postToWhatsApp trusts the caller's eligibility filter, but buildBlurb
    // masks regardless of review state.
    await postToWhatsApp([row], restricted, settings);
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0], /Secret location details/);
    assert.doesNotMatch(sent[0], /Jane Doe/);
  });
});
