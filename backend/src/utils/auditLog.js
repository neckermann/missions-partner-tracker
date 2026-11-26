// The admin audit trail: who did what, when, for sensitive actions. One
// append-only table (AuditLog), gated by the `auditTrail` feature, pruned after
// ChurchSettings.auditRetentionDays.
//
// Deliberately NOT:
//  - "Last edited by" on a record (a current-state fact that never expires; see
//    utils/lastEdited.js). This is event history.
//  - A log of routine work (visible through the record and its timestamps).
//
// Actor and target are stored as ids PLUS an email/name snapshot, with no foreign
// keys, so entries stay readable after an account is deleted. `details` holds
// old/new values and must never hold a secret's value (see `secretChange`).
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");

// code -> { label, category }; categories group the Audit log page's filter.
const AUDIT_ACTIONS = {
  "auth.login_success": { label: "Signed in", category: "Sign-in" },
  "auth.login_failed": { label: "Failed sign-in", category: "Sign-in" },
  "auth.password_changed": { label: "Changed their password", category: "Sign-in" },
  "auth.password_set": { label: "Set a password from a setup link", category: "Sign-in" },
  "auth.password_reset": { label: "Reset the password from an emailed link", category: "Sign-in" },
  "auth.password_reset_requested": { label: "Requested a password reset", category: "Sign-in" },
  "auth.mfa_enabled": { label: "Turned on two-factor authentication", category: "Sign-in" },
  "auth.mfa_disabled": { label: "Turned off two-factor authentication", category: "Sign-in" },
  "auth.sign_in_link_requested": { label: "Asked for an emailed sign-in link", category: "Sign-in" },
  "auth.passkey_added": { label: "Added a passkey", category: "Sign-in" },
  "auth.passkey_removed": { label: "Removed a passkey", category: "Sign-in" },

  "user.created": { label: "Created an account", category: "Accounts" },
  "user.updated": { label: "Changed an account", category: "Accounts" },
  "user.deleted": { label: "Deleted an account", category: "Accounts" },
  "user.mfa_reset": { label: "Reset someone's two-factor authentication", category: "Accounts" },
  "user.setup_link_sent": { label: "Sent a setup link", category: "Accounts" },

  "trip_access.grant": { label: "Gave a guest access to a trip", category: "Access" },
  "trip_access.update": { label: "Changed a guest's trip access", category: "Access" },
  "trip_access.revoke": { label: "Removed a guest's trip access", category: "Access" },
  "guest.deactivate_no_access": {
    label: "Deactivated a guest left with no access",
    category: "Access",
  },
  "care_team.updated": { label: "Changed a partner's care team", category: "Access" },

  "settings.updated": { label: "Changed church settings", category: "Settings" },
  "settings.feature_toggled": { label: "Turned a feature on or off", category: "Settings" },

  "partner.deleted": { label: "Deleted a partner", category: "Deletes" },
  "trip.deleted": { label: "Deleted a trip", category: "Deletes" },

  "survey.update_approved": { label: "Approved a change from a survey answer", category: "Data" },
  "survey.update_rejected": { label: "Rejected a change from a survey answer", category: "Data" },

  "backup.downloaded": { label: "Downloaded a backup", category: "Data" },
  "backup.download_refused": { label: "Backup download refused (wrong password)", category: "Data" },
  "backup.restored": { label: "Restored the site from a backup", category: "Data" },
  "backup.restore_refused": { label: "Backup restore refused", category: "Data" },

  "partner.restricted_changed": { label: "Changed a partner's restricted status", category: "Restricted" },
  "partner.restricted_viewed": { label: "Viewed a restricted partner", category: "Restricted" },
};

const RETENTION_CHOICES = [30, 60, 90];
const DEFAULT_RETENTION_DAYS = 90;

function retentionDays(value) {
  return RETENTION_CHOICES.includes(value) ? value : DEFAULT_RETENTION_DAYS;
}

// Whether the feature is on. Read from ChurchSettings with a short cache so a
// busy route (a restricted partner's page) doesn't add a query per request.
// Settings writes call clearAuditEnabledCache() so a toggle takes effect now.
const ENABLED_TTL_MS = 10_000;
let enabledCache = null; // { value, at }
function clearAuditEnabledCache() {
  enabledCache = null;
}
async function isAuditEnabled(now = Date.now()) {
  if (enabledCache && now - enabledCache.at < ENABLED_TTL_MS) return enabledCache.value;
  const row = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const value = isFeatureEnabled(row?.enabledFeatures, "auditTrail");
  enabledCache = { value, at: now };
  return value;
}

