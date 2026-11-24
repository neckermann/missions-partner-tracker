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
  // #327 Finding 10 -- see the field's own comment in schema.prisma.
  restrictedPartnerInitialsEnabled: true,
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
  // Which of the three cadence tiers are even offered to an admin
  // (Account Settings) or a public subscriber (#209) -- see this field's
  // own schema.prisma comment. Independent of the schedule fields above
  // (a tier can be offered with no schedule set yet, same as any other
  // tier before this feature existed).
  cadenceBiweeklyEnabled: true,
  cadenceMonthlyEnabled: true,
  cadenceQuarterlyEnabled: true,
};

// Matches ChurchSettings' own default values -- used both for GET's
// no-row-yet fallback and as the "before" state for a PUT against an
// instance that's never saved these settings (a fresh upsert's create
// path), so the true->false transition check below sees the same
// starting point either way.
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

// Preference order for where a descoped subscriber lands (#209) -- a
// single global fallback tier, not "nearest enabled tier by frequency"
// (an open question the issue left for later; this is the simpler of the
// two options and the one explicitly suggested in the issue's own
// discussed approach). Monthly first since it's the new default cadence
// a subscriber would pick going forward anyway.
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

    // Same before/after transition-check pattern routes/supportNeeds.js's
    // own PUT uses -- fetch the cadence-tier state as it stands before
    // this request, so (a) the all-three-disabled check below validates
    // the real merged result of a partial PUT, not just whatever subset
    // of fields this request happens to send, and (b) the migration pass
    // after the write can tell which tier(s), if any, just transitioned
    // true -> false.
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

    // Migrate every subscriber currently on a tier that just transitioned
    // true -> false (#209) -- a one-time, forward-only move, not a
    // reversible mapping: re-enabling the tier later does not retroactively
    // move anyone back, matching this app's established "toggles only ever
    // affect going forward" convention. No notification email is sent --
    // this is a one-time admin action, not a recurring one, and keeping v1
    // simple was the deliberate call (see the PR description for the full
    // reasoning). Deliberately not awaited inside a transaction with the
    // upsert above: a failure here would be surprising to roll the settings
    // change back over, and both updateMany calls are idempotent/safe to
    // retry on their own.
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
