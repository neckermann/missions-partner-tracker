const express = require("express");
const prisma = require("../prismaClient");
const { requireRole } = require("../middleware/requireAuth");
const { checkForUpdate, APP_VERSION } = require("../utils/versionCheck");

const router = express.Router();
router.use(requireRole("admin"));

// Each package's own installed package.json -- the version actually
// resolved into node_modules, not the semver range string in this app's
// own package.json (e.g. "^7.10.1"). Only backend-side packages: a
// deployed instance never ships frontend/package.json (see
// versionCheck.js's own comment on why backend/package.json is the only
// one that reaches production), so a frontend dependency's version has
// to come from the frontend bundle itself at runtime (React.version),
// not from here -- see AdminSystemInfo.jsx.
function installedVersion(pkg) {
  try {
    return require(`${pkg}/package.json`).version;
  } catch {
    return null;
  }
}

// GET /api/system-info (admin only) -- "what's actually running," for an
// admin debugging something or a fork maintainer checking what they're
// on before filing a bug, rather than needing shell/SSH access. Admin-
// gated the same as everywhere else that exposes exact dependency
// versions: not because the numbers are sensitive on their own, but
// because they're a small vulnerability-scanning convenience for anyone
// who's already gotten admin access (see the issue this closes). Never
// returns the database connection string or any credential -- only
// version numbers and the non-secret deployment metadata Render happens
// to inject.
router.get("/", async (req, res, next) => {
  try {
    const [update, pgVersionRows, pgSizeRows] = await Promise.all([
      checkForUpdate(),
      prisma.$queryRaw`SELECT version() AS version`,
      prisma.$queryRaw`SELECT pg_database_size(current_database()) AS bytes`,
    ]);

    res.json({
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
        // Postgres reports this as "PostgreSQL 16.4 on x86_64-pc-linux-gnu,
        // compiled by gcc ..." -- the frontend just displays it as-is,
        // no parsing needed.
        version: pgVersionRows[0]?.version ?? null,
        sizeBytes: Number(pgSizeRows[0]?.bytes ?? 0),
      },
      // Render auto-injects these on every service -- see
      // https://render.com/docs/environment-variables#all-services. This
      // app explicitly supports deploying elsewhere too (ADMIN_GUIDE.md §
      // Deploying anywhere else), so `onRender: false` with everything
      // else null is a real, expected response shape, not an error state.
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
