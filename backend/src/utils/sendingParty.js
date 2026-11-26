// Shared by routes/partners.js and routes/publicPartners.js: reshapes the
// Partner.sendingParties relation into the sendingChurch/sendingOrg pair every
// caller expects (see SendingParty in schema.prisma). Missionary-only: an
// organization has no sending party, so both come back null.

// API -> DB: unpacks the nested `mailingAddress` into SendingParty's flat columns.
function flattenSendingParty(sp, type) {
  const { mailingAddress, ...rest } = sp;
  return { type, ...rest, ...(mailingAddress || {}) };
}

// DB -> API: repacks the flat address columns into the nested `mailingAddress` shape.
function nestSendingParty(sp) {
  if (!sp) return null;
  const {
    id,
    partnerId,
    type,
    addressLine1,
    addressLine2,
    city,
    stateProvinceRegion,
    postalCode,
    country,
    ...rest
  } = sp;
  return {
    ...rest,
    mailingAddress: { addressLine1, addressLine2, city, stateProvinceRegion, postalCode, country },
  };
}

// DB -> API: reshapes `sendingParties` into the sendingChurch/sendingOrg pair; both
// come back null if the record didn't include `sendingParties`.
function shapeSendingParties(record) {
  if (!record) return record;
  const { sendingParties, ...rest } = record;
  return {
    ...rest,
    sendingChurch: nestSendingParty(sendingParties?.find((sp) => sp.type === "church")),
    sendingOrg: nestSendingParty(sendingParties?.find((sp) => sp.type === "org")),
  };
}

module.exports = { flattenSendingParty, shapeSendingParties };
