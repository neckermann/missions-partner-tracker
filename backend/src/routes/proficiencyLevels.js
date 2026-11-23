// The ILR (Interagency Language Roundtable) scale -- the standard used in
// missions-agency field-language assessment. Keys are what's stored on
// PartnerLanguage.proficiency; frontend has its own copy with the full
// descriptive labels (see frontend/src/utils/proficiencyLevels.js). A
// plain string, not a Prisma enum, same reasoning as LINK_TYPES.
const PROFICIENCY_LEVELS = ["0", "0+", "1", "1+", "2", "2+", "3", "3+", "4", "4+", "5"];

module.exports = { PROFICIENCY_LEVELS };
