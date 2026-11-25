const prisma = require("../prismaClient");
const { isFeatureEnabled, isAnyFeatureEnabled } = require("../utils/features");

// Server-side enforcement of a feature toggle: a disabled feature's routes 404
// (not 403) so it looks nonexistent. `keyOrKeys` is one feature key, or an array
// for "reachable while at least one is on" (e.g. the public data routes backing
// both directory and map; see utils/features.js).
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
