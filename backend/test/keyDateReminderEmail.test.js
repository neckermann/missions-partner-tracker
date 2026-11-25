// #291: the wording and masking of the daily key-date email. Pure -- no
// database, no network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildKeyDateEmail, describe: describeItem, when } = require("../src/utils/keyDateReminderEmail");

const user = { firstName: "Dana", email: "dana@example.test" };
const settings = { churchName: "Grace Church", restrictedPartnerInitialsEnabled: true };
const open = (over = {}) => ({
  partnerId: "p1",
  kind: "birthday",
  subjectId: "a1",
  who: "Sam Reed",
  occasion: "Birthday",
  date: "2026-11-28",
  daysUntil: 4,
  turning: 46,
  partner: {
    id: "p1",
    displayName: "The Reeds",
    fieldDisplayName: "Uganda",
    isRestricted: false,
    contactLevel: "normal",
  },
  ...over,
});

test("says when, with today and tomorrow spelled out", () => {
  assert.equal(when(open({ daysUntil: 0 })), "Today · Sat Nov 28");
  assert.equal(when(open({ daysUntil: 1 })), "Tomorrow · Sat Nov 28");
  assert.equal(when(open({ daysUntil: 4 })), "In 4 days · Sat Nov 28");
});

test("describes each kind of date", () => {
  assert.equal(describeItem(open(), settings), "The Reeds: Sam Reed's birthday (turning 46)");
  assert.equal(
    describeItem(open({ kind: "anniversary", who: "", turning: 18 }), settings),
    "The Reeds: wedding anniversary (18 years)"
  );
  assert.equal(
    describeItem(open({ kind: "supportingSince", who: "", turning: 5 }), settings),
    "The Reeds: 5 years of our support"
  );
  assert.equal(
    describeItem(open({ kind: "supportingSince", who: "", turning: 1 }), settings),
    "The Reeds: 1 year of our support"
  );
});

test("a restricted partner is masked and its family's names are left out", () => {
  const restricted = open({
    partner: {
      id: "p1",
      displayName: "Mary Lou Green",
      fieldDisplayName: "Northern Uganda",
      isRestricted: true,
      contactLevel: "normal",
    },
  });
  const line = describeItem(restricted, settings);
  assert.ok(!line.includes("Mary Lou Green"), "the real name never goes out");
  assert.ok(!line.includes("Sam Reed"), "nor the family member's name");
  assert.match(line, /a birthday \(turning 46\)/);

  // initials off: falls back to the field label, still never the real name
  const noInitials = describeItem(restricted, { ...settings, restrictedPartnerInitialsEnabled: false });
  assert.ok(noInitials.startsWith("Northern Uganda:"));
});

test("a not-safe-to-contact partner gets a pointer, never the instructions", () => {
  const unsafe = open({
    partner: {
      id: "p1",
      displayName: "The Reeds",
      isRestricted: false,
      contactLevel: "no_direct",
      contactInstructions: "SECRET: go through the sending org",
    },
  });
  const line = describeItem(unsafe, settings);
  assert.match(line, /special communication instructions apply/);
  assert.ok(!line.includes("SECRET"));
  const email = buildKeyDateEmail({ user, items: [unsafe], settings, appUrl: "https://app.example" });
  assert.ok(!email.html.includes("SECRET") && !email.text.includes("SECRET"));
});

test("one grouped email, singular or plural, with a link and how to clear it", () => {
  const one = buildKeyDateEmail({ user, items: [open()], settings, appUrl: "https://app.example" });
  assert.equal(one.subject, "1 key date coming up for your Grace Church partners");
  const many = buildKeyDateEmail({
    user,
    items: [
      open(),
      open({
        partnerId: "p2",
        partner: { id: "p2", displayName: "The Okafors", isRestricted: false, contactLevel: "normal" },
      }),
    ],
    settings,
    appUrl: "https://app.example",
  });
  assert.equal(many.subject, "2 key dates coming up for your Grace Church partners");
  assert.ok(
    many.text.includes("The Reeds") && many.text.includes("The Okafors"),
    "both partners in the ONE email"
  );
  assert.ok(many.html.includes("https://app.example/admin/partners?assigned=1"));
  assert.match(many.text, /Key date/);
});

test("no link when the app's base URL isn't known", () => {
  const email = buildKeyDateEmail({ user, items: [open()], settings, appUrl: "" });
  assert.ok(!email.html.includes("assigned=1"));
});
