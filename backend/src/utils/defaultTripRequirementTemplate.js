// The default ChurchSettings.tripRequirementTemplate for every new fork, used by
// first-run setup (routes/auth.js POST /setup) and the dev-demo seed
// (prisma/seed.js) alike. Both entries auto-apply to every new trip; minorsOnly on
// the Minor Travel Release makes it inert on a trip with no minors, so it is
// present by default rather than left in the opt-in library for an admin to remember.
const LIABILITY_RELEASE_TEXT = `Liability Release and Code of Conduct — Short-Term Mission Trip

I understand that participation in this short-term mission trip involves inherent risks, including but not limited to travel-related injury, illness, and property loss, and that these risks cannot be entirely eliminated no matter what care is taken. I voluntarily assume all such risks and release the church, its staff, and its partner organizations from liability for any injury, loss, or damage arising from my participation, except where caused by gross negligence.

I agree to conduct myself in a manner consistent with the team's values throughout the trip. Specifically, I agree not to use alcohol or tobacco, not to engage in public displays of affection with another team member (whether married or single), not to use profane or vulgar language, to dress modestly and appropriately in a way that respects the customs and expectations of the culture we are serving in, and to avoid a critical or complaining attitude toward team leadership, fellow team members, or the conditions of the trip. I will follow the reasonable direction of the team leader at all times, and will represent the team and the church respectfully in my interactions with our hosts and host community.

I confirm that I have disclosed any medical conditions, allergies, or medications the team leader should be aware of, and that I am responsible for bringing an adequate supply of any personal medication for the duration of the trip.

I understand that the team leader may send me home at my own expense if my conduct endangers myself, another team member, or the trip's relationship with our hosts.

This agreement is governed by the laws of the state in which the church is located.

This is a starting template, not legal advice -- have it reviewed by your own church's legal counsel before relying on it.`;

// Written in the parent/guardian's voice, parallel to LIABILITY_RELEASE_TEXT
// (risk acknowledgment, code-of-conduct consent, medical-treatment authorization,
// media release, governing law). A starting point, not vetted legal advice; the
// trailing note says so.
const MINOR_RELEASE_TEXT = `Minor Travel Release, Consent, and Medical Authorization — Short-Term Mission Trip

I am the parent or legal guardian of the minor named on this form, and I give my permission for them to participate in this short-term mission trip.

I understand that participation involves inherent risks, including but not limited to travel-related injury, illness, and property loss, and that these risks cannot be entirely eliminated no matter what care is taken. I voluntarily assume these risks on my child's behalf and release the church, its staff, and its partner organizations from liability for any injury, loss, or damage arising from their participation, except where caused by gross negligence.

I authorize the team leader and any accompanying adult leaders to consent to emergency medical treatment for my child if I cannot be reached in a timely manner, and I confirm that I have disclosed any medical conditions, allergies, or medications the team leader should be aware of. I am responsible for ensuring my child brings an adequate supply of any personal medication for the duration of the trip.

I agree, on my child's behalf, that they will follow the same code of conduct every team member agrees to: no alcohol or tobacco, modest and culturally appropriate dress, respectful behavior toward team leadership, fellow team members, and our hosts, and the reasonable direction of the team leader at all times. I understand the team leader may send my child home at my own expense if their conduct endangers themselves, another team member, or the trip's relationship with our hosts.

I consent to photos and video of my child taken during the trip being used in the church's own newsletters, website, and social media.

This agreement is governed by the laws of the state in which the church is located.

This is a starting template, not legal advice -- have it reviewed by your own church's legal counsel before relying on it.`;

const DEFAULT_TRIP_REQUIREMENT_TEMPLATE = [
  {
    id: "reqtmpl1",
    label: "Signed Liability Release and Code of Conduct",
    kind: "esignature",
    bodyText: LIABILITY_RELEASE_TEXT,
  },
  {
    id: "reqtmpl2",
    label: "Minor Travel Release & Consent Form",
    kind: "esignature",
    bodyText: MINOR_RELEASE_TEXT,
    minorsOnly: true,
  },
];

module.exports = { LIABILITY_RELEASE_TEXT, MINOR_RELEASE_TEXT, DEFAULT_TRIP_REQUIREMENT_TEMPLATE };
