require("dotenv").config({ quiet: true });
// Refuse to boot on an unsafe configuration (e.g. the published example SESSION_SECRET).
require("./config/env").assertValidEnv();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const { errorHandler } = require("./middleware/errors");

const authRoutes = require("./routes/auth");
const partnerRoutes = require("./routes/partners");
const publicPartnerRoutes = require("./routes/publicPartners");
const userRoutes = require("./routes/users");
const countryInfoRoutes = require("./routes/countryInfo");
const supportNeedRoutes = require("./routes/supportNeeds");
const supportEntryRoutes = require("./routes/supportEntries");
const prayerRequestRoutes = require("./routes/prayerRequests");
const adultRoutes = require("./routes/adults");
const childRoutes = require("./routes/children");
const furloughRoutes = require("./routes/furloughs");
const churchVisitRoutes = require("./routes/churchVisits");
const partnerLinkRoutes = require("./routes/partnerLinks");
const partnerLanguageRoutes = require("./routes/partnerLanguages");
const tripTypeRoutes = require("./routes/tripTypes");
const tripRoutes = require("./routes/trips");
const careTeamRoutes = require("./routes/careTeams");
const partnerCareRoutes = require("./routes/partnerCare");
const keyDateRoutes = require("./routes/keyDates");
const auditRoutes = require("./routes/audit");
const supportPreferencesRoutes = require("./routes/supportPreferences");
const surveyRoutes = require("./routes/surveys");
const publicSurveyRoutes = require("./routes/publicSurveys");
const surveyUpdateRoutes = require("./routes/surveyUpdates");
const templatePackRoutes = require("./routes/templatePacks");
const contactLogRoutes = require("./routes/contactLog");
const tripMeetingRoutes = require("./routes/tripMeetings");
const tripRequirementRoutes = require("./routes/tripRequirements");
const tripParticipantRoutes = require("./routes/tripParticipants");
const partnerFileRoutes = require("./routes/partnerFiles");
const photoRoutes = require("./routes/photos");
const silhouetteRoutes = require("./routes/silhouette");
const reportsRoutes = require("./routes/reports");
const { auditSettingsWrites } = require("./middleware/auditSettings");
const settingsRoutes = require("./routes/settings");
const settingsGroupMeRoutes = require("./routes/settingsGroupMe");
const settingsWhatsAppRoutes = require("./routes/settingsWhatsApp");
const settingsEmailRoutes = require("./routes/settingsEmail");
const settingsTripsRoutes = require("./routes/settingsTrips");
const settingsDispatchesRoutes = require("./routes/settingsDispatches");
const publicSettingsRoutes = require("./routes/publicSettings");
const versionRoutes = require("./routes/version");
const systemInfoRoutes = require("./routes/systemInfo");
const backupCheckRoutes = require("./routes/backupCheck");
const backupsRoutes = require("./routes/backups");
const inboundEmailRoutes = require("./routes/inboundEmail");
const dispatchRoutes = require("./routes/dispatches");
const notificationRoutes = require("./routes/notifications");
const publicSubscribeRoutes = require("./routes/publicSubscribe");
const publicUnsubscribeRoutes = require("./routes/publicUnsubscribe");
const adminScopedDigestRoutes = require("./routes/adminScopedDigest");
const publicTripRoutes = require("./routes/publicTrips");
const publicTripApplicationRoutes = require("./routes/publicTripApplications");
const publicTripParticipantRoutes = require("./routes/publicTripParticipants");
const prisma = require("./prismaClient");
const { backgroundJobsEnabled, startBackgroundJobs, stopBackgroundJobs } = require("./utils/backgroundJobs");
const { assertSchemaMatches } = require("./utils/schemaCheck");
const { applyChurchTimezone } = require("./utils/timezone");
const { readTrustProxy, trustProxySetting, describeTrustProxy } = require("./utils/trustProxy");

const app = express();
const PORT = process.env.PORT || 4000;

// How many proxies sit in front of this process (utils/trustProxy.js): one by default (Render, nginx),
// settable with TRUST_PROXY. The rate limiters read the visitor's address from X-Forwarded-For, so the
// number must be right: too low and every visitor shares one bucket, too high and a visitor can write
// their own address into the header. Never `true`, which trusts the whole header chain.
const trustProxy = readTrustProxy();
app.set("trust proxy", trustProxySetting(trustProxy));

