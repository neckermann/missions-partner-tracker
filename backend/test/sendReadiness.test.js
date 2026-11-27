const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  emailScheduleProblem,
  isGroupMeUnfinished,
  isWhatsAppUnfinished,
  isChatTimeMissing,
} = require("../src/utils/sendReadiness");

// Email on with a mail account and From address: able to send.
const emailReady = {
  enabledFeatures: { outboundEmail: true },
  postmarkServerToken: "enc:token",
  emailFromAddress: "updates@example.test",
  cadenceBiweeklyEnabled: false,
  cadenceMonthlyEnabled: true,
  cadenceQuarterlyEnabled: true,
  emailDispatchDayOfWeek: null,
  emailDispatchDayOfMonth: null,
  emailDispatchHour: null,
};

describe("email schedule that cannot fire", () => {
  test("email set up with no schedule at all", () => {
    assert.equal(emailScheduleProblem(emailReady), "none");
  });

  test("a rhythm ticked with no day", () => {
    assert.equal(emailScheduleProblem({ ...emailReady, emailDispatchHour: 9 }), "half");
    assert.equal(
      emailScheduleProblem({
        ...emailReady,
        cadenceBiweeklyEnabled: true,
        emailDispatchDayOfMonth: 5,
        emailDispatchHour: 9,
      }),
      "half",
      "biweekly is offered but has no weekday"
    );
  });

  test("a day with no time", () => {
    assert.equal(emailScheduleProblem({ ...emailReady, emailDispatchDayOfMonth: 5 }), "half");
  });

  test("midnight and Sunday are real values, not 'not set'", () => {
    assert.equal(
      emailScheduleProblem({
        ...emailReady,
        cadenceBiweeklyEnabled: true,
        emailDispatchDayOfWeek: 0,
        emailDispatchDayOfMonth: 1,
        emailDispatchHour: 0,
      }),
      null
    );
  });

  test("a complete schedule is fine, and an unused day is not asked for", () => {
    assert.equal(
      emailScheduleProblem({ ...emailReady, emailDispatchDayOfMonth: 5, emailDispatchHour: 9 }),
      null
    );
  });

  test("says nothing when email is off, or isn't set up yet (that has its own notice)", () => {
    assert.equal(emailScheduleProblem({ ...emailReady, enabledFeatures: { outboundEmail: false } }), null);
    assert.equal(emailScheduleProblem({ ...emailReady, postmarkServerToken: null }), null);
    assert.equal(emailScheduleProblem(null), null);
  });

  test("says nothing when no rhythm is offered", () => {
    assert.equal(
      emailScheduleProblem({ ...emailReady, cadenceMonthlyEnabled: false, cadenceQuarterlyEnabled: false }),
      null
    );
  });
});

describe("chat services that are on but cannot post", () => {
  const groupme = (extra) => ({ enabledFeatures: { groupme: true }, ...extra });
  const whatsapp = (extra) => ({ enabledFeatures: { whatsapp: true }, ...extra });

  test("GroupMe on with no token, or no group", () => {
    assert.equal(isGroupMeUnfinished(groupme({})), true);
    assert.equal(isGroupMeUnfinished(groupme({ groupmeAccessToken: "enc:t" })), true);
    assert.equal(isGroupMeUnfinished(groupme({ groupmeGroupId: "1" })), true);
    assert.equal(isGroupMeUnfinished(groupme({ groupmeAccessToken: "enc:t", groupmeGroupId: "1" })), false);
    assert.equal(isGroupMeUnfinished({ enabledFeatures: { groupme: false } }), false);
  });

  test("WhatsApp on and not linked, or linked with nowhere to post", () => {
    assert.equal(isWhatsAppUnfinished(whatsapp({})), true);
    assert.equal(isWhatsAppUnfinished(whatsapp({ whatsappPairedAt: new Date() })), true);
    assert.equal(isWhatsAppUnfinished(whatsapp({ whatsappAnnouncementGroupId: "g" })), true);
    assert.equal(
      isWhatsAppUnfinished(whatsapp({ whatsappPairedAt: new Date(), whatsappAnnouncementGroupId: "g" })),
      false
    );
    assert.equal(
      isWhatsAppUnfinished(whatsapp({ whatsappPairedAt: new Date(), whatsappPrayerGroupId: "g" })),
      false
    );
    assert.equal(isWhatsAppUnfinished({ enabledFeatures: { whatsapp: false } }), false);
  });

  test("the chat time is missing while a chat service is on", () => {
    assert.equal(isChatTimeMissing(groupme({ chatDispatchHour: null })), true);
    assert.equal(isChatTimeMissing(whatsapp({})), true);
    assert.equal(isChatTimeMissing(groupme({ chatDispatchHour: 0 })), false, "midnight is a time");
    assert.equal(isChatTimeMissing({ enabledFeatures: {}, chatDispatchHour: null }), false);
  });
});
