const jwt = require("jsonwebtoken");

const TOKEN_TTL = "8h";
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_COOKIE_NAME = "session";

// Shared by local login (routes/auth.js) and every SSO provider's callback
// (routes/sso.js) so both end up issuing an identical session token.
function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      authProvider: user.authProvider,
    },
    process.env.SESSION_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

// The one place the session cookie's flags are set — local login and SSO
// both call this so there's no risk of the two flows drifting apart.
// httpOnly means client-side JS can never read (or steal, via XSS) the
// token; sameSite: "lax" (not "strict") is deliberate — it's the
// well-established choice for a cookie that has to survive an OAuth/OIDC
// external-redirect-then-land flow, and still blocks the cookie from being
// sent on any cross-site POST/PUT/DELETE, which is all the CSRF defense
// this app needs since every state-changing route uses one of those verbs.
function setSessionCookie(res, user) {
  res.cookie(SESSION_COOKIE_NAME, signToken(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TOKEN_TTL_MS,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

module.exports = { signToken, setSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME, TOKEN_TTL };
