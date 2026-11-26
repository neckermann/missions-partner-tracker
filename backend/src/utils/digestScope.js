// Which partners a person's email digest covers, and how that is resolved at send time.
//
//   owned     the partners this person looks after: their care team seats and, on the missions team, every partner
//             with no team of its own (utils/ownership.js). The default for anyone who looks after partners.
//   all       every partner this user's role can see.
//   followed  only the partners they picked (UserFollowedPartner).
//
// A guest is always "owned": a stored "all" or "followed" never widens a guest's digest.

const { partnersOwnedBy } = require("./ownership");

const DIGEST_SCOPES = ["owned", "all", "followed"];

function effectiveScope(user) {
  if (user.role === "guest") return "owned";
  return DIGEST_SCOPES.includes(user.digestScope) ? user.digestScope : "all";
}

// { allPartners, partnerIds } for the delivery loop. `user` needs id, role, digestScope and, for "followed",
// followedPartners: [{ partnerId }].
async function resolveDigestScope(user) {
  const scope = effectiveScope(user);
  if (scope === "all") return { allPartners: true, partnerIds: [] };
  if (scope === "followed") {
    return { allPartners: false, partnerIds: (user.followedPartners || []).map((f) => f.partnerId) };
  }
  const owned = await partnersOwnedBy(user.id);
  return { allPartners: false, partnerIds: [...new Set(owned.map((o) => o.partnerId))] };
}

// Whether this person's digest would cover `partnerId`, for the urgent-send recipient count.
async function digestCovers(user, partnerId) {
  const scope = await resolveDigestScope(user);
  return scope.allPartners || scope.partnerIds.includes(partnerId);
}

module.exports = { DIGEST_SCOPES, effectiveScope, resolveDigestScope, digestCovers };
