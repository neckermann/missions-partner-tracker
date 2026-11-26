// First-time password setup links (welcome emails). A new account has no usable
// password; the person chooses theirs through a single-use, expiring link, so
// nobody else ever sees it.
//
// Only a SHA-256 hash of the random token is stored (a database leak can't be
// replayed), a link is dead once used or expired, and issuing a new link deletes
// the user's older unused ones.
const crypto = require("crypto");
const { appBaseUrl } = require("./dispatchBlurbs");

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_TTL_HOURS = 72;
// Guests are invited for specific trips and may not check email right away, so their link lives longer.
const DEFAULT_GUEST_TTL_HOURS = 24 * 7;

// Hours a setup link stays valid for this role. Fixed, not configurable (#303).
function setupTtlHours(role) {
  return role === "guest" ? DEFAULT_GUEST_TTL_HOURS : DEFAULT_TTL_HOURS;
}

// A "forgot password" link is short-lived: the person is at their inbox, and a stale one is only a risk.
const RESET_TTL_HOURS = 1;
// At most one reset email per account in this window, so nobody can use the form to flood an inbox.
const RESET_COOLDOWN_MS = 60 * 1000;

function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function buildSetupUrl(token) {
  const base = appBaseUrl();
  if (!base) return null; // APP_BASE_URL not set -- nothing clickable to send
  return `${base}/set-password?token=${encodeURIComponent(token)}`;
}

// Creates a fresh link and returns { token, expiresAt }. The raw token exists
// only in this return value: hand it to the email builder, never store or log it.
async function issueSetupToken(user, now = new Date(), { ttlHours } = {}) {
  const prisma = require("../prismaClient"); // lazy: pure helpers stay testable without a DB
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + (ttlHours ?? setupTtlHours(user.role)) * HOUR_MS);
  await prisma.$transaction([
    prisma.passwordSetupToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordSetupToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
    }),
  ]);
  return { token, expiresAt };
}

// Returns the token row (with its user) if the token is real, unused and
// unexpired, else null. Callers give one generic "invalid or expired" answer so nothing is revealed about why.
async function findValidSetupToken(token, now = new Date()) {
  const prisma = require("../prismaClient");
  if (!token || typeof token !== "string") return null;
  const row = await prisma.passwordSetupToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!row || row.usedAt || row.expiresAt <= now) return null;
  if (!row.user || !row.user.active || row.user.authProvider !== "local") return null;
  return row;
}

module.exports = {
  RESET_TTL_HOURS,
  RESET_COOLDOWN_MS,
  setupTtlHours,
  generateToken,
  hashToken,
  buildSetupUrl,
  issueSetupToken,
  findValidSetupToken,
};
