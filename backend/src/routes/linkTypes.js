// Keys are what's stored on PartnerLink.type and sent/received over the
// API; labels are for display only (frontend has its own copy -- see
// frontend/src/utils/linkTypes.js). A fixed, curated list rather than a
// freeform type -- most forks won't want to maintain their own set of
// platforms, they'll ask for a new one via an issue/PR, same as any other
// feature request. Adding one later is a one-line change here, not a
// migration, since the column itself is a plain string, not a Prisma enum.
const LINK_TYPES = ["website", "support", "newsletterSignup", "facebook", "twitter", "instagram", "linkedin"];

module.exports = { LINK_TYPES };