// helmet's default CSP blocks the public map's basemap tiles. Photos and the
// logo are same-origin and marker pins are data: URIs, so only tiles need widening.
// These hosts MUST cover every entry in TILE_SOURCES in PublicMap.jsx: nothing
// checks the two agree, and a mismatch makes the browser block every tile
// silently (blank map, no server error).
// Cross-origin embedding of our own images is governed by helmet's separate
// Cross-Origin-Resource-Policy default (same-origin); only photos.js /:id/raw,
// silhouette.js and publicSettings.js /logo/raw relax it, so digest emails can
// show them in webmail.
const TILE_HOSTS = ["https://tile.openstreetmap.org", "https://server.arcgisonline.com"];

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", ...TILE_HOSTS],
      },
    },
    // helmet's default `no-referrer` violates OpenStreetMap's tile usage policy,
    // which requires an accurate Referer (a browser page cannot set its own
    // User-Agent, so Referer is the only way to identify this site). The
    // origin-only cross-origin value leaks no path like /partners/<uuid>.
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);
// Redact `token` query params (unsubscribe, password-setup, trip-participant
// links carry usable bearer credentials) from the access log. Overrides
// morgan's built-in `:url` token, which every format uses.
morgan.token("url", (req) => req.originalUrl.replace(/([?&]token=)[^&]*/gi, "$1[REDACTED]"));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
// Small default body limit, since unauthenticated public routes inherit it.
// Larger parsers are scoped to the few routes that need them and must be
// mounted first: express.json() skips a body an earlier instance consumed.
app.use("/api/inbound-email/postmark", express.json({ limit: "15mb" })); // entire email, base64, attachments included
app.use("/api/template-packs", express.json({ limit: "1mb" })); // a pasted or uploaded pack (admin only)
app.use("/api/public/survey-uploads", express.json({ limit: "7mb" })); // base64 photo from a survey link
app.use("/api/public/trips/participants/sign", express.json({ limit: "7mb" })); // base64 signature image
app.use("/api/public/trips/participants/self-service", express.json({ limit: "7mb" })); // base64 participant photo
app.use(express.json({ limit: "100kb" })); // everything else -- small form-field-sized payloads
app.use(cookieParser());

// Single origin: no CORS needed (the backend serves the built frontend; Vite's dev proxy mimics this).

// Rate-limit auth endpoints against brute force. MFA code verify is tighter
// because a 6-digit code is a far smaller search space than a password.
// /login is relaxed under NODE_ENV=test so repeated e2e runs inside the window
// don't fail on the limiter; other endpoints keep production limits.
app.use(
  "/api/auth/login",
  rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 200 : 20 })
);
app.use("/api/auth/mfa/login-verify", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
// /setup is unauthenticated by necessity (it only ever succeeds once).
app.use("/api/auth/setup", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
// Welcome-link redemption is public; "email me a new link" is much tighter since each call sends mail.
app.use(
  "/api/auth/password-setup/request",
  rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 5 })
);
app.use(
  "/api/auth/password-setup",
  rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 30 })
);

// Authenticated endpoints that still guess at a secret: a session is not a
// guess limiter. /mfa/verify-setup (6-digit code), /mfa/disable and
// /change-password (current password).
const sensitiveAuthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
app.use("/api/auth/mfa/verify-setup", sensitiveAuthLimiter);
app.use("/api/auth/mfa/disable", sensitiveAuthLimiter);
// Passkey sign-in guesses a pending token; the emailed-link request sends mail
// and redeem guesses a 256-bit token.
app.use(
  "/api/auth/passwordless",
  rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 10 })
);
app.use(
  "/api/auth/passkeys/passwordless",
  rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 30 })
);
app.use(
  "/api/auth/passkeys/login",
  rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 20 })
);
app.use(
  "/api/auth/passkeys/register",
  rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 20 })
);
app.use("/api/auth/change-password", sensitiveAuthLimiter);
// Removing a passkey asks for the account password, so it is a password guess too.
app.use("/api/auth/passkeys", (req, res, next) =>
  req.method === "DELETE" ? sensitiveAuthLimiter(req, res, next) : next()
);

