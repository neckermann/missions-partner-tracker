const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { isMinorForTrip } = require("../src/utils/tripParticipantSchema");

describe("isMinorForTrip", () => {
  test("younger than 18 as of the trip's startDate is a minor", () => {
    // Turns 17 the day of the trip -- still a minor.
    assert.equal(isMinorForTrip("2010-06-15", "2027-06-15"), true);
  });

  test("exactly 18 as of the trip's startDate (birthday has occurred) is NOT a minor", () => {
    assert.equal(isMinorForTrip("2009-06-15", "2027-06-15"), false);
  });

  test("turns 18 the day after the trip starts -- still a minor for this trip", () => {
    assert.equal(isMinorForTrip("2009-06-16", "2027-06-15"), true);
  });

  test("same month, birthday already passed within the month -- not a minor", () => {
    assert.equal(isMinorForTrip("2009-06-10", "2027-06-15"), false);
  });

  test("same month, birthday still ahead within the month -- still a minor", () => {
    assert.equal(isMinorForTrip("2009-06-20", "2027-06-15"), true);
  });

  test("well into adulthood is never a minor", () => {
    assert.equal(isMinorForTrip("1980-01-01", "2027-06-15"), false);
  });

  test("missing dateOfBirth defaults to not-a-minor", () => {
    assert.equal(isMinorForTrip(null, "2027-06-15"), false);
    assert.equal(isMinorForTrip(undefined, "2027-06-15"), false);
  });

  test("missing tripStartDate defaults to not-a-minor", () => {
    assert.equal(isMinorForTrip("2010-06-15", null), false);
  });
});
