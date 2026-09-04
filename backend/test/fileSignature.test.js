const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { matchesFileSignature } = require("../src/utils/fileSignature");

describe("matchesFileSignature", () => {
  test("accepts a real JPEG signature", () => {
    assert.equal(matchesFileSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), "image/jpeg"), true);
  });

  test("accepts a real PNG signature", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    assert.equal(matchesFileSignature(png, "image/png"), true);
  });

  test("accepts a real WebP signature", () => {
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
    assert.equal(matchesFileSignature(webp, "image/webp"), true);
  });

  test("accepts a real PDF signature", () => {
    assert.equal(matchesFileSignature(Buffer.from("%PDF-1.4\n..."), "application/pdf"), true);
  });

  test("rejects content that doesn't match its declared type", () => {
    const notAnImage = Buffer.from("<script>alert(1)</script>");
    assert.equal(matchesFileSignature(notAnImage, "image/jpeg"), false);
    assert.equal(matchesFileSignature(notAnImage, "image/png"), false);
    assert.equal(matchesFileSignature(notAnImage, "application/pdf"), false);
  });

  test("rejects a declared type with no known signature (fails closed)", () => {
    assert.equal(matchesFileSignature(Buffer.from("anything"), "message/rfc822"), false);
  });

  test("rejects an empty or missing buffer", () => {
    assert.equal(matchesFileSignature(Buffer.alloc(0), "image/jpeg"), false);
    assert.equal(matchesFileSignature(null, "image/jpeg"), false);
  });
});
