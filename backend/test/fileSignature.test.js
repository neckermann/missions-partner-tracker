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

  test("accepts a real OLE2 signature for legacy Word/Excel (.doc/.xls)", () => {
    const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
    assert.equal(matchesFileSignature(ole2, "application/msword"), true);
    assert.equal(matchesFileSignature(ole2, "application/vnd.ms-excel"), true);
  });

  test("accepts a real ZIP signature for modern Word/Excel (.docx/.xlsx)", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    assert.equal(
      matchesFileSignature(zip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      true
    );
    assert.equal(
      matchesFileSignature(zip, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      true
    );
  });

  test("rejects non-Office content declared as an Office format", () => {
    const notOffice = Buffer.from("<script>alert(1)</script>");
    assert.equal(matchesFileSignature(notOffice, "application/msword"), false);
    assert.equal(
      matchesFileSignature(notOffice, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      false
    );
  });

  test("rejects a declared type with no known signature (fails closed)", () => {
    assert.equal(matchesFileSignature(Buffer.from("anything"), "message/rfc822"), false);
  });

  test("rejects an empty or missing buffer", () => {
    assert.equal(matchesFileSignature(Buffer.alloc(0), "image/jpeg"), false);
    assert.equal(matchesFileSignature(null, "image/jpeg"), false);
  });
});
