// Records every change to the church settings in the audit trail in one place:
// settings are written by many route files, so this wraps every write under
// /api/settings, snapshotting the ChurchSettings row before and diffing after a
// successful response.
//
//  - A secret column (API keys, tokens, passwords) is noted as "changed"; its
//    value is never read into the log.
//  - Each feature toggled in enabledFeatures is its own entry.
//  - Everything else is one "Changed church settings" entry with section and
//    old/new values (long text truncated).
// Mounted before the settings routers, so req.user doesn't exist yet; the actor is
// read when the response finishes.
const prisma = require("../prismaClient");
const { FEATURES } = require("../utils/features");
const { isAuditEnabled, recordAudit, clearAuditEnabledCache, secretChange } = require("../utils/auditLog");

const WRITE_METHODS = new Set(["PUT", "POST", "PATCH", "DELETE"]);
const SECRET_COLUMNS = [
  "groupmeAccessToken",
  "whatsappPhoneNumber",
  "joshuaProjectApiKey",
  "anthropicApiKey",
  "postmarkServerToken",
  "inboundEmailWebhookPassword",
];
// Bookkeeping that changes on every write (incl. the "last edited by" stamp), plus
// enabledFeatures, which is reported per feature.
const IGNORED_COLUMNS = new Set([
  "id",
  "updatedAt",
  "updatedById",
  "lastEditedById",
  "lastEditedByName",
  "lastEditedAt",
  "enabledFeatures",
]);
const MAX_TEXT = 200;

const snapshot = () => prisma.churchSettings.findUnique({ where: { id: "singleton" } });

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function shorten(v) {
  return typeof v === "string" && v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…` : v;
}

// Pure: what changed between two rows.
function diffSettings(before, after) {
  const secrets = [];
  const changes = {};
  for (const col of Object.keys(after || {})) {
    if (IGNORED_COLUMNS.has(col)) continue;
    if (same(before?.[col], after[col])) continue;
    if (SECRET_COLUMNS.includes(col)) secrets.push(col);
    else changes[col] = { from: shorten(before?.[col] ?? null), to: shorten(after[col]) };
  }
  const toggles = [];
  const featureKeys = new Set([
    ...Object.keys(before?.enabledFeatures || {}),
    ...Object.keys(after?.enabledFeatures || {}),
  ]);
  for (const key of featureKeys) {
    const def = FEATURES[key];
    if (!def) continue;
    const was =
      typeof before?.enabledFeatures?.[key] === "boolean" ? before.enabledFeatures[key] : def.defaultEnabled;
    const now =
      typeof after?.enabledFeatures?.[key] === "boolean" ? after.enabledFeatures[key] : def.defaultEnabled;
    if (was !== now) toggles.push({ key, label: def.label, from: was, to: now });
  }
  return { changes, secrets, toggles };
}

async function auditSettingsWrites(req, res, next) {
  if (!WRITE_METHODS.has(req.method)) return next();
  let before = null;
  let wasEnabled = false;
  // Taken BEFORE the route runs (awaited): a fast handler would otherwise write first and the diff would see nothing.
  try {
    wasEnabled = await isAuditEnabled();
    if (wasEnabled) before = await snapshot();
  } catch {
    // Never block a settings write on the audit trail.
  }
  res.on("finish", async () => {
    if (res.statusCode >= 400) return;
    try {
      clearAuditEnabledCache();
      const after = await snapshot();
      const nowEnabled = await isAuditEnabled();
      // Record if it was on before OR is on now (turning it on/off is itself an event).
      if (!wasEnabled && !nowEnabled) return;
      // While it was off there is no "before" worth diffing; only the switch-on is kept (below).
      const prior = wasEnabled && before ? before : { enabledFeatures: {} };
      const { changes, secrets, toggles } = diffSettings(prior, after);
      // The part of the URL after /api/settings, e.g. "email" or "dispatches".
      const section = req.originalUrl.split("?")[0].replace(/^\/api\/settings\/?/, "") || "general";
      const common = { actor: req.user, req, force: true };
      for (const t of toggles) {
        // While it was off, only the toggle that turns it on is kept.
        if (!wasEnabled && t.key !== "auditTrail") continue;
        await recordAudit(null, {
          ...common,
          action: "settings.feature_toggled",
          entity: { type: "settings", label: t.label },
          details: { feature: t.key, from: t.from, to: t.to },
        });
      }
      if (wasEnabled && (secrets.length || Object.keys(changes).length)) {
        await recordAudit(null, {
          ...common,
          action: "settings.updated",
          entity: { type: "settings", label: section },
          details: { ...changes, ...secretChange(secrets) },
        });
      }
    } catch (err) {
      console.error("Couldn't record a settings change:", err.message);
    }
  });
  next();
}

module.exports = { auditSettingsWrites, diffSettings, SECRET_COLUMNS };
