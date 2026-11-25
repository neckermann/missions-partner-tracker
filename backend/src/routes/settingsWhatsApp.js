const express = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const whatsappClient = require("../utils/whatsappClient");

const router = express.Router();
router.use(requireAuth);

// WhatsApp -- sibling of the GroupMe routes. Admin-only AND behind the `whatsapp` feature (a disabled
// feature 404s). There is no token to save: the credential is a Baileys session stored encrypted in
// WhatsAppAuthEntry and never read back through any route (only a status from the live socket).
// Community and group ids are always picked from live lists.
const whatsappSettingsSelect = {
  whatsappPhoneNumber: true,
  whatsappPairedAt: true,
  whatsappCommunityId: true,
  whatsappCommunityName: true,
  whatsappAnnouncementGroupId: true,
  whatsappAnnouncementGroupName: true,
  whatsappPrayerGroupId: true,
  whatsappPrayerGroupName: true,
  whatsappOneTimeNeedGroupId: true,
  whatsappOneTimeNeedGroupName: true,
  whatsappNewsletterGroupId: true,
  whatsappNewsletterGroupName: true,
};
function shapeWhatsAppSettings(settings) {
  const { status, health, error } = whatsappClient.getStatus();
  return {
    paired: Boolean(settings?.whatsappPairedAt),
    pairedAt: settings?.whatsappPairedAt || null,
    phoneNumber: settings?.whatsappPhoneNumber || null,
    communityId: settings?.whatsappCommunityId || null,
    communityName: settings?.whatsappCommunityName || null,
    announcementGroupId: settings?.whatsappAnnouncementGroupId || null,
    announcementGroupName: settings?.whatsappAnnouncementGroupName || null,
    prayerGroupId: settings?.whatsappPrayerGroupId || null,
    prayerGroupName: settings?.whatsappPrayerGroupName || null,
    oneTimeNeedGroupId: settings?.whatsappOneTimeNeedGroupId || null,
    oneTimeNeedGroupName: settings?.whatsappOneTimeNeedGroupName || null,
    newsletterGroupId: settings?.whatsappNewsletterGroupId || null,
    newsletterGroupName: settings?.whatsappNewsletterGroupName || null,
    connection: { status, health, error },
  };
}

const whatsappJid = z
  .string()
  .trim()
  .regex(/^[\w.-]+@g\.us$/, "Not a WhatsApp group id")
  .nullable()
  .optional();
const whatsappLabel = z.string().trim().max(200).nullable().optional();
const whatsappSchema = z.object({
  communityId: whatsappJid,
  communityName: whatsappLabel,
  prayerGroupId: whatsappJid,
  prayerGroupName: whatsappLabel,
  oneTimeNeedGroupId: whatsappJid,
  oneTimeNeedGroupName: whatsappLabel,
  newsletterGroupId: whatsappJid,
  newsletterGroupName: whatsappLabel,
});

// Anyone who scans a live QR code links their phone to this app's
// session, so pairing starts are throttled; the status poll is not (it's
// polled every couple of seconds while the pairing screen is open).
const whatsappPairLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const whatsappGate = [requireFeature("whatsapp"), requireRole("admin")];

router.get("/whatsapp", ...whatsappGate, async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: whatsappSettingsSelect,
    });
    res.set("Cache-Control", "no-store");
    res.json(shapeWhatsAppSettings(settings));
  } catch (err) {
    next(err);
  }
});