const nameOf = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || null;

// A person as stored on a row: id plus the email/name they have now. A session's
// req.user carries only id/email/role, so a person given by id alone is looked up.
async function resolvePerson(db, user) {
  if (!user) return null;
  if (user.id && user.firstName === undefined && user.lastName === undefined) {
    const row = await (db || prisma).user.findUnique({
      where: { id: user.id },
      select: { email: true, firstName: true, lastName: true },
    });
    if (row) return { id: user.id, ...row };
  }
  return user;
}

function personFields(prefix, user) {
  return {
    [`${prefix}UserId`]: user?.id ?? null,
    [`${prefix}Email`]: user?.email ?? null,
    [`${prefix}Name`]: user ? nameOf(user) : null,
  };
}

function ipFromReq(req) {
  return req?.ip || req?.socket?.remoteAddress || null;
}

// Record one event. Pass a Prisma transaction handle as `db` to commit the row
// with the change it describes, or null to use the shared client. A no-op while
// the feature is off. Throws on an unknown action (a typo must not silently
// drop events); a database failure is the caller's to handle -- use
// recordAuditSafe where the event must never block what it describes (a
// sign-in).
//
//   actor / target: a user-ish { id, email, firstName, lastName }
//   entity: { type, id, label } for a non-account record
async function recordAudit(db, { action, actor, target, entity, req, ip, details, force = false }) {
  if (!AUDIT_ACTIONS[action]) throw new Error(`Unknown audit action: ${action}`);
  // `force` is for the one event that must be written while the feature is
  // being switched off: the switch-off itself.
  if (!force && !(await isAuditEnabled())) return null;
  const [actorRow, targetRow] = await Promise.all([resolvePerson(db, actor), resolvePerson(db, target)]);
  return (db || prisma).auditLog.create({
    data: {
      action,
      ...personFields("actor", actorRow),
      ...personFields("target", targetRow),
      entityType: entity?.type ?? null,
      entityId: entity?.id ?? null,
      entityLabel: entity?.label ?? null,
      ip: ip ?? ipFromReq(req),
      details: details ?? undefined,
    },
  });
}

async function recordAuditSafe(db, event) {
  try {
    return await recordAudit(db, event);
  } catch (err) {
    console.error("Couldn't record an audit event:", err.message);
    return null;
  }
}

// What a settings write records for a secret field: that it changed, never the
// value. `fields` is the list of secret keys present in the request body.
function secretChange(fields) {
  return Object.fromEntries(fields.map((f) => [f, "changed"]));
}

// The first look at a restricted partner by one person in one day. Viewing is
// the noisy event, so it is logged once per (viewer, partner, calendar day in
// the church's timezone) rather than on every request.
async function recordRestrictedView({ viewer, partner, req, now = new Date() }) {
  if (!(await isAuditEnabled())) return null;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0); // process.env.TZ is the church's timezone
  const seen = await prisma.auditLog.findFirst({
    where: {
      action: "partner.restricted_viewed",
      actorUserId: viewer.id,
      entityId: partner.id,
      createdAt: { gte: dayStart },
    },
    select: { id: true },
  });
  if (seen) return null;
  return recordAudit(null, {
    action: "partner.restricted_viewed",
    actor: viewer,
    entity: { type: "partner", id: partner.id, label: partner.displayName },
    req,
  });
}

// Delete events older than the retention window. Runs daily in the scheduled jobs and
// whether or not the feature is currently on, so turning it off doesn't leave
// old rows behind forever.
async function pruneAuditLog({ now = new Date() } = {}) {
  const row = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { auditRetentionDays: true },
  });
  const days = retentionDays(row?.auditRetentionDays);
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { deleted: count, days };
}

module.exports = {
  AUDIT_ACTIONS,
  RETENTION_CHOICES,
  DEFAULT_RETENTION_DAYS,
  retentionDays,
  isAuditEnabled,
  clearAuditEnabledCache,
  recordAudit,
  recordAuditSafe,
  recordRestrictedView,
  secretChange,
  pruneAuditLog,
};
