// The {id, kind, displayName} partner-reference shape every collection
// route (newsletters, documents, trips, prayer requests, support needs,
// support entries) needs to render a "belongs to this partner" link/label
// -- never more than these three scalar fields, so one shared constant
// instead of six independently-maintained copies (see #135).
const partnerRefSelect = { select: { id: true, kind: true, displayName: true } };

module.exports = { partnerRefSelect };
