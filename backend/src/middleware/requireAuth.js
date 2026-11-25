const jwt = require("jsonwebtoken");
const { SESSION_COOKIE_NAME } = require("../utils/jwt");
const prisma = require("../prismaClient");
const { actorStore, displayName } = require("../utils/actorContext");
const { isTwoFactorRequired } = require("../utils/twoFactor");
const {
  resolveGuestReach,
  canReadPartner,
  canReadTrip,
  canWriteTrip,
  isOnCareTeamFor,
} = require("../utils/guestAccess");

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

// A real browser's top-level navigation always sends an Accept header that
// literally contains "text/html" -- the SPA's own axios/fetch calls never
// do. Checked as an explicit substring, not via Express's req.accepts(),
// because a bare "Accept: */*" (default for many non-browser HTTP clients,
// including this file's own test suite) is ambiguous under content
// negotiation and req.accepts(["html","json"]) would resolve it by array
// order -- i.e. pick "html" -- silently turning every ambiguous caller into
// a redirect instead of the JSON response it expects.
function wantsHtml(req) {
  return req.method === "GET" && !!req.headers.accept && req.headers.accept.includes("text/html");
}

// A direct link to a requireAuth-gated route (a GroupMe notification, etc.)
// clicked with no session shows bare JSON with no path back to the file --
// see #124. For a real browser GET, send them to log in instead, carrying
// the original URL so Login.jsx can return them to it afterward. Every
// other caller (the SPA itself, any API client) keeps today's plain JSON.
function unauthorized(req, res, message) {
  if (wantsHtml(req)) {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  return res.status(401).json({ error: message });
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

  if (!token) return unauthorized(req, res, "Authentication required");

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.SESSION_SECRET);
  } catch {
    return unauthorized(req, res, "Invalid or expired session");
  }

  // Pending MFA tokens (issued after password check, before the TOTP code
  // is verified) and forced-setup tokens (issued when an admin requires
  // MFA but the user hasn't enrolled yet) are deliberately not full
  // sessions and never get set as the session cookie — this check exists
  // in case one is ever presented anyway. A cold click through here still
  // just lands on the normal login form; Login.jsx's existing
  // password+TOTP flow handles a fresh login correctly from there, so this
  // doesn't need to be special-cased to jump straight to the TOTP step.
  if (decoded.mfaPending || decoded.mfaSetup) {
    return unauthorized(req, res, "MFA verification required");
  }

  // #327 Finding 1: a digest email's unsubscribe link is signed with this
  // same SESSION_SECRET as a { id, unsubscribe: true } token, with no
  // other discriminator requireAuth used to check -- so it was accepted
  // as a completely normal session for that id, bypassing password and
  // MFA entirely and never expiring. Same denylist pattern as
  // mfaPending/mfaSetup above: refuse a token minted for a different
  // purpose, no matter how valid its signature is.
  if (decoded.unsubscribe) {
    return unauthorized(req, res, "Invalid or expired session");
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true,
        sessionVersion: true,
        mfaEnabled: true,
      },
    });
    if (!user || !user.active) {
      return unauthorized(req, res, "Invalid or expired session");
    }
    // #385: while the church requires two-factor, a session for an account that hasn't enrolled
    // stops working at once, including one opened before the requirement was turned on. They
    // sign in again and are taken through enrolment (routes/auth.js POST /login). Read fresh
    // each request, like role and active, so turning the requirement on is immediate.
    if (!user.mfaEnabled && (await isTwoFactorRequired())) {
      return unauthorized(req, res, "Two-factor authentication is required");
    }
    // #356: a guest's reach is exactly their active grants (TripAccess
    // today; care team seats join in #289). With none left -- every trip
    // lapsed 30 days after it ended, or an admin ended them -- the session
    // stops working the same as !active. The row is kept, not deleted, so
    // an admin extending access just moves a date rather than recreating
    // the account. Read fresh each request, like role, so revocation is
    // immediate.
    let guestReach = null;
    if (user.role === "guest") {
      guestReach = await resolveGuestReach(user.id);
      if (!guestReach.hasActiveGrant) {
        return unauthorized(req, res, "Invalid or expired session");
      }
    }
    // #327 Finding 7: a mismatch means this token predates a
    // password/MFA/role change that should have ended it -- see the
    // schema comment on User.sessionVersion for what bumps it.
    if (user.sessionVersion !== decoded.sessionVersion) {
      return unauthorized(req, res, "Invalid or expired session");
    }
    req.user = {
      ...decoded,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
    if (guestReach) {
      // Only ever set for a guest -- every route's scope check treats an
      // absent tripIds/partnerIds as "not a guest, no restriction" via
      // utils/guestAccess.js, never by inspecting these directly.
      req.user.tripIds = guestReach.tripIds; // readable
      req.user.grantedTripIds = guestReach.grantedTripIds; // writable
      req.user.partnerIds = guestReach.partnerIds;
      req.user.careTeamPartnerIds = guestReach.careTeamPartnerIds;
    }
    // The rest of this request runs as this person, so a write can be stamped
    // "last edited by" without every route passing the user down (#341).
    actorStore.run({ id: user.id, name: displayName(user) }, next);
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

  // #327 Finding 1, same reasoning as requireAuth's own check above: an
  // unsubscribe token presented here would otherwise reach
  // POST /mfa/setup and /mfa/verify-setup, which end in completeLogin and
  // hand back a brand-new, fully-privileged session cookie -- a second
  // way in for the exact same forged token, if this one were left out.
  if (decoded.unsubscribe) return res.status(401).json({ error: "Invalid or expired session" });

  try {
    // Deliberately only existence and active, not role: a setup token has no
    // role claim, and someone mid-enrollment doesn't have a session yet. But
    // an account deactivated while they were enrolling should stop here just
    // the same.
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, active: true, sessionVersion: true },
    });
    if (!user || !user.active) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    // #327 Finding 7: only a real session cookie carries a sessionVersion
    // claim at all (signed by signToken) -- an mfaSetup token (signed by
    // signMfaSetupToken) never did and never should, it's not a session.
    // Comparing it unconditionally would reject every forced-enrollment
    // token outright (decoded.sessionVersion undefined !== the real
    // column value).
    if (!decoded.mfaSetup && user.sessionVersion !== decoded.sessionVersion) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    req.user = decoded; // full session, or { id, mfaSetup: true }
    next();
  } catch (err) {
    next(err);
  }
}