// Generous: the public pages fire many requests per visitor; this only blunts scraping.
app.use("/api/public", rateLimit({ windowMs: 60 * 1000, max: 120 }));

// The backup file is the heaviest request and the most sensitive output (see
// routes/backups.js); this stops a compromised admin session pulling it in a loop.
app.use("/api/backups", rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }));

// Each call is a billable Anthropic API request (utils/extraction.js). Scoped to
// the path so normal document CRUD is unaffected.
const extractionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
app.use("/api/partner-files/:id/extract", extractionLimiter);

// Postmark calls this webhook with Basic Auth rather than a session, so it
// needs brute-force throttling like the auth endpoints.
const inboundEmailWebhookLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
app.use("/api/inbound-email/postmark", inboundEmailWebhookLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/partners", partnerRoutes); // protected (admin) — session required
app.use("/api/public/partners", publicPartnerRoutes); // open (public site)
app.use("/api/users", userRoutes); // protected (admin role only)
app.use("/api/public/country-info", countryInfoRoutes); // open (Joshua Project proxy)
app.use("/api/support-needs", supportNeedRoutes); // protected (admin) — session required
app.use("/api/support-entries", supportEntryRoutes); // protected (admin) — session required
app.use("/api/prayer-requests", prayerRequestRoutes); // protected (admin) — session required
app.use("/api/adults", adultRoutes); // protected (admin) — session required
app.use("/api/children", childRoutes); // protected (admin) — session required
app.use("/api/furloughs", furloughRoutes); // protected (admin) — session required
app.use("/api/church-visits", churchVisitRoutes); // protected (admin) — session required
app.use("/api/partner-links", partnerLinkRoutes); // protected (admin) — session required
app.use("/api/partner-languages", partnerLanguageRoutes); // protected (admin) — session required
app.use("/api/trip-types", tripTypeRoutes); // protected (admin) — session required
app.use("/api/trips", tripRoutes); // protected (admin) — session required
app.use("/api/key-dates", keyDateRoutes); // protected; flag-gated (keyDates)
app.use("/api/partner-care", partnerCareRoutes); // protected; the missions team (always on)
app.use("/api/care-team", careTeamRoutes); // protected; flag-gated (careTeam) -- see that file's own comment
app.use("/api/audit", auditRoutes); // protected (admin); flag-gated (auditTrail)
app.use("/api/contact-log", contactLogRoutes); // protected; flag-gated (contactLog) -- see that file's own comment
app.use("/api/surveys", surveyRoutes); // protected; flag-gated (surveys) -- see that file's own comment
app.use("/api/public/survey-uploads", publicSurveyRoutes.uploadRouter); // no login: the link token is the credential
app.use("/api/template-packs", templatePackRoutes); // protected; admin only; each kind needs its own feature
app.use("/api/survey-updates", surveyUpdateRoutes); // protected; flag-gated (surveys), admin/editor
app.use("/api/public/surveys", publicSurveyRoutes); // no login: the personal link token is the credential
app.use("/api/support-preferences", supportPreferencesRoutes); // protected; flag-gated (supportPreferences + careTeam) -- see that file's own comment
// Sibling sub-resource routers under the same prefix; each gates itself, so mount order doesn't matter.
app.use("/api/trips", tripMeetingRoutes);
app.use("/api/trips", tripRequirementRoutes);
app.use("/api/trips", tripParticipantRoutes);
app.use("/api/reports", reportsRoutes); // protected — read-only exports, any signed-in role
app.use("/api/partner-files", partnerFileRoutes); // protected (admin) — session required
app.use("/api/photos", photoRoutes); // open (public — same as when these were S3 public-read objects)
app.use("/api/silhouette", silhouetteRoutes); // open (public — needs to load with no session cookie, e.g. in an email client)
app.use("/api/settings", auditSettingsWrites); // audit trail for every settings write
app.use("/api/settings", settingsRoutes); // protected (admin for write, any role for read)
// Sibling sub-resource routers under the same prefix; each gates itself, so mount order doesn't matter.
app.use("/api/settings", settingsGroupMeRoutes);
app.use("/api/settings", settingsWhatsAppRoutes);
app.use("/api/settings", settingsEmailRoutes);
app.use("/api/settings", settingsTripsRoutes);
app.use("/api/settings", settingsDispatchesRoutes);
app.use("/api/public/settings", publicSettingsRoutes); // open (public site + admin nav branding)
app.use("/api/version-check", versionRoutes); // protected (admin role only)
app.use("/api/system-info", systemInfoRoutes); // protected (admin role only)
app.use("/api/backup-check", backupCheckRoutes); // protected (admin role only)
app.use("/api/backups", backupsRoutes); // protected (admin role only)
app.use("/api/inbound-email", inboundEmailRoutes); // mixed -- see that file's own comment
app.use("/api/dispatches", dispatchRoutes); // protected (any role for read, admin/editor to review/edit)
app.use("/api/notifications", notificationRoutes); // protected (any role for read; the registry itself admin-gates some categories)
app.use("/api/public/subscribe", publicSubscribeRoutes); // open (public, feature-gated -- see that file's own comment)
app.use("/api/public/unsubscribe", publicUnsubscribeRoutes); // open (public, feature-gated -- sibling of publicSubscribe, not nested under it)
app.use("/api/scoped-digest", adminScopedDigestRoutes); // protected (any role for read)
app.use("/api/public/trips", publicTripRoutes); // open (public, feature-gated -- see that file's own comment)
// Sibling sub-resource routers under the same prefix; each gates itself, so mount order doesn't matter.
app.use("/api/public/trips", publicTripApplicationRoutes);
app.use("/api/public/trips", publicTripParticipantRoutes);

// Only mounted when DEMO_RESET_TOKEN is set. See ADMIN_GUIDE.md § Demo mode.
if (process.env.DEMO_RESET_TOKEN) {
  app.use("/api/demo", require("./routes/demo"));
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

// An unmatched /api path must 404 as JSON; otherwise the SPA catch-all below
// would return index.html with a 200. Mount order alone doesn't prevent this.
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// The build writes into backend/public (see frontend/vite.config.js), so this path is relative to this file.
const frontendBuild = path.join(__dirname, "../public");
app.use(express.static(frontendBuild));
app.get("*splat", (req, res) => res.sendFile(path.join(frontendBuild, "index.html")));

// Every error becomes an HTTP response here; see middleware/errors.js.
app.use(errorHandler);

// Guarded so route tests can require() the app and boot it on an ephemeral
// port. The scheduled jobs and the WhatsApp connection also start from here, in production
// (utils/backgroundJobs.js): there is no separate worker service.
if (require.main === module) {
  (async () => {
    // Apply ChurchSettings.timezone to process.env.TZ once, before any
    // date-sensitive route reads the clock (changing TZ later is unreliable); the
    // scheduled jobs start after this, so they read it too. Falls back to UTC on a fresh
    // deploy or transient DB error; never blocks startup.
    try {
      const settings = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { timezone: true },
      });
      applyChurchTimezone(settings?.timezone);
    } catch (err) {
      console.error("Couldn't read ChurchSettings.timezone at startup, defaulting to UTC:", err);
      process.env.TZ = process.env.TZ || "UTC";
    }

    // Do not go live on a database that was not built from this release's migrations: the deploy fails and the
    // previous version keeps serving (utils/schemaCheck.js).
    try {
      await assertSchemaMatches(prisma);
    } catch (err) {
      console.error(`\nNot starting: ${err.message}\n`);
      process.exit(1);
    }

    const server = app.listen(PORT, () => {
      console.log(`Missionary Tracker API listening on port ${PORT}`);
      if (process.env.NODE_ENV === "production") console.log(describeTrustProxy(trustProxy));
    });

    if (backgroundJobsEnabled()) {
      startBackgroundJobs().catch((err) => console.error("Couldn't start the background jobs:", err));
    } else {
      console.log("Background jobs are off here (they run in production, or set BACKGROUND_JOBS=on).");
    }

    const shutdown = async () => {
      setTimeout(() => process.exit(0), 8000).unref();
      await stopBackgroundJobs().catch(() => {});
      server.close(() => process.exit(0));
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  })();
}

module.exports = app;
