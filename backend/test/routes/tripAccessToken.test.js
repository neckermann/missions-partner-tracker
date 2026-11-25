// buildTripParticipantAccessToken must carry an expiresIn: the token opens a minor's record,
// donor contact info, flights and documents, so it can't stay valid indefinitely, revoked only
// by an admin bumping accessTokenVersion. Pure unit tests against the token-building function:
// this is about the signed claims, not the routes that consume them.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const jwt = require("jsonwebtoken");
const { buildTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");

const DAY_MS = 24 * 60 * 60 * 1000;

function expClaim(token) {
  return jwt.decode(token).exp;
}

describe("#327 Finding 6 -- trip participant access token now expires", () => {
  test("a trip ending in the future gets an expiry around endDate + 90 days", async () => {
    const endDate = new Date(Date.now() + 30 * DAY_MS);
    const token = buildTripParticipantAccessToken({
      id: "p1",
      accessTokenVersion: 0,
      trip: { endDate, startDate: null },
    });
    const expectedExp = Math.floor((endDate.getTime() + 90 * DAY_MS) / 1000);
    assert.ok(
      Math.abs(expClaim(token) - expectedExp) < 5,
      "exp should land within a few seconds of endDate + 90 days"
    );
  });

  test("falls back to startDate when there's no endDate", async () => {
    const startDate = new Date(Date.now() + 10 * DAY_MS);
    const token = buildTripParticipantAccessToken({
      id: "p1",
      accessTokenVersion: 0,
      trip: { endDate: null, startDate },
    });
    const expectedExp = Math.floor((startDate.getTime() + 90 * DAY_MS) / 1000);
    assert.ok(Math.abs(expClaim(token) - expectedExp) < 5);
  });

  test("a trip with no dates at all falls back to a flat 1 year, not infinite", async () => {
    const token = buildTripParticipantAccessToken({
      id: "p1",
      accessTokenVersion: 0,
      trip: { endDate: null, startDate: null },
    });
    const oneYearFromNow = Math.floor((Date.now() + 365 * DAY_MS) / 1000);
    assert.ok(Math.abs(expClaim(token) - oneYearFromNow) < 5);
  });

  test("a backfilled trip whose end date + 90 days has already long passed also falls back to 1 year, not an already-expired token", async () => {
    const endDate = new Date(Date.now() - 500 * DAY_MS); // well past end + 90 days
    const token = buildTripParticipantAccessToken({
      id: "p1",
      accessTokenVersion: 0,
      trip: { endDate, startDate: null },
    });
    const oneYearFromNow = Math.floor((Date.now() + 365 * DAY_MS) / 1000);
    assert.ok(Math.abs(expClaim(token) - oneYearFromNow) < 5, "must not mint an already-expired token");
  });

  test("no trip relation loaded at all (participant.trip undefined) also falls back to 1 year", async () => {
    const token = buildTripParticipantAccessToken({ id: "p1", accessTokenVersion: 0 });
    const oneYearFromNow = Math.floor((Date.now() + 365 * DAY_MS) / 1000);
    assert.ok(Math.abs(expClaim(token) - oneYearFromNow) < 5);
  });

  test("the token is rejected once actually expired", async () => {
    const token = jwt.sign({ id: "p1", v: 0, tripParticipantAccess: true }, process.env.SESSION_SECRET, {
      expiresIn: -1,
    });
    const { verifyTripParticipantAccessToken } = require("../../src/utils/tripAccessToken");
    assert.equal(verifyTripParticipantAccessToken(token), null);
  });
});
