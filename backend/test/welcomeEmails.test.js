const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWelcomeEmail, guideLinks } = require("../src/utils/welcomeEmails");
const { setupTtlHours, generateToken, hashToken } = require("../src/utils/passwordSetup");

const settings = { churchName: "Hillside <Community>", primaryColor: "#123456", headerColor: "#222222" };
const base = { setupUrl: "https://app.example/set-password?token=abc", expiresInHours: 72, settings };

test("welcome email has the setup link, branding and escaped church name", () => {
  const m = buildWelcomeEmail({
    ...base,
    user: { firstName: "Sam", role: "editor" },
    requireMfa: false,
  });
  assert.match(m.html, /https:\/\/app\.example\/set-password\?token=abc/);
  assert.match(m.html, /#123456/);
  assert.match(m.html, /Hillside &lt;Community&gt;/);
  assert.doesNotMatch(m.html, /Hillside <Community>/);
  assert.match(m.text, /Hi Sam,/);
  assert.match(m.text, /expires in 3 days/);
  assert.doesNotMatch(m.text, /two-factor authentication\. You'll need/);
});

test("MFA note appears only when MFA is required", () => {
  const withMfa = buildWelcomeEmail({ ...base, user: { role: "editor" }, requireMfa: true });
  assert.match(withMfa.text, /authenticator app/);
  assert.match(withMfa.html, /authenticator app/);
});

test("guide links are role-specific and always point at this project's own docs", () => {
  // The guide/MFA links point at the published docs site (a rendered,
  // readable page -- see docs/user-guide.html), not a raw GitHub blob.
  // "Support and help" is the one exception: there's no docs-site page
  // for it, so it stays a direct link to this repo's own GitHub Issues.
  function assertDocLink(url) {
    assert.match(url, /^https:\/\/missionspartnertracker\.com\//);
  }

  const editorLinks = guideLinks("editor");
  assert.deepEqual(
    editorLinks.map((l) => l.label),
    ["User guide", "Support and help", "Setting up two-factor authentication"]
  );
  assertDocLink(editorLinks[0].url);
  assert.match(editorLinks[1].url, /^https:\/\/github\.com\/.*\/issues$/);
  assertDocLink(editorLinks[2].url);

  const guestLinks = guideLinks("guest");
  assert.deepEqual(
    guestLinks.map((l) => l.label),
    ["Guest guide", "Support and help", "Setting up two-factor authentication"]
  );
  assertDocLink(guestLinks[0].url);
  assert.match(guestLinks[1].url, /^https:\/\/github\.com\/.*\/issues$/);
  assertDocLink(guestLinks[2].url);
});

test("guests get a longer fixed expiry than everyone else", () => {
  assert.equal(setupTtlHours("editor"), 72);
  assert.equal(setupTtlHours("guest"), 168);
});

test("tokens are random, url-safe, and hashed deterministically", () => {
  const a = generateToken();
  assert.notEqual(a, generateToken());
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashToken(a), hashToken(a));
  assert.notEqual(hashToken(a), a);
});
