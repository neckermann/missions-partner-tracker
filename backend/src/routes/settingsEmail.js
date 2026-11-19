const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { isFeatureEnabled } = require("../utils/features");
const { encryptField } = require("../utils/crypto");
const { sendEmail } = require("../utils/email");

// #271 Finding: split out of the former settings.js -- see
// settingsGroupMe.js's own header comment for the full reasoning.
const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// Outbound (#71) and inbound (#72) share one Postmark account and one
// settings page, but are gated by two independent feature flags -- see
// the comment on these two keys in utils/features.js for why. GET/PUT
// here must be reachable if EITHER is on (an admin configuring only
// inbound must not be blocked by outbound being off, and vice versa),
// so this uses requireFeature's array form (any-of) rather than a single
// key -- same mechanism the public directory/map pair already uses for
// the same "reachable if at least one of these is on" reasoning. The
// two feature-specific routes below (POST /email/test,
// routes/inboundEmail.js's webhook + queue routes) still check their own
// single flag, which is what actually keeps the two directions
// independent -- this shared page is just a convenience, not a new
// source of truth.
const emailSettingsSelect = {
  postmarkServerToken: true,
  emailFromAddress: true,
  inboundEmailWebhookUsername: true,
  inboundEmailWebhookPassword: true,
  inboundEmailAddress: true,
  enabledFeatures: true,
};

function shapeEmailSettings(settings) {
  return {
    sendEnabled: isFeatureEnabled(settings?.enabledFeatures, "outboundEmail"),
    outboundConfigured: Boolean(settings?.postmarkServerToken && settings?.emailFromAddress),
    fromAddress: settings?.emailFromAddress || null,
    receiveEnabled: isFeatureEnabled(settings?.enabledFeatures, "inboundEmail"),
    inboundConfigured: Boolean(
      settings?.inboundEmailWebhookUsername && settings?.inboundEmailWebhookPassword
    ),
    // Purely informational (#252) -- the address partners/participants
    // were told, outside this app, to send mail to. Not involved in
    // routing the webhook itself.
    inboundEmailAddress: settings?.inboundEmailAddress || null,
    // The username alone is meaningless without the password (see the
    // schema.prisma comment), so it's safe to echo back -- useful for an
    // admin to confirm what they set without re-typing it. webhookPath is
    // static, not a DB value -- the admin builds the full Basic-Auth URL
    // themselves in Postmark's own UI from this path plus the username/
    // password they chose, never a pre-built credential-bearing URL
    // rendered here (see #72's plan for why).
    webhookUsername: settings?.inboundEmailWebhookUsername || null,
    webhookPath: "/api/inbound-email/postmark",
  };
}

const emailSchema = z.object({
  // Omitted/blank leaves the stored value untouched -- same write-only-
  // field UX as groupme's accessToken (settingsGroupMe.js), now for four
  // independent credential fields plus the two enable toggles.
  sendEnabled: z.boolean().optional(),
  serverToken: z.string().trim().min(1).optional(),
  fromAddress: z.string().trim().email().optional().nullable(),
  receiveEnabled: z.boolean().optional(),
  webhookUsername: z.string().trim().min(1).optional(),
  webhookPassword: z.string().trim().min(1).optional(),
  // Plain text, not a secret -- the address partners send mail to (#252).
  inboundEmailAddress: z.string().trim().email().optional().nullable(),
});

// GET /api/settings/email -- unlike GroupMe/Joshua Project/AI Extraction
// (whose settings stay reachable while off, so an admin can configure
// them before flipping the switch), Email's settings route is gated the
// same way a real content feature's routes are (see
// routes/partnerFiles.js's router.use(requireFeature(...))) -- off means
// genuinely not reachable, not just hidden from nav. A church with
// neither direction on yet turns one on first from Enabled Features
// (which is never gated), then this page becomes reachable to configure
// it (and, from here, optionally also turn the other direction on).
router.get(
  "/email",
  requireFeature(["outboundEmail", "inboundEmail"]),
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const settings = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: emailSettingsSelect,
      });
      res.json(shapeEmailSettings(settings));
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/settings/email -- see the same gating comment on GET above.
router.put(
  "/email",
  requireFeature(["outboundEmail", "inboundEmail"]),
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const {
        sendEnabled,
        serverToken,
        fromAddress,
        receiveEnabled,
        webhookUsername,
        webhookPassword,
        inboundEmailAddress,
      } = emailSchema.parse(req.body);

      const fields = {};
      if (serverToken) fields.postmarkServerToken = encryptField(serverToken);
      if (fromAddress !== undefined) fields.emailFromAddress = fromAddress;
      if (webhookUsername) fields.inboundEmailWebhookUsername = webhookUsername;
      if (webhookPassword) fields.inboundEmailWebhookPassword = encryptField(webhookPassword);
      if (inboundEmailAddress !== undefined) fields.inboundEmailAddress = inboundEmailAddress;

      // enabledFeatures is one JSON blob shared with every other
      // integration's own flag (GroupMe, Joshua Project, ...) and with
      // the Enabled Features page itself -- Prisma has no partial-JSON
      // update, so this reads the current blob and merges just these two
      // keys onto it rather than replacing the whole thing.
      if (sendEnabled !== undefined || receiveEnabled !== undefined) {
        const current = await prisma.churchSettings.findUnique({
          where: { id: "singleton" },
          select: { enabledFeatures: true },
        });
        fields.enabledFeatures = {
          ...(current?.enabledFeatures || {}),
          ...(sendEnabled !== undefined ? { outboundEmail: sendEnabled } : {}),
          ...(receiveEnabled !== undefined ? { inboundEmail: receiveEnabled } : {}),
        };
      }

      const updated = await prisma.churchSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", ...fields, updatedById: req.user.id },
        update: { ...fields, updatedById: req.user.id },
        select: emailSettingsSelect,
      });
      res.json(shapeEmailSettings(updated));
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/settings/email/test -- outbound-specific, so this checks
// "outboundEmail" alone (not the any-of gate above) -- sending must stay
// blocked if only inbound is on. Sends a real email to the caller's own
// account address, so a bad token/from-address is caught here rather
// than at the first real send.
router.post("/email/test", requireFeature("outboundEmail"), requireRole("admin"), async (req, res, next) => {
  try {
    await sendEmail({
      to: req.user.email,
      subject: "Test email from missions-partner-tracker",
      text: "If you're reading this, your email settings are working.",
    });
    res.json({ sent: true });
  } catch (err) {
    // A bad token/from-address/Postmark-side failure is routine here --
    // this is exactly the call an admin makes to find out their settings
    // don't work. Same reasoning as GroupMe's live-check routes
    // (settingsGroupMe.js).
    res.status(err.status === 400 ? 400 : 502).json({ error: err.message });
  }
});

module.exports = router;
