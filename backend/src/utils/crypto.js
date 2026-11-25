const crypto = require("crypto");

// AES-256-GCM field-level encryption for secrets stored reversibly (TOTP and the
// GroupMe token need the raw value back, so hashing isn't an option). A KMS/envelope
// setup is disproportionate for a single-tenant app.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV size for GCM
const FORMAT_PREFIX = "v1";

function getKey() {
  const keyB64 = process.env.FIELD_ENCRYPTION_KEY;
  if (!keyB64) {
    throw new Error("FIELD_ENCRYPTION_KEY is not set — generate one with `openssl rand -base64 32`");
  }
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of a 256-bit key)");
  }
  return key;
}

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(`${FORMAT_PREFIX}:`);
}

// Returns "v1:<iv>:<authTag>:<ciphertext>" (all base64): self-describing, so no
// separate "is encrypted" column, and a future format can coexist with "v1".
function encryptField(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    FORMAT_PREFIX,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

// Refuses anything not in the ciphertext format: accepting plaintext would let
// someone who can write to the database downgrade an encrypted secret silently.
function decryptField(stored) {
  if (stored == null) return null;
  if (!isEncrypted(stored)) {
    throw new Error("Stored value is not in the encrypted format");
  }

  const [, ivB64, authTagB64, ciphertextB64] = stored.split(":");
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

module.exports = { encryptField, decryptField, isEncrypted };
