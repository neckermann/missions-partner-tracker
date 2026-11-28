// #592: the emailed sign-in link says not to forward it, because a forwarded message or a shared inbox would
// otherwise hand the account to anyone who reads it. The other two link emails are covered by unit tests; this
// one needs the database (it issues a real link), so it lives with the route tests.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const emailModule = require("../../src/utils/email");
const { sendSignInLinkEmail } = require("../../src/utils/passwordless");
const { stopServer } = require("./helpers");

let user;

after(async () => {
  if (user) {
    await prisma.signInLinkToken.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
  await stopServer();
});

test("the emailed sign-in link says not to forward it", async () => {
  user = await prisma.user.create({
    data: {
      email: "route-test-link-note@example.test",
      passwordHash: null,
      role: "editor",
      active: true,
      authProvider: "local",
      firstName: "Pat",
    },
  });
  const original = emailModule.sendEmail;
  let sent;
  emailModule.sendEmail = async (message) => {
    sent = message;
  };
  try {
    await sendSignInLinkEmail(user);
  } finally {
    emailModule.sendEmail = original;
  }
  assert.ok(sent, "an email was handed to the sender");
  assert.equal(sent.to, user.email);
  assert.match(sent.text, /Don't forward this email/);
  assert.match(sent.text, /shared address such as missions@/);
});
