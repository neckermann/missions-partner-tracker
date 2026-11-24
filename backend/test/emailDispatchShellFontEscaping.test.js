// #327 Finding 11.4 -- the font-family fallback
// ('-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif')
// was dropped straight into a double-quoted style="font-family:..."
// attribute with no escaping, breaking the attribute open on *every*
// rendered email/page that didn't have a custom brandFont configured --
// i.e. nearly every install. Fixed by escaping fontFamily the same way
// every other interpolated value in these templates already is.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildEmailDispatchMessage, buildTransactionalMessage } = require("../src/utils/emailDispatchShell");

function assertFontFamilyAttributeIntact(html) {
  // The real bug: a raw, unescaped `"` inside the attribute value closes
  // it early, so `style="font-family:...,"Segoe UI",...;max-width:..."`
  // would leave `max-width:600px` sitting outside the attribute as bare
  // text. Confirm the escaped form is present instead, and that nothing
  // broke the attribute into loose text.
  assert.match(html, /font-family:[^"]*&quot;Segoe UI&quot;[^"]*max-width:600px/);
  assert.doesNotMatch(html, /style="font-family:[^"]*"Segoe/);
}

test("buildEmailDispatchMessage escapes the default font fallback inside the style attribute", () => {
  const message = buildEmailDispatchMessage(
    { email: "person@example.test" },
    { itemsHtml: "", textLines: [], subtitleLine: "Updates" },
    {},
    "https://app.example.test/unsubscribe?token=x"
  );
  assertFontFamilyAttributeIntact(message.HtmlBody);
});

test("buildTransactionalMessage escapes the default font fallback inside the style attribute", () => {
  const message = buildTransactionalMessage({
    settings: {},
    subject: "Welcome",
    subtitleLine: "Welcome",
    bodyHtml: "<p>Hi</p>",
    bodyText: "Hi",
  });
  assertFontFamilyAttributeIntact(message.html);
});
