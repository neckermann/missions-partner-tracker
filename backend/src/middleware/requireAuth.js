const jwt = require("jsonwebtoken");
const { SESSION_COOKIE_NAME } = require("../utils/jwt");

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

/**
 * Verifies the session cookie and attaches the decoded claims to req.user.
 * httpOnly + Secure + SameSite=Lax, set by utils/jwt.js's setSessionCookie
 * — client-side JS never sees the token, which is the whole point (an XSS
 * bug can't steal it the way it could with a token sitting in localStorage).
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];

  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const decoded = jwt.verify(token, process.env.SESSION_SECRET);
    // Pending MFA tokens (issued after password check, before the TOTP code
    // is verified) and forced-setup tokens (issued when an admin requires
    // MFA but the user hasn't enrolled yet) are deliberately not full
    // sessions and never get set as the session cookie — this check exists
    // in case one is ever presented anyway.
    if (decoded.mfaPending || decoded.mfaSetup) {
      return res.status(401).json({ error: "MFA verification required" });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
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
function requireAuthOrMfaSetup(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE_NAME] || extractBearerToken(req);

  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const decoded = jwt.verify(token, process.env.SESSION_SECRET);
    if (decoded.mfaPending) return res.status(401).json({ error: "MFA verification required" });
    req.user = decoded; // full session, or { id, mfaSetup: true }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

module.exports = { requireAuth, requireRole, requireAuthOrMfaSetup };
