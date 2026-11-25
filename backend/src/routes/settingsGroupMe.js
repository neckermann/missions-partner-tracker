const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { encryptField, decryptField } = require("../utils/crypto");
const { listGroups, listTopics } = require("../utils/groupmeChannel");

const router = express.Router();
router.use(requireAuth);

const groupmeSettingsSelect = {
  groupmeAccessToken: true,
  groupmeGroupId: true,
  groupmeGroupName: true,
  groupmePrayerTopicId: true,
  groupmePrayerTopicName: true,
  groupmeOneTimeNeedTopicId: true,
  groupmeOneTimeNeedTopicName: true,
  groupmeNewsletterTopicId: true,
  groupmeNewsletterTopicName: true,
};
function shapeGroupMeSettings(settings) {
  return {
    configured: Boolean(settings?.groupmeAccessToken),
    groupId: settings?.groupmeGroupId || null,
    groupName: settings?.groupmeGroupName || null,
    prayerTopicId: settings?.groupmePrayerTopicId || null,
    prayerTopicName: settings?.groupmePrayerTopicName || null,
    oneTimeNeedTopicId: settings?.groupmeOneTimeNeedTopicId || null,
    oneTimeNeedTopicName: settings?.groupmeOneTimeNeedTopicName || null,
    newsletterTopicId: settings?.groupmeNewsletterTopicId || null,
    newsletterTopicName: settings?.groupmeNewsletterTopicName || null,
  };
}

const groupmeSchema = z.object({
  // Omitted/blank leaves the stored token untouched (write-only; nothing to show back or merge).
  accessToken: z.string().trim().min(1).optional(),
  // Set together from the admin's picks in the live GET /groupme/groups
  // and GET /groupme/groups/:id/topics lists below, never hand-typed.
  groupId: z.string().trim().optional().nullable(),
  groupName: z.string().trim().optional().nullable(),
  prayerTopicId: z.string().trim().optional().nullable(),
  prayerTopicName: z.string().trim().optional().nullable(),
  oneTimeNeedTopicId: z.string().trim().optional().nullable(),
  oneTimeNeedTopicName: z.string().trim().optional().nullable(),
  newsletterTopicId: z.string().trim().optional().nullable(),
  newsletterTopicName: z.string().trim().optional().nullable(),
});

// GET /api/settings/groupme (admin only -- not folded into GET /, which
// any logged-in role can read; this entire feature stays behind the
// admin gate, not just its writes).
router.get("/groupme", requireRole("admin"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: groupmeSettingsSelect,
    });
    res.json(shapeGroupMeSettings(settings));
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/groupme (admin only) -- a plain partial update, as PUT / in settings.js.
router.put("/groupme", requireRole("admin"), async (req, res, next) => {
  try {
    const {
      accessToken,
      groupId,
      groupName,
      prayerTopicId,
      prayerTopicName,
      oneTimeNeedTopicId,
      oneTimeNeedTopicName,
      newsletterTopicId,
      newsletterTopicName,
    } = groupmeSchema.parse(req.body);
    const fields = {
      groupmeGroupId: groupId,
      groupmeGroupName: groupName,
      groupmePrayerTopicId: prayerTopicId,
      groupmePrayerTopicName: prayerTopicName,
      groupmeOneTimeNeedTopicId: oneTimeNeedTopicId,
      groupmeOneTimeNeedTopicName: oneTimeNeedTopicName,
      groupmeNewsletterTopicId: newsletterTopicId,
      groupmeNewsletterTopicName: newsletterTopicName,
    };
    if (accessToken) fields.groupmeAccessToken = encryptField(accessToken);

    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...fields, updatedById: req.user.id },
      update: { ...fields, updatedById: req.user.id },
      select: groupmeSettingsSelect,
    });
    res.json(shapeGroupMeSettings(updated));
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/groupme/groups (admin only) -- the admin's own
// GroupMe groups, for the "which group" picker. Requires a token to
// already be saved; this app only ever lists, never creates.
router.get("/groupme/groups", requireRole("admin"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeAccessToken: true },
    });
    if (!settings?.groupmeAccessToken) {
      return res.status(400).json({ error: "Save a GroupMe access token first" });
    }
    try {
      res.json(await listGroups(decryptField(settings.groupmeAccessToken)));
    } catch (err) {
      // A GroupMe-side failure is routine here (this call exists to test the token). The generic error
      // handler collapses unexpected errors to "Server error" (middleware/errors.js); groupmeRequest's
      // message is safe to show, so it is surfaced.
      res.status(502).json({ error: err.message });
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/groupme/groups/:groupId/topics (admin only) -- that
// group's Topics, for the "which topic" picker.
router.get("/groupme/groups/:groupId/topics", requireRole("admin"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { groupmeAccessToken: true },
    });
    if (!settings?.groupmeAccessToken) {
      return res.status(400).json({ error: "Save a GroupMe access token first" });
    }
    try {
      res.json(await listTopics(decryptField(settings.groupmeAccessToken), req.params.groupId));
    } catch (err) {
      // See the matching comment on GET /groupme/groups above.
      res.status(502).json({ error: err.message });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
