// Values stored on PartnerLink.type (labels live in frontend/src/utils/linkTypes.js).
// A fixed list; adding one is a one-line change here, not a migration, since
// the column is a plain string, not a Prisma enum.
const LINK_TYPES = ["website", "support", "newsletterSignup", "facebook", "twitter", "instagram", "linkedin"];

module.exports = { LINK_TYPES };
