const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

// Must be set before crypto.js reads it — every encrypt/decrypt call looks
// it up fresh, so this only needs to happen once for the whole file.
process.env.FIELD_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

const { encryptField, decryptField, isEncrypted } = require("../src/utils/crypto");

describe("encryptField / decryptField", () => {
  test("round-trips a value", () => {
    const stored = encryptField("JBSWY3DPEHPK3PXP");
    assert.notEqual(stored, "JBSWY3DPEHPK3PXP");
    assert.equal(decryptField(stored), "JBSWY3DPEHPK3PXP");
  });

  test("produces a different ciphertext each time (random IV)", () => {
    const a = encryptField("same-secret");
    const b = encryptField("same-secret");
    assert.notEqual(a, b);
    assert.equal(decryptField(a), "same-secret");
    assert.equal(decryptField(b), "same-secret");
  });

  test("passes null through unchanged", () => {
    assert.equal(encryptField(null), null);
    assert.equal(decryptField(null), null);
  });

  test("isEncrypted recognizes the stored format", () => {
    const stored = encryptField("secret");
    assert.equal(isEncrypted(stored), true);
    assert.equal(isEncrypted("plain-legacy-value"), false);
  });

  test("decryptField tolerates a legacy plaintext value instead of throwing", () => {
    assert.equal(decryptField("plain-legacy-value"), "plain-legacy-value");
  });

  test("tampered ciphertext fails to decrypt (GCM auth tag check)", () => {
    const stored = encryptField("secret");
    const parts = stored.split(":");
    parts[3] = Buffer.from("tampered-ciphertext").toString("base64");
    assert.throws(() => decryptField(parts.join(":")));
  });
});
