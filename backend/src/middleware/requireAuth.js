const jwt = require("jsonwebtoken");
const { SESSION_COOKIE_NAME } = require("../utils/jwt");
const prisma = require("../prismaClient");

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

/**
 * Verifies the session cookie, confirms the account still exists and is
 * still active, and attaches the user to req.user.
 *
 * The cookie is httpOnly + Secure + SameSite=Lax, set by utils/jwt.js's
 * setSessionCookie — client-side JS never sees the token, which is the whole
 * point (an XSS bug can't steal it the way it could with a token sitting in
 * localStorage).
 *
 * The database read on every request is deliberate. The token is valid for
 * 8 hours and carries the user's role in its claims, so trusting it alone
 * meant deactivating someone, deleting them, or demoting an admin to viewer
 * had no effect until it expired — a volunteer whose access was revoked kept
 * it for the rest of the working day. Logging out only cleared the cookie;
 * the token itself stayed valid. One indexed primary-key lookup per request
 * is a fair price for "revoked means revoked", at this app's scale.
 *
 * `role` comes from the row, not the claims, so a demotion takes effect on
 * the user's very next request.
 */
async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];

  if (!token) return res.status(401).json({ error: "Authentication required" });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.SESSION_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // Pending MFA tokens (issued after password check, before the TOTP code
  // is verified) and forced-setup tokens (issued when an admin requires
  // MFA but the user hasn't enrolled yet) are deliberately not full
  // sessions and never get set as the session cookie — this check exists
  // in case one is ever presented anyway.
  if (decoded.mfaPending || decoded.mfaSetup) {
    return res.status(401).json({ error: "MFA verification required" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, active: true },
    });
    if (!user || !user.active) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    req.user = { ...decoded, role: user.role, email: user.email };
    next();
  } catch (err) {
    next(err);
  }
}

// Note requireAuth is async now, so this awaits it rather than dropping the
// promise -- otherwise a rejection inside it would surface as an unhandled
// rejection instead of a 500.
function requireRole(...roles) {
  return async (req, res, next) => {
    await requireAuth(req, res, () => {
      // req.user.role comes from the database row, not the token, so a
      // demotion is effective immediately rather than at token expiry.
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      next();
    });
  };
}

// Used only by the MFA enrollment endpoints, which a user with a forced
// setup requirement must be able to reach before they have a real session.
// Accepts a full session (the cookie) OR an explicit mfaSetup token — the
// latter is the one place bearer-style auth still exists, since a user mid
// forced-enrollment has no session cookie yet (see frontend's
// startForcedMfaSetup/confirmForcedMfaSetup, which pass it as an explicit
// Authorization header instead). Still rejects mfaPending (a user
// mid-login-verify has no business starting a fresh MFA enrollment).
async function requireAuthOrMfaSetup(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE_NAME] || extractBearerToken(req);

  if (!token) return res.status(401).json({ error: "Authentication required" });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.SESSION_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  if (decoded.mfaPending) return res.status(401).json({ error: "MFA verification required" });

  try {
    // Deliberately only existence and active, not role: a setup token has no
    // role claim, and someone mid-enrollment doesn't have a session yet. But
    // an account deactivated while they were enrolling should stop here just
    // the same.
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, active: true },
    });
    if (!user || !user.active) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    req.user = decoded; // full session, or { id, mfaSetup: true }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, requireRole, requireAuthOrMfaSetup };
