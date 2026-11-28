// Optional passphrase protection for a downloaded backup. The backup holds everything (restricted partners
// unmasked, every password hash and encrypted two-factor secret), so an admin may lock the file with a
// passphrase of their own. There is no recovery: the passphrase is not stored anywhere, so a lost one means
// the file cannot be opened by anyone, including us.
//
// Two file layouts, both AES-256-GCM with a scrypt key from the passphrase, so a wrong passphrase or a changed
// file is detected:
//   v1 (older files, and encryptBackup): MAGIC | salt (16) | iv (12) | GCM tag (16) | ciphertext
//   v2 (streamed downloads):             MAGIC2 | salt (16) | iv (12) | ciphertext | GCM tag (16)
// The tag is only known once everything has been encrypted, so a stream can only write it at the end: that is
// why v2 exists. Both open with decryptBackup (in memory); a v2 file can also be read as a stream with createUnlockStream.
const crypto = require("crypto");
const { Transform } = require("stream");

const MAGIC = Buffer.from("MPTBAK1\n", "utf8");
const MAGIC2 = Buffer.from("MPTBAK2\n", "utf8");
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
    Buffer.isBuffer(buffer) &&
    buffer.length > MAGIC.length &&
    (buffer.subarray(0, MAGIC.length).equals(MAGIC) || buffer.subarray(0, MAGIC2.length).equals(MAGIC2))
  );
}

const isV2 = (buffer) => buffer.subarray(0, MAGIC2.length).equals(MAGIC2);

// A Transform that locks what flows through it as a v2 file: the header first, then the ciphertext, then the tag.
function createLockStream(passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  let started = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      if (!started) {
        started = true;
        this.push(Buffer.concat([MAGIC2, salt, iv]));
      }
      this.push(cipher.update(chunk));
      cb();
    },
    flush(cb) {
      if (!started) this.push(Buffer.concat([MAGIC2, salt, iv]));
      this.push(cipher.final());
      this.push(cipher.getAuthTag());
      cb();
    },
  });
}

// A Transform that unlocks a v2 file: feed it only the ciphertext (the bytes between the header and the final
// 16-byte tag), given the header and that tag. The tag is checked when the stream ends: a wrong passphrase or
// a changed file makes it fail with an error, so read it to the end before relying on anything it gave.
function createUnlockStream(passphrase, header, tag) {
  const salt = header.subarray(MAGIC2.length, MAGIC2.length + SALT_LEN);
  const iv = header.subarray(MAGIC2.length + SALT_LEN, MAGIC2.length + SALT_LEN + IV_LEN);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  return new Transform({
    transform(chunk, _enc, cb) {
      cb(null, decipher.update(chunk));
    },
    flush(cb) {
      try {
        cb(null, decipher.final());
      } catch {
        cb(new Error("Wrong passphrase, or the backup file was changed"));
      }
    },
  });
}

// Where the ciphertext of a v2 file starts (the tag is the last TAG_LEN bytes).
const V2_HEADER_LEN = MAGIC2.length + SALT_LEN + IV_LEN;

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
  let tag;
  let ciphertext;
  if (isV2(buffer)) {
    // v2: the tag is the last 16 bytes.
    tag = buffer.subarray(buffer.length - TAG_LEN);
    ciphertext = buffer.subarray(offset, buffer.length - TAG_LEN);
  } else {
    tag = buffer.subarray(offset, (offset += TAG_LEN));
    ciphertext = buffer.subarray(offset);
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Wrong passphrase, or the backup file was changed");
  }
}

module.exports = {
  MIN_PASSPHRASE_LENGTH,
  TAG_LEN,
  V2_HEADER_LEN,
  isEncryptedBackup,
  isV2,
  encryptBackup,
  decryptBackup,
  createLockStream,
  createUnlockStream,
};