// Scopes a route to the trips a guest has been granted -- a no-op for
// every other role (admin/editor/viewer already pass through requireRole's
// own per-route allowlist unaffected), a hard 403 for a guest whose
// request resolves to a trip they hold no active grant for. Applied on top
// of requireRole, never instead of it, and on reads as well as writes -- a
// guest must not even be able to GET another trip's data, not just write
// to it.
//
// `resolveTripId` is either the name of a route param that IS the trip id
// directly ("id", "tripId" -- most of this router's own trip-level
// routes), or an async (req) => tripId function for a route addressed by
// a child record's own id (a meeting, requirement, budget line, flight
// segment, document, application, participant -- looked up via that
// record's own tripId column, since the URL alone doesn't carry it).
function requireTripScope(resolveTripId) {
  return async (req, res, next) => {
    if (req.user.role !== "guest") return next();
    try {
      const tripId =
        typeof resolveTripId === "function" ? await resolveTripId(req) : req.params[resolveTripId];
      // Reads may use any trip a guest can see; anything else needs an actual
      // grant (a care team seat only ever gives view access to a trip).
      const isRead = req.method === "GET" || req.method === "HEAD";
      const allowed = isRead ? canReadTrip(req.user, tripId) : canWriteTrip(req.user, tripId);
      if (!allowed) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Scopes a Partner sub-resource's own GET /?partnerId= read (prayer
// requests, one-time needs, support entries, family members, furloughs,
// church visits, links, languages, files) to the partners a guest may
// read -- a no-op for every other role. Without this, a guest could pass
// any other partnerId and read that partner's own prayer requests/needs/
// etc, even though Partner Detail's own GET /:id (partners.js) already
// refuses to show them any partner they aren't assigned. Refuses a query
// with no partnerId filter at all too -- that shape returns every
// partner's rows, which is exactly what this role must never see.
// Read-only concern only: every one of these resources' own write routes
// already requireRole admin/editor, which already excludes guest, so
// nothing here needs its own write-side counterpart.
function requirePartnerQueryScope(req, res, next) {
  if (req.user.role !== "guest") return next();
  const partnerId = req.query.partnerId ? String(req.query.partnerId) : null;
  if (!partnerId || !canReadPartner(req.user, partnerId)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  next();
}

// Like requirePartnerQueryScope, for the two lists a guest may browse across
// every partner they reach (prayer requests, one-time needs): naming a
// partner still has to be one they can read, but asking for none is allowed
// -- the route then limits the rows to readablePartnerIds(req.user) instead
// of refusing. A no-op for every other role.
function allowGuestPartnerList(req, res, next) {
  if (req.user.role !== "guest") return next();
  const partnerId = req.query.partnerId ? String(req.query.partnerId) : null;
  if (partnerId && !canReadPartner(req.user, partnerId)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  next();
}

// A write on one partner's own data (#289): staff (admin/editor) as always, or
// a login on THAT partner's care team -- whatever their role (a viewer or a
// guest). It gives a care team member what an editor has for their own
// partner, no more: it is only ever attached to the routes an editor can
// already use, never to deletes (admin-only), creating partners, monthly
// support, or recording a decision on a one-time need. Applied on top of
// requireAuth, like requireRole.
//
// Which partner a request is about: `{ body: true }` reads body.partnerId (a
// create), `{ param: "id" }` reads that route param as the partner id, and
// `{ model: "adult" }` looks up the partner the addressed record belongs to.
// If a non-staff request also names a different partnerId in its body (a
// move), they must be on THAT team too -- you can't move a record to a
// partner you don't look after.
function requirePartnerWriter({ body = false, param = null, model = null } = {}) {
  return async (req, res, next) => {
    if (req.user.role === "admin" || req.user.role === "editor") return next();
    try {
      let partnerId = null;
      if (body) partnerId = typeof req.body?.partnerId === "string" ? req.body.partnerId : null;
      else if (param) partnerId = req.params[param];
      else if (model) {
        const row = await prisma[model].findUnique({
          where: { id: req.params.id },
          select: { partnerId: true },
        });
        if (!row) return res.status(404).json({ error: "Not found" });
        partnerId = row.partnerId;
      }
      const destination = !body && typeof req.body?.partnerId === "string" ? req.body.partnerId : null;
      const needed = [partnerId, destination].filter(Boolean);
      if (needed.length === 0) return res.status(403).json({ error: "Insufficient permissions" });
      for (const id of needed) {
        if (!(await isOnCareTeamFor(req.user, id))) {
          return res.status(403).json({ error: "Insufficient permissions" });
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  requireAuth,
  requireRole,
  requireAuthOrMfaSetup,
  requireTripScope,
  requirePartnerQueryScope,
  allowGuestPartnerList,
  requirePartnerWriter,
};
