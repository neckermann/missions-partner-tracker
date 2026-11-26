// The {id, kind, displayName} partner-reference shape every collection route needs
// for a "belongs to this partner" link; never more than these three scalars.
const partnerRefSelect = { select: { id: true, kind: true, displayName: true } };

module.exports = { partnerRefSelect };
