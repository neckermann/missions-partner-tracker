// Filtering lists by a partner's sending church -- ours included. A partner's
// sending church is its `SendingParty` of type "church" (one per partner);
// "sent by our church" is the partner flag `sentByOurChurch`, which also writes
// our own church into that SendingParty (routes/partners.js syncSendingChurch).
// So "ours" is one option that means the flag, and every other option is a church
// name. The same query parameter (`sendingChurch`) works on every list that is
// about partners or things that belong to a partner.
const prisma = require("../prismaClient");

// The value for "our own church" in the `sendingChurch` query parameter and the
// filter's options.
const OURS = "__ours__";

// A Prisma filter on a Partner for a `sendingChurch` value, or null for none.
function sendingChurchPartnerWhere(value) {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v || v === "all") return null;
  if (v === OURS) return { sentByOurChurch: true };
  return { sendingParties: { some: { type: "church", name: { equals: v, mode: "insensitive" } } } };
}

// Merge that filter onto a list's `where.partner` (a relation filter), keeping any
// partner filter already there (such as the partner-type one).
function withSendingChurch(where, value) {
  const clause = sendingChurchPartnerWhere(value);
  if (clause) where.partner = { ...(where.partner || {}), ...clause };
  return where;
}

// The options for the filter: ours first (when any partner is sent by us), then
// every other sending church by name, each with how many active partners it has.
async function listSendingChurches(db = prisma) {
  const [settings, rows, oursCount] = await Promise.all([
    db.churchSettings.findUnique({ where: { id: "singleton" }, select: { churchName: true } }),
    db.sendingParty.findMany({
      where: { type: "church", name: { not: null }, partner: { archived: false } },
      select: { name: true, partner: { select: { sentByOurChurch: true } } },
    }),
    db.partner.count({ where: { sentByOurChurch: true, archived: false } }),
  ]);
  const ourName = (settings?.churchName || "").trim().toLowerCase();
  const byName = new Map();
  for (const r of rows) {
    const name = (r.name || "").trim();
    if (!name) continue;
    // A partner sent by us carries our own name here; it is counted under "ours".
    if (r.partner.sentByOurChurch || name.toLowerCase() === ourName) continue;
    const key = name.toLowerCase();
    const entry = byName.get(key) || { value: name, label: name, count: 0, ours: false };
    entry.count += 1;
    byName.set(key, entry);
  }
  const others = [...byName.values()].sort((a, b) => a.label.localeCompare(b.label));
  const ours =
    oursCount > 0
      ? [
          {
            value: OURS,
            label: settings?.churchName ? `Sent by us — ${settings.churchName}` : "Sent by us",
            count: oursCount,
            ours: true,
          },
        ]
      : [];
  return [...ours, ...others];
}

module.exports = { OURS, sendingChurchPartnerWhere, withSendingChurch, listSendingChurches };
