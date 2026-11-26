const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const {
  isEncryptedBackup,
  encryptBackup,
  decryptBackup,
  MIN_PASSPHRASE_LENGTH,
} = require("../src/utils/backupCrypto");

// A locked backup opens only with the exact passphrase, and any change to the file is noticed.
describe("backupCrypto", () => {
  const plain = zlib.gzipSync(Buffer.from('{"manifest":true}\n{"model":"X"}', "utf8"));
  const passphrase = "correct horse battery";

  test("round trips with the same passphrase", () => {
    const locked = encryptBackup(plain, passphrase);
    assert.ok(isEncryptedBackup(locked));
    assert.ok(!isEncryptedBackup(plain), "a plain gzip is not mistaken for a locked file");
    assert.notDeepEqual(locked.subarray(-plain.length), plain, "the contents are not left readable");
    assert.deepEqual(decryptBackup(locked, passphrase), plain);
  });

  test("a wrong passphrase is refused with a plain message", () => {
    const locked = encryptBackup(plain, passphrase);
    assert.throws(() => decryptBackup(locked, "another passphrase"), /Wrong passphrase/);
  });

  test("a missing passphrase says one is needed", () => {
    assert.throws(() => decryptBackup(encryptBackup(plain, passphrase), ""), /protected with a passphrase/);
  });

  test("a changed file is refused, not decrypted to garbage", () => {
    const locked = encryptBackup(plain, passphrase);
    locked[locked.length - 1] ^= 0xff;
    assert.throws(
      () => decryptBackup(locked, passphrase),
      /Wrong passphrase, or the backup file was changed/
    );
  });

  test("two locks of the same file differ (fresh salt and iv each time)", () => {
    assert.notDeepEqual(encryptBackup(plain, passphrase), encryptBackup(plain, passphrase));
  });

  test("a too-short passphrase is rejected", () => {
    assert.throws(() => encryptBackup(plain, "x".repeat(MIN_PASSPHRASE_LENGTH - 1)), /at least/);
  });

  test("a file that is not locked is not decrypted", () => {
    assert.throws(() => decryptBackup(plain, passphrase), /isn't a passphrase-protected backup/);
  });
});
