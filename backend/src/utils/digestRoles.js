// Who may receive the church-wide digests and urgent dispatches. A guest's reach is limited to specific trips or
// partners and these emails carry prayer requests, needs and amounts, so a guest is never a recipient of the
// *church-wide* digest. DIGEST_ROLES is that full-role list (it also backs the staff-facing subscriber counts).
const DIGEST_ROLES = ["admin", "editor", "viewer"];

// Who can actually be sent a digest: the full roles, plus a care team Guest whose digest is limited to the
// partners they hold a seat on. A guest's scope is always "owned" whatever is stored (utils/digestScope.js), so
// they never receive another partner's content.
const DIGEST_RECIPIENT_ROLES = [...DIGEST_ROLES, "guest"];

module.exports = { DIGEST_ROLES, DIGEST_RECIPIENT_ROLES };
