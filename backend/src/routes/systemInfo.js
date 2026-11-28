const express = require("express");
const prisma = require("../prismaClient");
const { requireRole } = require("../middleware/requireAuth");
const { checkForUpdate, APP_VERSION } = require("../utils/versionCheck");
const { isTestingSite } = require("../utils/demoMode");

const router = express.Router();
router.use(requireRole("admin"));

// Each package's installed package.json (the resolved version, not the semver range). Backend
// packages only: a deployed instance never ships frontend/package.json (see versionCheck.js), so
// frontend versions come from the bundle at runtime (React.version; AdminSystemInfo.jsx).
function installedVersion(pkg) {
  try {
    return require(`${pkg}/package.json`).version;
  } catch {
    return null;
  }
}

// GET /api/system-info (admin only) -- "what's actually running", for debugging or a bug report.
// Admin-only because exact dependency versions are a small vulnerability-scanning convenience. Never
// returns the database connection string or any credential, only versions and the non-secret
// deployment metadata Render injects.
router.get("/", async (req, res, next) => {
  try {
    const [update, pgVersionRows, pgSizeRows] = await Promise.all([
      checkForUpdate(),
      prisma.$queryRaw`SELECT version() AS version`,
      prisma.$queryRaw`SELECT pg_database_size(current_database()) AS bytes`,
    ]);

    // Things an administrator should see at a glance because they are almost never meant to be on. The testing-
    // site setting turns off a public demo's guards (passwordless sign-in, real sends); one mistaken variable on
    // a demo the public can reach would end password sign-in for its published logins.
    const warnings = [];
    if (isTestingSite()) {
      warnings.push(
        "DEMO_TESTING_SITE is set, so this site is running as a testing site: the public-demo guards are off (passwordless sign-in is allowed, and real integration keys can send). If the public can reach this site, remove that setting."
      );
    }

    res.json({
      warnings,
      app: {
        version: APP_VERSION,
        updateAvailable: update?.updateAvailable ?? false,
        latestVersion: update?.latestVersion ?? null,
        releaseUrl: update?.releaseUrl ?? null,
      },
      runtime: {
        node: process.version,
      },
      dependencies: {
        express: installedVersion("express"),
        prisma: installedVersion("prisma"),
        prismaClient: installedVersion("@prisma/client"),
      },
      database: {
        // Postgres reports e.g. "PostgreSQL 16.4 on x86_64-pc-linux-gnu, ..."; displayed as-is.
        version: pgVersionRows[0]?.version ?? null,
        sizeBytes: Number(pgSizeRows[0]?.bytes ?? 0),
      },
      // Render injects these on every service. Deploying elsewhere is supported (ADMIN_GUIDE.md §
      // Deploying anywhere else), so `onRender: false` with the rest null is an expected shape.
      deployment: {
        onRender: !!process.env.RENDER_SERVICE_NAME,
        serviceName: process.env.RENDER_SERVICE_NAME || null,
        gitCommit: process.env.RENDER_GIT_COMMIT || null,
        externalUrl: process.env.RENDER_EXTERNAL_URL || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
