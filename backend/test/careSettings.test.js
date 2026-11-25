// #365: the two care timings are read from the church's settings, falling back to the old fixed
// values when unset or out of range.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { careTimings, KEY_DATE_LEAD_RANGE, CONTACT_STALE_RANGE } = require("../src/utils/careSettings");

const dbWith = (row) => ({ churchSettings: { findUnique: async () => row } });

describe("careTimings", () => {
  test("returns the stored values", async () => {
    assert.deepEqual(await careTimings(dbWith({ keyDateLeadDays: 10, contactStaleDays: 45 })), {
      keyDateLeadDays: 10,
      contactStaleDays: 45,
    });
  });

  test("falls back to 7 and 90 when there is no settings row, or a value is missing", async () => {
    assert.deepEqual(await careTimings(dbWith(null)), { keyDateLeadDays: 7, contactStaleDays: 90 });
    assert.deepEqual(await careTimings(dbWith({})), { keyDateLeadDays: 7, contactStaleDays: 90 });
  });

  test("ignores a value outside the allowed range", async () => {
    const out = await careTimings(
      dbWith({ keyDateLeadDays: KEY_DATE_LEAD_RANGE.max + 1, contactStaleDays: CONTACT_STALE_RANGE.min - 1 })
    );
    assert.deepEqual(out, { keyDateLeadDays: 7, contactStaleDays: 90 });
  });
});
