// Shared between routes/missionaries.js and routes/publicMissionaries.js --
// both query the same Missionary.sendingParties relation and need to
// reshape it back into the sendingChurch/sendingOrg object pair every
// caller (admin forms, maskData.js, AdminBooklet.jsx, the public site)
// has always expected. See SendingParty in schema.prisma for why this
// reshaping exists: two formerly-separate 1:1 relations (SendingChurch,
// SendingOrg) were merged into one type-discriminated to-many relation,
// and this is what makes that change invisible outside these two files.

// API -> DB: unpacks the nested `mailingAddress` object into the flat
// columns SendingParty actually stores.
function flattenSendingParty(sp, type) {
  const { mailingAddress, ...rest } = sp;
  return { type, ...rest, ...(mailingAddress || {}) };
}

// DB -> API: repacks a SendingParty row's flat address columns back into
// the nested `mailingAddress` shape the frontend has always expected.
function nestSendingParty(sp) {
  if (!sp) return null;
  const { id, missionaryId, type, addressLine1, addressLine2, city, stateProvinceRegion, postalCode, country, ...rest } = sp;
  return { ...rest, mailingAddress: { addressLine1, addressLine2, city, stateProvinceRegion, postalCode, country } };
}

// DB -> API: a missionary record's `sendingParties` array is reshaped
// back into the `sendingChurch`/`sendingOrg` object pair. Safe to call on
// a record that didn't include `sendingParties` at all (e.g. a query that
// never fetched it) -- both fields just come back null in that case.
function shapeSendingParties(record) {
  if (!record) return record;
  const { sendingParties, ...rest } = record;
  return {
    ...rest,
    sendingChurch: nestSendingParty(sendingParties?.find((sp) => sp.type === "church")),
    sendingOrg: nestSendingParty(sendingParties?.find((sp) => sp.type === "org")),
  };
}

module.exports = { flattenSendingParty, nestSendingParty, shapeSendingParties };