// A plain partial update, like PUT /groupme. Picking a different community clears the three group
// picks (they belonged to the old one) unless the same request sets them again.
router.put("/whatsapp", ...whatsappGate, async (req, res, next) => {
  try {
    const body = whatsappSchema.parse(req.body);
    const current = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: whatsappSettingsSelect,
    });
    const communityChanged =
      body.communityId !== undefined && body.communityId !== (current?.whatsappCommunityId ?? null);
    const groupPick = (id, name) =>
      communityChanged ? { id: id ?? null, name: name ?? null } : { id, name };
    const prayer = groupPick(body.prayerGroupId, body.prayerGroupName);
    const needs = groupPick(body.oneTimeNeedGroupId, body.oneTimeNeedGroupName);
    const newsletter = groupPick(body.newsletterGroupId, body.newsletterGroupName);

    // The Announcements group is auto-resolved (whatsappClient.js findAnnouncementGroup), so a community
    // change re-resolves it rather than clearing it. Best-effort: a momentary disconnect must not block
    // saving the community; it is left null.
    let announcement = {
      id: current?.whatsappAnnouncementGroupId ?? null,
      name: current?.whatsappAnnouncementGroupName ?? null,
    };
    if (communityChanged) {
      announcement = { id: null, name: null };
      if (body.communityId) {
        try {
          const found = await whatsappClient.findAnnouncementGroup(body.communityId);
          if (found) announcement = { id: found.id, name: found.name };
        } catch {
          // Not found or WhatsApp unreachable: leave the announcement group unset.
        }
      }
    }

    const fields = {
      whatsappCommunityId: body.communityId,
      whatsappCommunityName: body.communityName,
      whatsappAnnouncementGroupId: announcement.id,
      whatsappAnnouncementGroupName: announcement.name,
      whatsappPrayerGroupId: prayer.id,
      whatsappPrayerGroupName: prayer.name,
      whatsappOneTimeNeedGroupId: needs.id,
      whatsappOneTimeNeedGroupName: needs.name,
      whatsappNewsletterGroupId: newsletter.id,
      whatsappNewsletterGroupName: newsletter.name,
    };
    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...fields, updatedById: req.user.id },
      update: { ...fields, updatedById: req.user.id },
      select: whatsappSettingsSelect,
    });
    res.json(shapeWhatsAppSettings(updated));
  } catch (err) {
    next(err);
  }
});

// Starts pairing; the QR is read back from /whatsapp/pair/status.
router.post("/whatsapp/pair", whatsappPairLimiter, ...whatsappGate, async (req, res, next) => {
  try {
    const current = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { whatsappPairedAt: true },
    });
    if (current?.whatsappPairedAt) {
      return res.status(409).json({ error: "A WhatsApp number is already linked. Unlink it first." });
    }
    try {
      await whatsappClient.startPairing();
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
    res.set("Cache-Control", "no-store");
    res.json({ started: true });
  } catch (err) {
    next(err);
  }
});

// Polled while the pairing screen is open. no-store: this carries a live
// QR code / pairing code, which must never sit in a cache.
router.get("/whatsapp/pair/status", ...whatsappGate, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(whatsappClient.getStatus());
});

router.get("/whatsapp/communities", ...whatsappGate, async (req, res) => {
  try {
    res.json(await whatsappClient.listCommunities());
  } catch (err) {
    // A WhatsApp-side failure is routine here; see GET /groupme/groups (settingsGroupMe.js).
    res.status(502).json({ error: err.message });
  }
});

router.get("/whatsapp/communities/:communityId/groups", ...whatsappGate, async (req, res) => {
  try {
    res.json(await whatsappClient.listCommunityGroups(req.params.communityId));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Unlinks the number for good: WhatsApp drops the linked device, the
// stored session is wiped, and the saved community/group picks are
// cleared (they belonged to that number's memberships).
router.post("/whatsapp/unlink", ...whatsappGate, async (req, res, next) => {
  try {
    await whatsappClient.unlink();
    const updated = await prisma.churchSettings.updateMany({
      where: { id: "singleton" },
      data: {
        whatsappCommunityId: null,
        whatsappCommunityName: null,
        whatsappAnnouncementGroupId: null,
        whatsappAnnouncementGroupName: null,
        whatsappPrayerGroupId: null,
        whatsappPrayerGroupName: null,
        whatsappOneTimeNeedGroupId: null,
        whatsappOneTimeNeedGroupName: null,
        whatsappNewsletterGroupId: null,
        whatsappNewsletterGroupName: null,
      },
    });
    void updated;
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: whatsappSettingsSelect,
    });
    res.json(shapeWhatsAppSettings(settings));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
