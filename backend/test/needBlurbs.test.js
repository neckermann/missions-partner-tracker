const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { buildBlurb } = require("../src/utils/dispatchBlurbs");

// A one-time need can be raised with no dollar figure, and a decision can be a decline. The announcement
// must say so in words, not "$0".
const partner = { id: "p1", displayName: "The Smiths", isRestricted: false };
const row = (type, payload) => ({ id: "r1", type, partnerId: "p1", payload, dispatchReviewedAt: null });

describe("one-time need announcements", () => {
  test("a need with an amount still says what was requested", () => {
    const b = buildBlurb(
      row("supportNeedCreated", { description: "A roof", requestedAmount: 1500, partnerName: "The Smiths" }),
      partner
    );
    assert.match(b.groupmeText, /Requested: \$1,500/);
    assert.equal(b.amount, "$1,500");
  });

  test("a need with no amount says nothing about money", () => {
    const b = buildBlurb(
      row("supportNeedCreated", { description: "A roof", requestedAmount: 0, partnerName: "The Smiths" }),
      partner
    );
    assert.equal(b.amount, null);
    assert.doesNotMatch(b.groupmeText, /\$|Requested/);
  });

  test("an approval shows the amount, a decline says Declined with no amount line", () => {
    const base = { description: "A roof", requestedAmount: 1500, partnerName: "The Smiths" };
    const approved = buildBlurb(row("supportNeedDecided", { ...base, approvedAmount: 1500 }), partner);
    assert.match(approved.groupmeText, /Approved: \$1,500/);
    const declined = buildBlurb(
      row("supportNeedDecided", { ...base, approvedAmount: 0, decisionNote: "Not this year" }),
      partner
    );
    assert.match(declined.summary, /Declined/);
    assert.equal(declined.amount, null);
    assert.doesNotMatch(declined.groupmeText, /Approved:|\$0/);
    assert.match(declined.groupmeText, /Not this year/);
  });
});

describe("the church's currency in announcements", () => {
  const base = {
    description: "A roof",
    requestedAmount: 1500,
    approvedAmount: 1200,
    partnerName: "The Smiths",
  };

  test("a church that set euros sees euros in the request and the approval", () => {
    const created = buildBlurb(row("supportNeedCreated", base), partner, { currency: "EUR" });
    assert.match(created.groupmeText, /Requested: €1,500/);
    assert.doesNotMatch(created.groupmeText, /\$/);
    const decided = buildBlurb(row("supportNeedDecided", base), partner, { currency: "EUR" });
    assert.match(decided.groupmeText, /Approved: €1,200/);
  });

  test("no currency set, or a bad one, reads in dollars as before", () => {
    assert.match(buildBlurb(row("supportNeedCreated", base), partner, {}).groupmeText, /Requested: \$1,500/);
    assert.match(
      buildBlurb(row("supportNeedCreated", base), partner, { currency: "nonsense" }).groupmeText,
      /Requested: \$1,500/
    );
  });
});
