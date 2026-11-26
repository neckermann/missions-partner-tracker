// Optional passphrase protection for a downloaded backup. The backup holds everything (restricted partners
// unmasked, every password hash and encrypted two-factor secret), so an admin may lock the file with a
// passphrase of their own. There is no recovery: the passphrase is not stored anywhere, so a lost one means
// the file cannot be opened by anyone, including us.
//
// File layout: MAGIC | salt (16) | iv (12) | GCM tag (16) | ciphertext (the gzipped backup). The key comes
// from the passphrase with scrypt; AES-256-GCM both hides the contents and detects a wrong passphrase or a
// changed file.
const crypto = require("crypto");

const MAGIC = Buffer.from("MPTBAK1\n", "utf8");
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const MIN_PASSPHRASE_LENGTH = 8;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(Buffer.from(String(passphrase), "utf8"), salt, 32, SCRYPT);
}

function isEncryptedBackup(buffer) {
  return (
    Buffer.isBuffer(buffer) && buffer.length > MAGIC.length && buffer.subarray(0, MAGIC.length).equals(MAGIC)
  );
}

function encryptBackup(buffer, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

function decryptBackup(buffer, passphrase) {
  if (!isEncryptedBackup(buffer)) throw new Error("This file isn't a passphrase-protected backup");
  if (!passphrase) throw new Error("This backup is protected with a passphrase, which is needed to open it");
  let offset = MAGIC.length;
  const salt = buffer.subarray(offset, (offset += SALT_LEN));
  const iv = buffer.subarray(offset, (offset += IV_LEN));
  const tag = buffer.subarray(offset, (offset += TAG_LEN));
  const ciphertext = buffer.subarray(offset);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Wrong passphrase, or the backup file was changed");
  }
}

module.exports = { MIN_PASSPHRASE_LENGTH, isEncryptedBackup, encryptBackup, decryptBackup };
