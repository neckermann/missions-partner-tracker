const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { isFeatureEnabled } = require("../utils/features");
const { encryptField } = require("../utils/crypto");
const { sendEmail } = require("../utils/email");
const { refuseOnGuardedDemo } = require("../utils/demoMode");

const router = express.Router();
router.use(requireAuth);

// Outbound (#71) and inbound (#72) share one Postmark account and settings page but have
// independent feature flags (utils/features.js). GET/PUT here use requireFeature's any-of array form
// so configuring one direction is not blocked by the other being off. The direction-specific routes
// (POST /email/test, routes/inboundEmail.js) still check their own single flag, which keeps the
// directions independent.
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
    // Informational (#252): the address people were told to email; not involved in routing the webhook.
    inboundEmailAddress: settings?.inboundEmailAddress || null,
    // The username alone is meaningless without the password (schema.prisma), so echoing it back is
    // safe. webhookPath is static: the admin builds the Basic-Auth URL in Postmark from it, so no
    // credential-bearing URL is ever rendered here.
    webhookUsername: settings?.inboundEmailWebhookUsername || null,
    webhookPath: "/api/inbound-email/postmark",
  };
}

const emailSchema = z.object({
  // Omitted/blank leaves the stored value untouched (write-only, as settingsGroupMe.js's accessToken).
  sendEnabled: z.boolean().optional(),
  serverToken: z.string().trim().min(1).optional(),
  fromAddress: z.string().trim().email().optional().nullable(),
  receiveEnabled: z.boolean().optional(),
  webhookUsername: z.string().trim().min(1).optional(),
  webhookPassword: z.string().trim().min(1).optional(),
  // Plain text, not a secret -- the address partners send mail to (#252).
  inboundEmailAddress: z.string().trim().email().optional().nullable(),
});

// GET /api/settings/email -- unlike GroupMe/Joshua Project/AI Extraction (reachable while off),
// Email's settings are gated like a content feature (partnerFiles.js): off means unreachable. Turn
// one direction on first from Enabled Features (never gated).
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
  refuseOnGuardedDemo("Changing integration settings"),
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

      // enabledFeatures is one JSON blob shared with other integrations; Prisma has no partial-JSON
      // update, so read it and merge just these two keys.
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

// POST /api/settings/email/test -- outbound-specific: checks "outboundEmail" alone, not the any-of
// gate, so sending stays blocked if only inbound is on. Sends a real email to the caller's own
// address so a bad token/from-address is caught here.
router.post("/email/test", requireFeature("outboundEmail"), requireRole("admin"), async (req, res, next) => {
  try {
    await sendEmail({
      to: req.user.email,
      subject: "Test email from missions-partner-tracker",
      text: "If you're reading this, your email settings are working.",
    });
    res.json({ sent: true });
  } catch (err) {
    // A bad token/from-address is routine here; this call exists to find out (as GroupMe's live-check
    // routes).
    res.status(err.status === 400 ? 400 : 502).json({ error: err.message });
  }
});

module.exports = router;
