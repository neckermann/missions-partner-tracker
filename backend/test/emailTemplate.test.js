const test = require("node:test");
const assert = require("node:assert/strict");
const { renderEmail, blocks } = require("../src/utils/emailTemplate");

const settings = { churchName: "Grace & Peace", primaryColor: "#0a7", headerColor: "#111" };

test("renders branded shell with eyebrow, greeting, accent color and a text part", () => {
  const m = renderEmail({
    settings,
    subject: "Hello",
    eyebrow: "Trip meeting",
    greetingName: "Sam",
    blocks: [blocks.paragraph("Line one\nLine two"), blocks.button("https://x.test/a", "Open")],
    footerNote: "Small print",
  });
  assert.equal(m.subject, "Hello");
  assert.match(m.html, /Grace &amp; Peace/);
  assert.match(m.html, /Trip meeting/);
  assert.match(m.html, /Hi Sam,/);
  assert.match(m.html, /#0a7/);
  assert.match(m.html, /Line one<br>Line two/);
  assert.match(m.text, /Open: https:\/\/x\.test\/a/);
  assert.match(m.text, /Small print/);
});

test("buttons and links reject non-http(s) URLs", () => {
  const m = renderEmail({
    settings,
    subject: "s",
    blocks: [
      blocks.button("javascript:alert(1)", "Bad"),
      blocks.links("Links", [
        { label: "Evil", url: "data:text/html,x" },
        { label: "Good", url: "https://ok.test" },
      ]),
    ],
  });
  assert.doesNotMatch(m.html, /javascript:/);
  assert.doesNotMatch(m.html, /data:text/);
  assert.match(m.html, /https:\/\/ok\.test/);
});

test("details card drops empty rows and escapes values; omitted entirely when all empty", () => {
  const withRows = renderEmail({
    settings,
    subject: "s",
    blocks: [
      blocks.details([
        { label: "Where", value: "<script>x</script>" },
        { label: "Join", value: null },
      ]),
    ],
  });
  assert.doesNotMatch(withRows.html, /<script>/);
  assert.match(withRows.html, /&lt;script&gt;/);
  assert.doesNotMatch(withRows.html, /Join/);
  assert.match(withRows.text, /Where: <script>x<\/script>/);

  const empty = renderEmail({
    settings,
    subject: "s",
    blocks: [blocks.details([{ label: "A", value: "" }])],
  });
  assert.doesNotMatch(empty.html, /<table/);
});

test("RSVP button row renders each choice, first one filled", () => {
  const m = renderEmail({
    settings,
    subject: "s",
    blocks: [
      blocks.buttonRow([
        { url: "https://x.test/yes", label: "Yes" },
        { url: "https://x.test/no", label: "No" },
      ]),
    ],
  });
  assert.match(m.html, /background-color:#0a7[^>]*>Yes/);
  assert.match(m.html, /border:1px solid #0a7[^>]*>No/);
  assert.match(m.text, /Yes: https:\/\/x\.test\/yes\nNo: https:\/\/x\.test\/no/);
});

test("falls back to default branding when settings are missing", () => {
  const m = renderEmail({ settings: null, subject: "s", blocks: [blocks.paragraph("hi")] });
  assert.match(m.html, /Missions Partner Tracker/);
  assert.match(m.html, /Hi there,/);
});
