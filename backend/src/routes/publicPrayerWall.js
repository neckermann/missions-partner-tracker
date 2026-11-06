const express = require("express");
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("../utils/features");
const { buildBlurb, PUBLIC_DIGEST_TYPES } = require("../utils/notificationBlurbs");
const { needsReview } = require("../utils/notificationFlush");

const router = express.Router();

// Public, no-login "recent prayer activity" page (#202) -- the same
// eligible-candidate logic the public scoped-digest path uses (prayer-
// request types + Partner.isPublic + not held for review), rendered
// read-only via buildBlurb. Gated on *both* flags, not requireFeature's
// own array form (which means "any of," not "all of" -- see that
// middleware's own comment) -- this page's whole purpose is collecting
// public subscribers, so it's pointless without the public site itself
// also being on.
router.use(async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enabledFeatures: true },
    });
    const ok =
      isFeatureEnabled(settings?.enabledFeatures, "publicDirectory") &&
      isFeatureEnabled(settings?.enabledFeatures, "publicPrayerDigest");
    if (!ok) return res.status(404).json({ error: "Not found" });
    next();
  } catch (err) {
    next(err);
  }
});

// GET / -- recent prayer-request activity across every public partner.
// Deliberately NOT an exhaustive always-current directory of every open
// request: a row naturally rolls off this list once it's fully cleared
// out of the PendingNotification queue (see utils/notificationFlush.js's
// clearing filter), same as it rolls off the admin's own Pending
// Notifications view. No stamping here -- viewing never consumes.
router.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.pendingNotification.findMany({
      where: { type: { in: [...PUBLIC_DIGEST_TYPES] } },
      orderBy: { createdAt: "desc" },
    });
    if (rows.length === 0) return res.json([]);

    const partners = await prisma.partner.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] }, isPublic: true, archived: false },
      select: { id: true, displayName: true, isRestricted: true },
    });
    const partnerById = new Map(partners.map((p) => [p.id, p]));

    const activity = rows
      .filter((row) => partnerById.has(row.partnerId))
      .filter((row) => !needsReview(row, partnerById.get(row.partnerId)))
      .map((row) => buildBlurb(row, partnerById.get(row.partnerId)))
      .filter(Boolean)
      // Never a source link for this audience, same structural guarantee
      // utils/scopedDigest.js's public render path keeps -- buildBlurb()
      // has no notion of audience, so this strips it rather than relying
      // on the field simply not being set.
      .map(({ sourceFileId, sourceLinkUrl, groupmeText, ...rest }) => rest);

    res.json(activity);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
