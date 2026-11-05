// Keys are what's stored on PartnerFile.kind and sent/received over the
// API; labels are for display only (frontend has its own copy -- see
// frontend/src/utils/fileKinds.js). "other" is the one kind that pairs
// with a free-typed `customKind` instead of a fixed label. "newsletter"
// always sorts first -- it's the overwhelming majority of what actually
// arrives from a partner.
const FILE_KINDS = ["newsletter", "survey_response", "signed_policy", "email", "office_document", "other"];

module.exports = { FILE_KINDS };
