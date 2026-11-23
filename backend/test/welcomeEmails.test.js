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
  const editorLinks = guideLinks("editor");
  assert.deepEqual(
    editorLinks.map((l) => l.label),
    ["User guide", "Support and help", "Setting up two-factor authentication"]
  );
  editorLinks.forEach((l) => assert.match(l.url, /^https:\/\/github\.com\//));

  const leaderLinks = guideLinks("tripLeader");
  assert.deepEqual(
    leaderLinks.map((l) => l.label),
    ["Trip Leader guide", "Support and help", "Setting up two-factor authentication"]
  );
  leaderLinks.forEach((l) => assert.match(l.url, /^https:\/\/github\.com\//));
});

test("trip leaders get a longer fixed expiry than everyone else", () => {
  assert.equal(setupTtlHours("editor"), 72);
  assert.equal(setupTtlHours("tripLeader"), 168);
});

test("tokens are random, url-safe, and hashed deterministically", () => {
  const a = generateToken();
  assert.notEqual(a, generateToken());
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashToken(a), hashToken(a));
  assert.notEqual(hashToken(a), a);
});
