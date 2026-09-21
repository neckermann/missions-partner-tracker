const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { sendStoredFile, safeFilename } = require("../src/utils/fileResponse");

function fakeRes() {
  const headers = {};
  return {
    headers,
    sent: undefined,
    set(k, v) {
      headers[k] = v;
      return this;
    },
    send(body) {
      this.sent = body;
      return this;
    },
  };
}

describe("safeFilename", () => {
  test("leaves an ordinary filename alone", () => {
    assert.equal(safeFilename("Spring Update.pdf"), "Spring Update.pdf");
  });

  // busboy percent-decodes RFC 5987 filename*, so control characters can
  // survive an upload and reach a response header. Node rejects those when
  // setting a header, which would turn a bad filename into a 500.
  test("strips CR/LF so a filename can't inject a header", () => {
    assert.equal(safeFilename("a\r\nX-Evil: 1.eml"), "aX-Evil: 1.eml");
  });

  test("strips quotes and backslashes that would escape the quoted value", () => {
    assert.equal(safeFilename('we"ird".eml'), "weird.eml");
    // Built from a char code so the literal backslash survives editing --
    // written inline it is one keystroke from becoming an escape sequence.
    const BACKSLASH = String.fromCharCode(92);
    assert.equal(safeFilename("a" + BACKSLASH + "b.pdf"), "ab.pdf");
  });

  test("never returns an empty name", () => {
    assert.equal(safeFilename(""), "file");
    assert.equal(safeFilename(null), "file");
    assert.equal(safeFilename('"""'), "file");
  });
});

describe("sendStoredFile", () => {
  const verified = ["application/pdf", "image/jpeg", "image/png"];

  for (const type of verified) {
    test(`${type} is served inline -- its bytes were checked on upload`, () => {
      const res = fakeRes();
      sendStoredFile(res, { contentType: type, fileName: "x", bytes: Buffer.from("a") });
      assert.equal(res.headers["Content-Type"], type);
      assert.match(res.headers["Content-Disposition"], /^inline;/);
    });
  }

  // The vector this closes: .eml skips signature verification (no reliable
  // magic bytes across mail clients) and stores the client's declared type,
  // so an editor could upload `notes.eml` claiming text/html and have an
  // admin render attacker markup on this app's own origin.
  test("an unverified type downloads instead of rendering", () => {
    const res = fakeRes();
    sendStoredFile(res, { contentType: "text/html", fileName: "notes.eml", bytes: Buffer.from("<h1>hi") });
    assert.equal(res.headers["Content-Type"], "application/octet-stream");
    assert.match(res.headers["Content-Disposition"], /^attachment;/);
  });

  test("a missing content type downloads too", () => {
    const res = fakeRes();
    sendStoredFile(res, { contentType: null, fileName: "mystery", bytes: Buffer.from("a") });
    assert.equal(res.headers["Content-Type"], "application/octet-stream");
    assert.match(res.headers["Content-Disposition"], /^attachment;/);
  });

  test("stored files are never cached by a shared cache", () => {
    const res = fakeRes();
    sendStoredFile(res, { contentType: "application/pdf", fileName: "x.pdf", bytes: Buffer.from("a") });
    assert.match(res.headers["Cache-Control"], /private/);
    assert.match(res.headers["Cache-Control"], /no-store/);
  });

  test("the bytes actually get sent", () => {
    const res = fakeRes();
    const bytes = Buffer.from("payload");
    sendStoredFile(res, { contentType: "application/pdf", fileName: "x.pdf", bytes });
    assert.deepEqual(res.sent, bytes);
  });
});
