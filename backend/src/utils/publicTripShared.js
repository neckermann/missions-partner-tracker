// Shared by the three public Trips route files (publicTrips.js, publicTripApplications.js,
// publicTripParticipants.js): the church's public-trip settings and the
// restricted-partner label masking.
const prisma = require("../prismaClient");
const { maskedDisplayName, MASK_NAME_SELECT } = require("./maskData");

async function getSettings() {
  return prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      enabledFeatures: true,
      onlineGivingUrl: true,
      onlineGivingInstructions: true,
      collectDonorContactInfo: true,
      collectApplicantAddress: true,
      collectEmergencyContact: true,
      allowPublicSupportRaisingLinks: true,
      allowPrivateApplicationLinks: true,
      restrictedPartnerInitialsEnabled: true,
    },
  });
}

// A restricted partner's label, masked like toPublicPartner() but not via it: that
// requires partner.isPublic, and many trip partners aren't public, so it would return null.
function partnerFieldLabel(partner, settings) {
  if (!partner) return null;
  if (partner.isRestricted) return maskedDisplayName(partner, settings);
  return partner.fieldDisplayName || partner.displayName;
}

const tripPartnerSelect = {
  partner: {
    select: {
      kind: true,
      displayName: true,
      fieldDisplayName: true,
      isRestricted: true,
      ...MASK_NAME_SELECT,
    },
  },
};

module.exports = { getSettings, partnerFieldLabel, tripPartnerSelect };
