// The two care timings are read from the church's settings, falling back to the defaults when
// unset or out of range.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  careTimings,
  cleanAdvanceDays,
  KEY_DATE_LEAD_RANGE,
  CONTACT_STALE_RANGE,
} = require("../src/utils/careSettings");

const dbWith = (row) => ({ churchSettings: { findUnique: async () => row } });

describe("careTimings", () => {
  test("returns the stored values", async () => {
    assert.deepEqual(await careTimings(dbWith({ keyDateLeadDays: 10, contactStaleDays: 45 })), {
      keyDateLeadDays: 10,
      keyDateAdvanceDays: [90, 30],
      contactStaleDays: 45,
    });
  });

  test("falls back to 7 and 90 when there is no settings row, or a value is missing", async () => {
    assert.deepEqual(await careTimings(dbWith(null)), {
      keyDateLeadDays: 7,
      keyDateAdvanceDays: [90, 30],
      contactStaleDays: 90,
    });
    assert.deepEqual(await careTimings(dbWith({})), {
      keyDateLeadDays: 7,
      keyDateAdvanceDays: [90, 30],
      contactStaleDays: 90,
    });
  });

  test("ignores a value outside the allowed range", async () => {
    const out = await careTimings(
      dbWith({ keyDateLeadDays: KEY_DATE_LEAD_RANGE.max + 1, contactStaleDays: CONTACT_STALE_RANGE.min - 1 })
    );
    assert.deepEqual(out, { keyDateLeadDays: 7, keyDateAdvanceDays: [90, 30], contactStaleDays: 90 });
  });
});

describe("cleanAdvanceDays", () => {
  test("keeps sensible heads-ups, biggest first, unique, at most three", () => {
    assert.deepEqual(cleanAdvanceDays([14, 60, 14, 120, 200], 7), [200, 120, 60]);
  });

  test("drops anything inside the final window or out of range", () => {
    assert.deepEqual(cleanAdvanceDays([5, 7, 14, 9999, 2.5, "30"], 7), [14]);
  });

  test("uses the defaults when unset, minus any inside a long final window", () => {
    assert.deepEqual(cleanAdvanceDays(undefined, 7), [90, 30]);
    assert.deepEqual(cleanAdvanceDays(undefined, 45), [90]);
    assert.deepEqual(cleanAdvanceDays([], 7), []);
  });
});
