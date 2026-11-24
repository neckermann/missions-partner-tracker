// Append-only record of who changed whose access (#356). Takes the Prisma
// client OR a transaction handle, so the audit row commits atomically with
// the change it describes -- an access change that can't be recorded
// shouldn't happen at all.
const prisma = require("../prismaClient");

const AUDIT_ACTIONS = [
  "trip_access.grant",
  "trip_access.update", // expiry extended, ended early, or reset to the derived date
  "trip_access.revoke",
  "guest.deactivate_no_access", // last grant removed, so the login was deactivated
];

async function recordAudit(db, { actor, action, target, tripId, details }) {
  if (!AUDIT_ACTIONS.includes(action)) throw new Error(`Unknown audit action: ${action}`);
  return (db || prisma).auditLog.create({
    data: {
      actorUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      action,
      targetUserId: target?.id ?? null,
      targetEmail: target?.email ?? null,
      tripId: tripId ?? null,
      details: details ?? undefined,
    },
  });
}

module.exports = { recordAudit, AUDIT_ACTIONS };
