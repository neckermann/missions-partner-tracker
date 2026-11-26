// Whether and where a person may be emailed on a partner's behalf (survey links, greetings): the
// partner's contact level and restricted status decide, then the address on file.

// Who the app may email a link to: never a restricted partner, nobody we are told not to
// contact directly, and under "caution" only if email is one of the ticked ways. Staff can still
// record answers for them.
function emailBlockReason(partner) {
  if (partner.isRestricted) return "restricted";
  if (partner.contactLevel === "no_direct") return "not safe to contact directly";
  const channels = partner.contactChannels || [];
  if (partner.contactLevel === "caution" && channels.length > 0 && !channels.includes("email")) {
    return "not to be emailed";
  }
  return null;
}

// The address a link goes to: an organization's named contact, else the primary adult, else the
// first adult with an email.
function surveyEmailFor(partner, adults = []) {
  const ok = (e) => (e && /\S+@\S+\.\S+/.test(e) ? e.trim() : null);
  if (partner.kind === "organization") return ok(partner.contactEmail);
  const primary = adults.find((a) => a.isPrimaryContact && ok(a.email));
  const any = adults.find((a) => ok(a.email));
  return ok((primary || any)?.email);
}

module.exports = { emailBlockReason, surveyEmailFor };
