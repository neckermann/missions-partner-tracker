// Shared by the three public Trips route files (#271 Finding: split out
// of the former single publicTrips.js, same reasoning as the admin-side
// trips.js split) -- publicTrips.js (discovery), publicTripApplications.js,
// and publicTripParticipants.js all need the church's own public-trip
// settings and the same restricted-partner field-label masking, so those
// two pieces live here once instead of three separate copies.
const prisma = require("../prismaClient");
const { toInitials } = require("./maskData");

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
      collectDateOfBirth: true,
      requireDateOfBirth: true,
      allowPublicSupportRaisingLinks: true,
      allowPrivateApplicationLinks: true,
      tripApplicationTemplate: true,
    },
  });
}

// A restricted partner's label, masked the same conceptual way
// toPublicPartner() masks one -- not that function directly, since it
// requires partner.isPublic to be true (many trip partners aren't in
// the public directory at all), which would make it return null for
// most restricted trip partners rather than a masked label.
function partnerFieldLabel(partner) {
  if (!partner) return null;
  if (partner.isRestricted) return toInitials(partner.displayName);
  return partner.fieldDisplayName || partner.displayName;
}

const tripPartnerSelect = {
  partner: { select: { displayName: true, fieldDisplayName: true, isRestricted: true } },
};

module.exports = { getSettings, partnerFieldLabel, tripPartnerSelect };
