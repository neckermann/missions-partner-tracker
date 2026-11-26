const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { isFeatureEnabled } = require("../src/utils/features");

describe("isFeatureEnabled", () => {
  test("defaults to enabled for a key with no stored value (partnerFiles)", () => {
    assert.equal(isFeatureEnabled({}, "partnerFiles"), true);
    assert.equal(isFeatureEnabled(null, "partnerFiles"), true);
  });

  // A new install should be useful straight away: these two are the core of keeping in touch with partners,
  // and a church can still switch either off (an explicit false wins).
  test("the contact log and key-date reminders are on for a church that has never chosen", () => {
    for (const key of ["contactLog", "keyDates"]) {
      assert.equal(isFeatureEnabled({}, key), true, key);
      assert.equal(isFeatureEnabled(null, key), true, key);
      assert.equal(isFeatureEnabled({ [key]: false }, key), false, `${key} can be turned off`);
    }
  });

  // A new install publishes nothing until the church chooses (A2b of the November 2026 review).
  test("the public directory and map are off for a church that has never chosen, and can be turned on", () => {
    for (const key of ["publicDirectory", "publicMap"]) {
      assert.equal(isFeatureEnabled({}, key), false, key);
      assert.equal(isFeatureEnabled(null, key), false, key);
      assert.equal(isFeatureEnabled({ [key]: true }, key), true, `${key} can be turned on`);
    }
  });

  test("an explicit false overrides the default-enabled state", () => {
    assert.equal(isFeatureEnabled({ partnerFiles: false }, "partnerFiles"), false);
  });

  test("an explicit true keeps a default-enabled feature on", () => {
    assert.equal(isFeatureEnabled({ partnerFiles: true }, "partnerFiles"), true);
  });

  test("returns false for a key not in the registry", () => {
    assert.equal(isFeatureEnabled({ notReal: true }, "notReal"), false);
  });

  describe("aiExtraction (defaults to off, same as any other opt-in feature)", () => {
    // A plain toggle like groupme/joshuaProject, with no env-var gate: the API key is
    // admin-managed in ChurchSettings (see test/routes/aiExtraction.test.js).
    test("stays off with no stored value", () => {
      assert.equal(isFeatureEnabled({}, "aiExtraction"), false);
    });

    test("an explicit true turns it on", () => {
      assert.equal(isFeatureEnabled({ aiExtraction: true }, "aiExtraction"), true);
    });
  });

  describe("requires (a dependency is declared once, in the registry)", () => {
    const { FEATURES, FEATURE_KEYS, unmetRequirements } = require("../src/utils/features");

    test("every requirement is a real feature, and there are no cycles", () => {
      for (const key of FEATURE_KEYS) {
        for (const req of FEATURES[key].requires || []) {
          assert.ok(FEATURES[req], `${key} requires unknown feature ${req}`);
        }
        const seen = new Set();
        const walk = (k) => {
          assert.ok(!seen.has(k), `cycle through ${k}`);
          seen.add(k);
          (FEATURES[k].requires || []).forEach(walk);
          seen.delete(k);
        };
        walk(key);
      }
    });

    test("a feature is on only while it and everything it requires are on", () => {
      assert.equal(isFeatureEnabled({ publicTripDiscovery: true, trips: true }, "publicTripDiscovery"), true);
      assert.equal(
        isFeatureEnabled({ publicTripDiscovery: true, trips: false }, "publicTripDiscovery"),
        false
      );
      assert.equal(
        isFeatureEnabled({ publicTripDiscovery: false, trips: true }, "publicTripDiscovery"),
        false
      );
      // The digest needs the public directory to run; needing email to be switched on is a setup step only.
      const digestOn = { publicPrayerDigest: true, outboundEmail: false, publicDirectory: true };
      assert.equal(isFeatureEnabled(digestOn, "publicPrayerDigest"), true);
      assert.equal(isFeatureEnabled({ ...digestOn, publicDirectory: false }, "publicPrayerDigest"), false);
    });

    test("a requirement's default counts, and unmetRequirements names what is off", () => {
      // partnerFiles defaults on, so AI extraction needs only its own switch...
      assert.equal(isFeatureEnabled({ aiExtraction: true }, "aiExtraction"), true);
      // ...and is off while its requirement is switched off.
      assert.equal(isFeatureEnabled({ aiExtraction: true, partnerFiles: false }, "aiExtraction"), false);
      assert.deepEqual(unmetRequirements({ aiExtraction: true, partnerFiles: false }, "aiExtraction"), [
        "partnerFiles",
      ]);
      assert.deepEqual(unmetRequirements({ aiExtraction: true }, "aiExtraction"), []);
    });

    test("the care features no longer need Care teams: anyone can look after partners via the missions team", () => {
      for (const key of ["keyDates", "supportPreferences", "surveys", "contactLog"]) {
        assert.ok(!(FEATURES[key].requires || []).includes("careTeam"), `${key} must not require careTeam`);
      }
      assert.equal(isFeatureEnabled({ keyDates: true, careTeam: false }, "keyDates"), true);
    });

    test("partner surveys and the other standalone features require nothing", () => {
      assert.deepEqual(FEATURES.surveys.requires || [], []);
      assert.deepEqual(FEATURES.contactLog.requires || [], []);
    });
  });

  describe("withoutEmail (what you get when Email (Sending) is off)", () => {
    const { FEATURES } = require("../src/utils/features");

    test("a note is one real sentence, and a feature that needs email to be switched on has one", () => {
      for (const [key, f] of Object.entries(FEATURES)) {
        if (f.withoutEmail !== undefined) {
          assert.ok(
            typeof f.withoutEmail === "string" && f.withoutEmail.trim().length > 20,
            `${key}: say what you get`
          );
        }
        if ((f.setupNeeds || []).includes("outboundEmail") || (f.requires || []).includes("outboundEmail")) {
          assert.ok(f.withoutEmail, `${key} depends on email, so it must say what happens without it`);
        }
      }
    });
  });
});
