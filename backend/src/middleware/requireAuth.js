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

// Detect a browser navigation by an explicit "text/html" substring in Accept,
// not req.accepts(): a bare "Accept: */*" (many non-browser clients) would
// resolve to "html" by array order and redirect instead of returning JSON.
function wantsHtml(req) {
  return req.method === "GET" && !!req.headers.accept && req.headers.accept.includes("text/html");
}

// A browser GET with no session is redirected to login, carrying the original
// URL so Login.jsx can return to it; API clients keep the plain JSON 401.
function unauthorized(req, res, message) {
  if (wantsHtml(req)) {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  return res.status(401).json({ error: message });
}

/**
 * Verifies the session cookie, confirms the account still exists and is
 * active, and attaches the user to req.user.
 *
 * The cookie is httpOnly + Secure + SameSite=Lax (utils/jwt.js
 * setSessionCookie), so client-side JS never sees the token.
 *
 * The per-request database read is deliberate: the token lives 8 hours and
 * carries a role claim, so trusting it alone would leave deactivated, deleted
 * or demoted users with access until expiry. `role` comes from the row, not
 * the claims, so a demotion applies on the next request.
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

  // Pending-MFA and forced-setup tokens are not full sessions and are never set
  // as the session cookie; this guards against one being presented anyway.
  if (decoded.mfaPending || decoded.mfaSetup) {
    return unauthorized(req, res, "MFA verification required");
  }

  // An unsubscribe token is signed with the same SESSION_SECRET and would
  // otherwise pass as a full session for that id (bypassing password and MFA,
  // never expiring). Refuse tokens minted for another purpose, like mfaPending/mfaSetup.
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
    // While the church requires two-factor, an unenrolled account's session stops
    // working at once, even one opened earlier; they re-enrol via routes/auth.js
    // POST /login. Read fresh each request so the requirement applies immediately.
    if (!user.mfaEnabled && (await isTwoFactorRequired())) {
      return unauthorized(req, res, "Two-factor authentication is required");
    }
    // A guest's reach is exactly their active grants (TripAccess; care team
    // seats too). With none left the session stops working like !active; the
    // row is kept so extending access just moves a date. Read fresh for immediate revocation.
    let guestReach = null;
    if (user.role === "guest") {
      guestReach = await resolveGuestReach(user.id);
      if (!guestReach.hasActiveGrant) {
        // Nothing left to reach only because the church has switched trips or care teams off: the account is
        // fine and its access returns unchanged when the switch is turned back on, so say so rather than
        // answering as if the session were bad. Only /me (so the page can explain) is let through; every
        // other route is refused here, whatever it would otherwise allow a guest.
        if (guestReach.pausedFeatures.length > 0) {
          if (!req.allowPausedGuest) {
            return res.status(403).json({
              error: "Your church has paused this for now.",
              code: "feature_paused",
              features: guestReach.pausedFeatures,
            });
          }
        } else {
          return unauthorized(req, res, "Invalid or expired session");
        }
      }
    }
    // A mismatch means the token predates a password/MFA/role change; see
    // User.sessionVersion in schema.prisma for what bumps it.
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
      // Only set for guests; scope checks treat absent tripIds/partnerIds as
      // "no restriction" via utils/guestAccess.js, never by inspecting these directly.
      req.user.tripIds = guestReach.tripIds; // readable
      req.user.grantedTripIds = guestReach.grantedTripIds; // writable
      req.user.partnerIds = guestReach.partnerIds;
      req.user.careTeamPartnerIds = guestReach.careTeamPartnerIds;
      req.user.pausedFeatures = guestReach.pausedFeatures;
    }
    // Lets the "last edited by" stamp work without every route passing the user down.
    actorStore.run({ id: user.id, name: displayName(user) }, next);
  } catch (err) {
    next(err);
  }
}

// For the one route a guest with nothing reachable (everything they were given is paused) may still call: GET
// /api/auth/me, which tells the app why, so it can show a plain page instead of the sign-in screen.
function requireAuthAllowPaused(req, res, next) {
  req.allowPausedGuest = true;
  return requireAuth(req, res, next);
}

// requireAuth is async, so await it: otherwise a rejection would be unhandled instead of a 500.
function requireRole(...roles) {
  return async (req, res, next) => {
    await requireAuth(req, res, () => {
      // role comes from the database row, so a demotion is immediate.
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      next();
    });
  };
}

// For the MFA enrollment endpoints, which a forced-setup user must reach before
// having a session. Accepts a session cookie OR an explicit mfaSetup token (the
// one bearer-style auth, sent as an Authorization header). Rejects mfaPending.
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

  // Same as requireAuth's check: an unsubscribe token reaching /mfa/setup and
  // /mfa/verify-setup would end in completeLogin and mint a full session.
  if (decoded.unsubscribe) return res.status(401).json({ error: "Invalid or expired session" });

  try {
    // Only existence and active, not role: a setup token has no role claim. A
    // deactivated account still stops here.
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, active: true, sessionVersion: true },
    });
    if (!user || !user.active) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    // Only real session cookies carry sessionVersion; an mfaSetup token never
    // does, so comparing unconditionally would reject every forced enrollment.
    if (!decoded.mfaSetup && user.sessionVersion !== decoded.sessionVersion) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    req.user = decoded; // full session, or { id, mfaSetup: true }
    next();
  } catch (err) {
    next(err);
  }
}

// Scopes a route to the trips a guest has been granted: a no-op for other roles,
// a 403 for a guest with no active grant on the resolved trip. Applied on top of
// requireRole, on reads as well as writes.
//
// `resolveTripId` is a route param name that IS the trip id ("id", "tripId"), or
// an async (req) => tripId for routes addressed by a child record's id.
function requireTripScope(resolveTripId) {
  return async (req, res, next) => {
    if (req.user.role !== "guest") return next();
    try {
      const tripId =
        typeof resolveTripId === "function" ? await resolveTripId(req) : req.params[resolveTripId];
      // Reads may use any trip a guest can see; writes need an actual grant (a care team seat is view-only).
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

// Scopes a Partner sub-resource's GET /?partnerId= read to partners a guest may
// read; a no-op for other roles. Without it a guest could pass any partnerId.
// Also refuses a query with no partnerId (that returns every partner's rows).
// Read-side only: these resources' write routes already exclude guests.
function requirePartnerQueryScope(req, res, next) {
  if (req.user.role !== "guest") return next();
  const partnerId = req.query.partnerId ? String(req.query.partnerId) : null;
  if (!partnerId || !canReadPartner(req.user, partnerId)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  next();
}

// Like requirePartnerQueryScope, for lists a guest may browse across every
// reachable partner: naming a partner must be readable, but naming none is
// allowed and the route limits rows to readablePartnerIds(req.user).
function allowGuestPartnerList(req, res, next) {
  if (req.user.role !== "guest") return next();
  const partnerId = req.query.partnerId ? String(req.query.partnerId) : null;
  if (partnerId && !canReadPartner(req.user, partnerId)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  next();
}

// A write on one partner's own data: staff (admin/editor), or a login on THAT
// partner's care team whatever their role. Gives a care team member what an
// editor has for their own partner, no more: only attach it to routes editors
// can already use, never to deletes, partner creation, monthly support, or
// decisions on one-time needs.
//
// Which partner: `{ body: true }` reads body.partnerId (create), `{ param: "id" }`
// reads that route param, `{ model: "adult" }` looks up the record's partner.
// If a non-staff request also names a different partnerId (a move), they must
// be on THAT team too.
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
  requireAuthAllowPaused,
  requireRole,
  requireAuthOrMfaSetup,
  requireTripScope,
  requirePartnerQueryScope,
  allowGuestPartnerList,
  requirePartnerWriter,
};
