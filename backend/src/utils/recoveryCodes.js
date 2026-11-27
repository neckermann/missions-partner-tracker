// One-time recovery codes for a person who has lost their authenticator app.
//
// Each code is 10 characters from an alphabet with no look-alikes, shown as `abcde-fghjk`. Only a SHA-256
// of the code is stored: a random 50-bit code can't be guessed from its hash the way a password can, and
// sign-in with one is rate-limited per account like a wrong authenticator code.
const crypto = require("crypto");
const prisma = require("../prismaClient");

const CODE_COUNT = 10;
const CODE_LENGTH = 10;
// No 0/o, 1/l/i, or u (typed-by-hand mix-ups).
const ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";

function generateCode() {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

// Whatever a person types or pastes: case, spaces and the dash don't matter.
function normalizeCode(input) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function hashCode(input) {
  return crypto.createHash("sha256").update(normalizeCode(input)).digest("hex");
}

function looksLikeCode(input) {
  return normalizeCode(input).length === CODE_LENGTH;
}

// Replaces every code the person has (used or not) with a fresh set and returns the new codes in plain text,
// the only time they exist outside the person's own hands. `db` may be a transaction client.
async function issueRecoveryCodes(userId, db = prisma) {
  const codes = Array.from({ length: CODE_COUNT }, generateCode);
  await db.userRecoveryCode.deleteMany({ where: { userId } });
  await db.userRecoveryCode.createMany({
    data: codes.map((c) => ({ userId, codeHash: hashCode(c) })),
  });
  return codes;
}

// Spends a code. The single conditional update means two requests with the same code can't both win.
async function consumeRecoveryCode(userId, input) {
  if (!looksLikeCode(input)) return false;
  const { count } = await prisma.userRecoveryCode.updateMany({
    where: { userId, codeHash: hashCode(input), usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

async function countUnusedRecoveryCodes(userId) {
  return prisma.userRecoveryCode.count({ where: { userId, usedAt: null } });
}

module.exports = {
  CODE_COUNT,
  generateCode,
  normalizeCode,
  hashCode,
  looksLikeCode,
  issueRecoveryCodes,
  consumeRecoveryCode,
  countUnusedRecoveryCodes,
};
