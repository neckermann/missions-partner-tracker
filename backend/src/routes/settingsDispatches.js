const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");

// #271 Finding: split out of the former settings.js -- see
// settingsGroupMe.js's own header comment for the full reasoning.
const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// Notifications -- the admin/public email digest's own schedule
// (biweekly/monthly/quarterly), GroupMe's own daily-hour schedule,
// GroupMe's three content-type mutes, the one cross-channel restricted-
// partner safety gate, and email dispatch customization -- all
// admin-only church-wide config, same shape of settings sub-resource as
// GroupMe/Email (settingsGroupMe.js/settingsEmail.js) -- not gated by
// requireFeature (this page is useful to configure regardless of which
// channel(s) happen to be on, same reasoning Enabled Features itself is
// never gated). The old church-wide digestFrequency/digestDayOfWeek/
// digestDayOfMonth/digestHour mechanism is retired entirely (see
// schema.prisma's own comment on what replaced it) -- nothing here reads
// or writes those columns anymore. The pending queue and the manual
// review flow live in routes/dispatches.js, not here -- this is just the
// configuration half.
const dispatchSettingsSelect = {
  chatDispatchPrayerRequests: true,
  chatDispatchOneTimeNeeds: true,
  chatDispatchNewsletters: true,
  allowRestrictedPartnerDispatch: true,
  emailDispatchSubjectTemplate: true,
  emailDispatchSignature: true,
  emailDispatchLayout: true,
  // The admin/public email dispatch's own schedule -- three cadence
  // tiers (biweekly/monthly/quarterly). Without these ever being set,
  // dispatchOrchestrator.js's clearDispatchRecords() treats every
  // tier as unscheduled and emailDispatchScheduler.js's three gate checks never
  // fire -- see those files' own comments.
  emailDispatchDayOfWeek: true,
  emailDispatchDayOfMonth: true,
  emailDispatchHour: true,
  // GroupMe/WhatsApp's own, independent daily-hour chat schedule -- see
  // groupmeChannel.js's shouldFlushGroupMe and the field's own
  // schema.prisma comment for why this isn't a tier pick like the three
  // above.
  chatDispatchHour: true,
};

const dispatchSettingsSchema = z.object({
  chatDispatchPrayerRequests: z.boolean().optional(),
  chatDispatchOneTimeNeeds: z.boolean().optional(),
  chatDispatchNewsletters: z.boolean().optional(),
  allowRestrictedPartnerDispatch: z.boolean().optional(),
  emailDispatchSubjectTemplate: z.string().optional().nullable(),
  emailDispatchSignature: z.string().optional().nullable(),
  emailDispatchLayout: z.enum(["classic", "snapshot"]).optional().nullable(),
  emailDispatchDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  emailDispatchDayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  emailDispatchHour: z.number().int().min(0).max(23).nullable().optional(),
  chatDispatchHour: z.number().int().min(0).max(23).nullable().optional(),
});

router.get("/dispatches", requireRole("admin"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: dispatchSettingsSelect,
    });
    res.json(
      settings || {
        chatDispatchPrayerRequests: true,
        chatDispatchOneTimeNeeds: true,
        chatDispatchNewsletters: true,
        allowRestrictedPartnerDispatch: false,
        emailDispatchSubjectTemplate: null,
        emailDispatchSignature: null,
        emailDispatchLayout: null,
        emailDispatchDayOfWeek: null,
        emailDispatchDayOfMonth: null,
        emailDispatchHour: null,
        chatDispatchHour: null,
      }
    );
  } catch (err) {
    next(err);
  }
});

router.put("/dispatches", requireRole("admin"), async (req, res, next) => {
  try {
    const data = dispatchSettingsSchema.parse(req.body);
    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data, updatedById: req.user.id },
      update: { ...data, updatedById: req.user.id },
      select: dispatchSettingsSelect,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
