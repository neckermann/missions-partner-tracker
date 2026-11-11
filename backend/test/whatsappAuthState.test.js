const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

// Must be set before crypto.js reads it (see crypto.test.js).
process.env.FIELD_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
// whatsappAuthState.js requires prismaClient.js for its default table,
// which reads DATABASE_URL eagerly -- the tests below always inject an
// in-memory table instead, so no DB is touched.
require("dotenv").config({ quiet: true });
const { useDbAuthState, clearAuthState } = require("../src/utils/whatsappAuthState");
const { encryptField } = require("../src/utils/crypto");

// A minimal in-memory stand-in for prisma.whatsAppAuthEntry.
function fakeTable() {
  const rows = new Map();
  return {
    rows,
    async findUnique({ where }) {
      return rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null;
    },
    async findMany({ where }) {
      return where.key.in.filter((k) => rows.has(k)).map((k) => ({ key: k, value: rows.get(k) }));
    },
    async upsert({ where, create, update }) {
      rows.set(where.key, rows.has(where.key) ? update.value : create.value);
    },
    async deleteMany({ where } = {}) {
      const keys = where?.key?.in ?? [...rows.keys()];
      keys.forEach((k) => rows.delete(k));
    },
  };
}

let baileys;
before(async () => {
  baileys = await import("baileys");
});

describe("useDbAuthState", () => {
  test("a brand-new store starts with fresh, unregistered creds", async () => {
    const { state } = await useDbAuthState(baileys, fakeTable());
    assert.equal(state.creds.registered, false);
  });

  test("saved creds survive a restart, binary fields intact", async () => {
    const table = fakeTable();
    const first = await useDbAuthState(baileys, table);
    first.state.creds.registered = true;
    await first.saveCreds();

    const second = await useDbAuthState(baileys, table);
    assert.equal(second.state.creds.registered, true);
    assert.ok(Buffer.isBuffer(second.state.creds.noiseKey.private));
    assert.deepEqual(second.state.creds.noiseKey.private, first.state.creds.noiseKey.private);
  });

  test("nothing is stored in plaintext", async () => {
    const table = fakeTable();
    const { state, saveCreds } = await useDbAuthState(baileys, table);
    await saveCreds();
    await state.keys.set({
      "pre-key": { 7: { public: Buffer.from("PLAINTEXT-MARKER"), private: Buffer.alloc(32, 1) } },
    });

    assert.ok(table.rows.size >= 2);
    for (const value of table.rows.values()) {
      assert.match(value, /^v1:/);
      assert.doesNotMatch(value, /noiseKey|PLAINTEXT-MARKER/);
    }
    assert.doesNotMatch(Buffer.from([...table.rows.values()].join("")).toString(), /PLAINTEXT-MARKER/);
  });

  test("signal keys round-trip, and a null value deletes the key", async () => {
    const table = fakeTable();
    const { state } = await useDbAuthState(baileys, table);
    const key = { public: Buffer.from("pub"), private: Buffer.from("priv") };
    await state.keys.set({ "pre-key": { 1: key, 2: key } });

    const got = await state.keys.get("pre-key", ["1", "2", "3"]);
    assert.deepEqual(Object.keys(got).sort(), ["1", "2"]);
    assert.deepEqual(got["1"].public, Buffer.from("pub"));

    await state.keys.set({ "pre-key": { 1: null } });
    assert.deepEqual(Object.keys(await state.keys.get("pre-key", ["1", "2"])), ["2"]);
  });

  test("an undecryptable row (rotated FIELD_ENCRYPTION_KEY) is treated as missing, not a crash", async () => {
    const table = fakeTable();
    table.rows.set("creds", "v1:AAAA:AAAA:AAAA"); // garbage ciphertext
    const { state } = await useDbAuthState(baileys, table);
    assert.equal(state.creds.registered, false); // fresh creds -> admin re-pairs
    table.rows.set("pre-key-9", "not-even-the-format");
    assert.deepEqual(await state.keys.get("pre-key", ["9"]), {});
  });

  test("a row encrypted by something else but valid JSON is still read normally", async () => {
    const table = fakeTable();
    table.rows.set("session-x", encryptField(JSON.stringify({ hello: "world" })));
    const { state } = await useDbAuthState(baileys, table);
    assert.deepEqual(await state.keys.get("session", ["x"]), { x: { hello: "world" } });
  });
});

describe("clearAuthState", () => {
  test("wipes every row", async () => {
    const table = fakeTable();
    table.rows.set("creds", "x");
    table.rows.set("pre-key-1", "y");
    await clearAuthState(table);
    assert.equal(table.rows.size, 0);
  });
});
