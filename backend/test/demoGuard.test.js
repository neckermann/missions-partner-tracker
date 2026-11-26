// A1 of the November 2026 app review: a guarded public demo (DEMO_RESET_TOKEN set, DEMO_TESTING_SITE not)
// must never let a visitor's action leave the app or spend the owner's keys. Each sender checks the
// environment itself, so these call them directly with `fetch` rigged to fail the test if anything tries
// to reach the network, and with no database settings behind them. The owner's own test deployment
// (DEMO_TESTING_SITE=true) must still try to send.
const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const { sendEmail, sendEmailBatch } = require("../src/utils/email");
const { postMessage } = require("../src/utils/groupmeChannel");
const whatsappClient = require("../src/utils/whatsappClient");
const { extractRequestsFromFile } = require("../src/utils/extraction");
const { isGuardedDemo, isTestingSite } = require("../src/utils/demoMode");

const KEYS = ["DEMO_RESET_TOKEN", "DEMO_TESTING_SITE"];
let saved;
let realFetch;
let fetchCalls;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  realFetch = global.fetch;
  fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args[0]);
    throw new Error("the network must not be reached");
  };
});

afterEach(() => {
  global.fetch = realFetch;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function guarded() {
  process.env.DEMO_RESET_TOKEN = "test-token";
  delete process.env.DEMO_TESTING_SITE;
}

describe("which deployments are guarded", () => {
  test("a demo is guarded; the testing site and a real deployment are not", () => {
    guarded();
    assert.equal(isGuardedDemo(), true);
    process.env.DEMO_TESTING_SITE = "true";
    assert.equal(isTestingSite(), true);
    assert.equal(isGuardedDemo(), false);
    delete process.env.DEMO_RESET_TOKEN;
    delete process.env.DEMO_TESTING_SITE;
    assert.equal(isGuardedDemo(), false);
  });
});

describe("a guarded demo sends nothing that leaves the app", () => {
  test("email, single and batch, is reported as sent but never reaches Postmark", async () => {
    guarded();
    const one = await sendEmail({ to: "someone@example.test", subject: "Hello", text: "hi" });
    assert.equal(one.ErrorCode, 0);
    const batch = await sendEmailBatch([{ To: "a@example.test" }, { To: "b@example.test" }]);
    assert.equal(batch.length, 2);
    assert.ok(batch.every((r) => r.ErrorCode === 0));
    assert.deepEqual(fetchCalls, []);
  });

  test("a GroupMe post does not call GroupMe", async () => {
    guarded();
    await postMessage("a-token", "a-group", "their own words");
    assert.deepEqual(fetchCalls, []);
  });

  test("a WhatsApp message is not sent, and does not need a connection", async () => {
    guarded();
    await assert.doesNotReject(() => whatsappClient.sendText("1234@g.us", "their own words"));
  });

  test("the AI scan is refused before any key is read", async () => {
    guarded();
    await assert.rejects(
      () =>
        extractRequestsFromFile({
          fileName: "letter.txt",
          contentType: "text/plain",
          bytesRow: { bytes: Buffer.from("x") },
        }),
      (err) => err.status === 403 && /public demo/.test(err.message)
    );
    assert.deepEqual(fetchCalls, []);
  });
});

describe("the owner's own test deployment still tries to send", () => {
  test("email is not stubbed (it fails here only because no mail account is set up)", async () => {
    guarded();
    process.env.DEMO_TESTING_SITE = "true";
    await assert.rejects(() => sendEmail({ to: "someone@example.test", subject: "Hello", text: "hi" }));
  });

  test("a GroupMe post goes to the network", async () => {
    guarded();
    process.env.DEMO_TESTING_SITE = "true";
    await assert.rejects(() => postMessage("a-token", "a-group", "words"), /network must not be reached/);
    assert.equal(fetchCalls.length, 1);
  });
});
