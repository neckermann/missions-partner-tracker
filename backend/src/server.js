require("dotenv").config({ quiet: true });
// Before anything else: refuse to boot on a configuration that isn't safe --
// most importantly a SESSION_SECRET still set to the published example value.
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
const tripRoutes = require("./routes/trips");
const newsletterRoutes = require("./routes/newsletters");
const documentRoutes = require("./routes/documents");
const photoRoutes = require("./routes/photos");
const settingsRoutes = require("./routes/settings");
const publicSettingsRoutes = require("./routes/publicSettings");
const versionRoutes = require("./routes/version");
const backupCheckRoutes = require("./routes/backupCheck");

const app = express();
const PORT = process.env.PORT || 4000;

// Render (and Fly, Heroku, a typical nginx setup) puts exactly one proxy in
// front of this process, so `req.ip` is the proxy's address unless Express is
// told to read X-Forwarded-For. Without this every rate limiter below shares
// one bucket for the whole instance, which means anyone can burn the login
// limit and lock the entire church out.
//
// It must be 1 -- the number of proxies to trust -- and never `true`. `true`
// trusts the whole X-Forwarded-For chain, so a client could send a header of
// its own and mint itself a private bucket, which is worse than the bug.
app.set("trust proxy", 1);

// helmet()'s default CSP is `img-src 'self' data:`, which blocks the public
// map's tiles (OpenStreetMap's own subdomained tile servers) and its default
// marker pin/shadow icons (unpkg's CDN), both hardcoded in PublicMap.jsx's
// TileLayer url and icon imports. Missionary/organization photos and the
// church logo don't need a widened img-src at all — they're served from
// this app's own origin (routes/photos.js, publicSettings.js), already
// covered by 'self'.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://unpkg.com"],
      },
    },
  })
);
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json());
app.use(cookieParser());

// Frontend and backend are one origin — this backend serves the built
// frontend directly (below) in production, and Vite's dev proxy makes
// local dev look same-origin to the browser too. No CORS needed.

// Rate-limit auth endpoints against brute force. The MFA code-verify step
// gets its own (tighter) limiter since a 6-digit TOTP code is a much
// smaller search space than a password.
//
// /login is relaxed under NODE_ENV=test because the e2e suite logs in ~10
// times per run against a 15-minute window, so two runs inside that window
// used to fail on the limiter -- failures that look exactly like real
// regressions and have cost real debugging time. Only this one endpoint is
// relaxed; the others keep their production limits so they stay testable.
app.use(
  "/api/auth/login",
  rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 200 : 20 })
);
app.use("/api/auth/mfa/login-verify", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
// /setup only ever succeeds once (see routes/auth.js), but it's
// unauthenticated by necessity -- rate-limited for the same reason
// /login is, for the brief window between a fresh deploy going live and
// its owner actually completing setup.
app.use("/api/auth/setup", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));

// Everything else under /api/auth that guesses at a secret. These sit
// behind a session, which is why they were missed -- but a session is not
// a guess limiter:
//
//   /mfa/verify-setup  a 6-digit code against a 20-minute setup token
//   /mfa/disable       the account's current password
//   /change-password   the account's current password
//
// Unlimited attempts at any of those defeats the point of the control. This
// matters more since SSO was removed: email + password with optional TOTP
// is the only way in, so these endpoints are the whole door.
const sensitiveAuthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
app.use("/api/auth/mfa/verify-setup", sensitiveAuthLimiter);
app.use("/api/auth/mfa/disable", sensitiveAuthLimiter);
app.use("/api/auth/change-password", sensitiveAuthLimiter);

// The public site's own pages (directory, map, tour) legitimately fire many
// requests per visitor, so this is deliberately generous — it's here to
// blunt scripted scraping/abuse against these unauthenticated, DB-querying
// endpoints, not to throttle normal browsing.
app.use("/api/public", rateLimit({ windowMs: 60 * 1000, max: 120 }));

// --- Routes ---
app.use("/api/auth", authRoutes);
app.use("/api/partners", partnerRoutes); // protected (admin) — session required
app.use("/api/public/partners", publicPartnerRoutes); // open (public site)
app.use("/api/users", userRoutes); // protected (admin role only)
app.use("/api/public/country-info", countryInfoRoutes); // open (Joshua Project proxy)
app.use("/api/support-needs", supportNeedRoutes); // protected (admin) — session required
app.use("/api/support-entries", supportEntryRoutes); // protected (admin) — session required
app.use("/api/prayer-requests", prayerRequestRoutes); // protected (admin) — session required
app.use("/api/trips", tripRoutes); // protected (admin) — session required
app.use("/api/newsletters", newsletterRoutes); // protected (admin) — session required
app.use("/api/documents", documentRoutes); // protected (admin) — session required
app.use("/api/photos", photoRoutes); // open (public — same as when these were S3 public-read objects)
app.use("/api/settings", settingsRoutes); // protected (admin for write, any role for read)
app.use("/api/public/settings", publicSettingsRoutes); // open (public site + admin nav branding)
app.use("/api/version-check", versionRoutes); // protected (admin role only)
app.use("/api/backup-check", backupCheckRoutes); // protected (admin role only)

// Only exists at all if DEMO_RESET_TOKEN is configured — absent in every
// normal deployment. See ADMIN_GUIDE.md § Demo mode.
if (process.env.DEMO_RESET_TOKEN) {
  app.use("/api/demo", require("./routes/demo"));
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

// An unmatched /api/* path is a bug in the caller, not a page to render --
// without this it falls through to the SPA catch-all below and comes back
// as index.html with a 200, so a client calling a removed or misspelled
// endpoint sees a confusing JSON parse error instead of a clear 404. (The
// comment here used to claim mounting order alone prevented that. It
// didn't; "after the API routes" is exactly what makes the catch-all
// swallow them.) Caught after v2.0.0 removed /api/missionaries and
// /api/organizations, when both started returning HTML.
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// --- Frontend ---
// This backend serves the built frontend directly, so the whole app is one
// deployable origin. The build writes into backend/public (a sibling of
// src/, not frontend/dist — see frontend/vite.config.js) specifically so
// this path stays correct however the deploy bundle is packaged, since
// it's always relative to this file, never to the repo root.
const frontendBuild = path.join(__dirname, "../public");
app.use(express.static(frontendBuild));
app.get("*splat", (req, res) => res.sendFile(path.join(frontendBuild, "index.html")));

// --- Error handler ---
// Every error becomes an HTTP response here, and `error` is always a string.
// See middleware/errors.js for the full mapping and why routes shouldn't
// catch-and-translate on their own.
app.use(errorHandler);

// Guarded so this file can be require()'d by the route tests, which boot
// the real app on an ephemeral port rather than mocking it -- same reason
// prisma/seed.js has the same guard. Running it directly still listens
// exactly as before.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Missionary Tracker API listening on port ${PORT}`);
  });
}

module.exports = app;
