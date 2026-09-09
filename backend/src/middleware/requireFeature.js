const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("../utils/features");

// Server-side enforcement of a church's feature toggle -- the frontend
// hides the corresponding nav link/button, but a disabled feature's routes
// 404 here too, so turning a feature off isn't just cosmetic. 404 (not 403)
// on purpose: a disabled feature should look like it doesn't exist, same
// as any other not-yet-built route.
function requireFeature(key) {
  return async (req, res, next) => {
    try {
      const settings = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { enabledFeatures: true },
      });
      if (!isFeatureEnabled(settings?.enabledFeatures, key)) {
        return res.status(404).json({ error: "Not found" });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireFeature };
