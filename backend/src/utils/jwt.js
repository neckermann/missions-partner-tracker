const jwt = require("jsonwebtoken");

// One number for both TOKEN_TTL (jwt.sign expiresIn) and TOKEN_TTL_MS (cookie
// maxAge) so they can't drift: a cookie outliving the token sends an expired token
// (confusing short session); a token outliving the cookie forces an early re-login.
const TOKEN_TTL_HOURS = 8;
const TOKEN_TTL = `${TOKEN_TTL_HOURS}h`;
const TOKEN_TTL_MS = TOKEN_TTL_HOURS * 60 * 60 * 1000;
const SESSION_COOKIE_NAME = "session";

// Issued by login in routes/auth.js, the one place a session is minted.
function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      authProvider: user.authProvider,
      // Compared with the row's value in requireAuth.js each request; a mismatch
      // means the token predates a password/MFA/role change that should have ended it.
      sessionVersion: user.sessionVersion,
    },
    process.env.SESSION_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

// The one place the session cookie's flags are set (login and logout share it).
// httpOnly keeps client JS (XSS) from reading the token. sameSite "lax" not
// "strict": strict wouldn't send the cookie on a top-level navigation from outside
// (bookmark, emailed link), forcing a needless re-login, while lax still blocks
// cross-site POST/PUT/DELETE, which is all the CSRF defense needed since every
// state-changing route uses those verbs.
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
