const prisma = require("../prismaClient");
const { isFeatureEnabled, isAnyFeatureEnabled } = require("../utils/features");

// Server-side enforcement of a church's feature toggle -- the frontend
// hides the corresponding nav link/button, but a disabled feature's routes
// 404 here too, so turning a feature off isn't just cosmetic. 404 (not 403)
// on purpose: a disabled feature should look like it doesn't exist, same
// as any other not-yet-built route.
//
// `keyOrKeys` is a single feature key, or an array for "reachable as long
// as at least one is on" (e.g. the public missionary/organization data
// routes, which back both the directory and map pages -- see
// isAnyFeatureEnabled's comment in utils/features.js).
function requireFeature(keyOrKeys) {
  return async (req, res, next) => {
    try {
      const settings = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { enabledFeatures: true },
      });
      const enabled = Array.isArray(keyOrKeys)
        ? isAnyFeatureEnabled(settings?.enabledFeatures, keyOrKeys)
        : isFeatureEnabled(settings?.enabledFeatures, keyOrKeys);
      if (!enabled) {
        return res.status(404).json({ error: "Not found" });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireFeature };
