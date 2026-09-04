require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { publicBaseUrl } = require("./utils/s3");

const authRoutes = require("./routes/auth");
const ssoRoutes = require("./routes/sso");
const ssoProviderRoutes = require("./routes/ssoProviders");
const missionaryRoutes = require("./routes/missionaries");
const publicMissionaryRoutes = require("./routes/publicMissionaries");
const userRoutes = require("./routes/users");
const countryInfoRoutes = require("./routes/countryInfo");
const organizationRoutes = require("./routes/organizations");
const publicOrganizationRoutes = require("./routes/publicOrganizations");
const supportNeedRoutes = require("./routes/supportNeeds");
const newsletterRoutes = require("./routes/newsletters");
const documentRoutes = require("./routes/documents");
const settingsRoutes = require("./routes/settings");
const publicSettingsRoutes = require("./routes/publicSettings");

const app = express();
const PORT = process.env.PORT || 4000;

// helmet()'s default CSP is `img-src 'self' data:`, which blocks every
// missionary/organization photo and church logo — they're all rendered as
// <img src={photo.url}> pointing at the S3/CloudFront bucket, a different
// origin than this app — and the public map, which loads its tiles from
// OpenStreetMap's own subdomained tile servers and its default marker
// pin/shadow icons from unpkg's CDN (both hardcoded in PublicMap.jsx's
// TileLayer url and icon imports). Widening just img-src (not disabling
// CSP) to also allow those known origins. The S3 one is only added if S3
// is actually configured — an unconfigured instance has no photos to
// load anyway.
const s3Origin = process.env.S3_BUCKET_NAME || process.env.S3_PUBLIC_URL_BASE ? publicBaseUrl() : null;
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": [
          "'self'",
          "data:",
          "https://*.tile.openstreetmap.org",
          "https://unpkg.com",
          ...(s3Origin ? [s3Origin] : []),
        ],
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
app.use("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use("/api/auth/mfa/login-verify", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));

// The public site's own pages (directory, map, tour) legitimately fire many
// requests per visitor, so this is deliberately generous — it's here to
// blunt scripted scraping/abuse against these unauthenticated, DB-querying
// endpoints, not to throttle normal browsing.
app.use("/api/public", rateLimit({ windowMs: 60 * 1000, max: 120 }));

// --- Routes ---
app.use("/api/auth", authRoutes);
app.use("/api/auth/sso", ssoRoutes); // open (login redirect + callback) — see routes/sso.js
app.use("/api/sso-providers", ssoProviderRoutes); // protected (admin role only)
app.use("/api/missionaries", missionaryRoutes); // protected (admin) — session required
app.use("/api/public/missionaries", publicMissionaryRoutes); // open (public site)
app.use("/api/users", userRoutes); // protected (admin role only)
app.use("/api/public/country-info", countryInfoRoutes); // open (Joshua Project proxy)
app.use("/api/organizations", organizationRoutes); // protected (admin) — session required
app.use("/api/public/organizations", publicOrganizationRoutes); // open (public site)
app.use("/api/support-needs", supportNeedRoutes); // protected (admin) — session required
app.use("/api/newsletters", newsletterRoutes); // protected (admin) — session required
app.use("/api/documents", documentRoutes); // protected (admin) — session required
app.use("/api/settings", settingsRoutes); // protected (admin for write, any role for read)
app.use("/api/public/settings", publicSettingsRoutes); // open (public site + admin nav branding)

// Only exists at all if DEMO_RESET_TOKEN is configured — absent in every
// normal deployment. See ADMIN_GUIDE.md § Demo mode.
if (process.env.DEMO_RESET_TOKEN) {
  app.use("/api/demo", require("./routes/demo"));
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

// --- Frontend ---
// This backend serves the built frontend directly, so the whole app is one
// deployable origin. The build writes into backend/public (a sibling of
// src/, not frontend/dist — see frontend/vite.config.js) specifically so
// this path stays correct however the deploy bundle is packaged, since
// it's always relative to this file, never to the repo root. Mounted
// after every /api/* route above so an unmatched API path still 404s as
// JSON instead of falling through to index.html.
const frontendBuild = path.join(__dirname, "../public");
app.use(express.static(frontendBuild));
app.get("*splat", (req, res) => res.sendFile(path.join(frontendBuild, "index.html")));

// --- Error handler ---
// Full details always go to the server log. The client only gets err.message
// back for deliberate, controlled errors (err.status set below 500 by the
// route itself, e.g. Zod validation or an explicit 4xx) — an unexpected
// exception (a raw Prisma/JS error) gets a generic message instead, since
// its .message can otherwise leak internal details (schema/column names,
// stack-adjacent info) to any caller, including unauthenticated public API
// consumers.
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  const message = status < 500 ? err.message : "Server error";
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`Missionary Tracker API listening on port ${PORT}`);
});
