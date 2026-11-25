const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

// Notification config: the admin/public email digest schedule, GroupMe's daily-hour schedule, its
// three content-type mutes, the cross-channel restricted-partner safety gate and email dispatch
// customization. Admin-only, church-wide; not gated by requireFeature since it is useful whichever
// channels are on. The pending queue and manual review live in routes/dispatches.js.
const dispatchSettingsSelect = {
  chatDispatchPrayerRequests: true,
  chatDispatchOneTimeNeeds: true,
  chatDispatchNewsletters: true,
  allowRestrictedPartnerDispatch: true,
  // See the field's comment in schema.prisma.
  restrictedPartnerInitialsEnabled: true,
  emailDispatchSubjectTemplate: true,
  emailDispatchSignature: true,
  emailDispatchLayout: true,
  // The email dispatch's three cadence-tier schedules (biweekly/monthly/quarterly). Unset,
  // dispatchOrchestrator.js's clearDispatchRecords() treats every tier as unscheduled and
  // emailDispatchScheduler.js never fires.
  emailDispatchDayOfWeek: true,
  emailDispatchDayOfMonth: true,
  emailDispatchHour: true,
  // GroupMe/WhatsApp's independent daily-hour schedule (see shouldFlushGroupMe in groupmeChannel.js
  // and schema.prisma).
  chatDispatchHour: true,
  // Which cadence tiers are offered to admins (Account Settings) and public subscribers (#209);
  // independent of the schedule fields above.
  cadenceBiweeklyEnabled: true,
  cadenceMonthlyEnabled: true,
  cadenceQuarterlyEnabled: true,
};

// ChurchSettings' default values: GET's no-row fallback, and the "before" state for a PUT on an
// instance that never saved these, so the true->false transition check sees the same start.
const DEFAULT_CADENCE_STATE = {
  cadenceBiweeklyEnabled: false,
  cadenceMonthlyEnabled: true,
  cadenceQuarterlyEnabled: true,
};

const DISPATCH_SETTINGS_DEFAULTS = {
  chatDispatchPrayerRequests: true,
  chatDispatchOneTimeNeeds: true,
  chatDispatchNewsletters: true,
  allowRestrictedPartnerDispatch: false,
  restrictedPartnerInitialsEnabled: true,
  emailDispatchSubjectTemplate: null,
  emailDispatchSignature: null,
  emailDispatchLayout: null,
  emailDispatchDayOfWeek: null,
  emailDispatchDayOfMonth: null,
  emailDispatchHour: null,
  chatDispatchHour: null,
  ...DEFAULT_CADENCE_STATE,
};

const dispatchSettingsSchema = z.object({
  chatDispatchPrayerRequests: z.boolean().optional(),
  chatDispatchOneTimeNeeds: z.boolean().optional(),
  chatDispatchNewsletters: z.boolean().optional(),
  allowRestrictedPartnerDispatch: z.boolean().optional(),
  restrictedPartnerInitialsEnabled: z.boolean().optional(),
  emailDispatchSubjectTemplate: z.string().optional().nullable(),
  emailDispatchSignature: z.string().optional().nullable(),
  emailDispatchLayout: z.enum(["classic", "snapshot"]).optional().nullable(),
  emailDispatchDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  emailDispatchDayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  emailDispatchHour: z.number().int().min(0).max(23).nullable().optional(),
  chatDispatchHour: z.number().int().min(0).max(23).nullable().optional(),
  cadenceBiweeklyEnabled: z.boolean().optional(),
  cadenceMonthlyEnabled: z.boolean().optional(),
  cadenceQuarterlyEnabled: z.boolean().optional(),
});

// Maps a cadence tier's name (as stored on User.cadence/PublicSubscriber.cadence)
// to its ChurchSettings enabled-flag column -- shared by the all-disabled
// validation and the descoped-subscriber migration below.
const CADENCE_TIER_FIELDS = {
  biweekly: "cadenceBiweeklyEnabled",
  monthly: "cadenceMonthlyEnabled",
  quarterly: "cadenceQuarterlyEnabled",
};

// Where a descoped subscriber lands (#209): one global fallback order, not "nearest enabled
// tier". Monthly first, as the default cadence.
const CADENCE_FALLBACK_PREFERENCE = ["monthly", "quarterly", "biweekly"];

function pickFallbackCadence(cadenceState) {
  return CADENCE_FALLBACK_PREFERENCE.find((tier) => cadenceState[CADENCE_TIER_FIELDS[tier]]);
}

router.get("/dispatches", requireRole("admin"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: dispatchSettingsSelect,
    });
    res.json(settings || DISPATCH_SETTINGS_DEFAULTS);
  } catch (err) {
    next(err);
  }
});

router.put("/dispatches", requireRole("admin"), async (req, res, next) => {
  try {
    const data = dispatchSettingsSchema.parse(req.body);

    // Fetch the cadence-tier state before the write (pattern from routes/supportNeeds.js PUT), so the
    // all-disabled check validates the merged result of a partial PUT and the migration can tell which
    // tiers just went true -> false.
    const before = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { cadenceBiweeklyEnabled: true, cadenceMonthlyEnabled: true, cadenceQuarterlyEnabled: true },
    });
    const beforeState = before || DEFAULT_CADENCE_STATE;
    const afterState = { ...beforeState, ...data };

    if (!pickFallbackCadence(afterState)) {
      return res
        .status(400)
        .json({ error: "At least one cadence tier (biweekly, monthly, or quarterly) must stay enabled." });
    }

    const updated = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data, updatedById: req.user.id },
      update: { ...data, updatedById: req.user.id },
      select: dispatchSettingsSelect,
    });

    // Migrate subscribers on a tier that just went true -> false (#209): one-time and forward-only
    // (re-enabling moves nobody back), with no notification email. Not in a transaction with the
    // upsert: rolling the settings change back over this would be surprising, and both updateMany
    // calls are idempotent.
    const disabledTiers = Object.entries(CADENCE_TIER_FIELDS)
      .filter(([, field]) => beforeState[field] && !afterState[field])
      .map(([tier]) => tier);

    if (disabledTiers.length > 0) {
      const fallback = pickFallbackCadence(afterState);
      await Promise.all([
        prisma.user.updateMany({
          where: { cadence: { in: disabledTiers } },
          data: { cadence: fallback },
        }),
        prisma.publicSubscriber.updateMany({
          where: { cadence: { in: disabledTiers } },
          data: { cadence: fallback },
        }),
      ]);
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
