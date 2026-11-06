// Urgent-send/approve-now copy, shared by every creation form that has
// these controls (PrayerRequestSection, PartnerFinancialSection,
// AdminPrayerRequests, AdminOneTimeNeeds) -- same reasoning as format.js's
// own header comment: this was copy-pasted text naming all three channels
// unconditionally, which went stale the moment a church running with
// GroupMe or the public digest off read a promise about audiences urgent
// send was never actually going to reach. One set of functions, called
// identically everywhere, instead of four copies that can drift.

export function joinWithAnd(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

// Mirrors the backend's own channel-level gating
// (notificationOrchestrator.js's sendUrgentBroadcast): GroupMe needs its
// own feature; admins need outboundEmail; public subscribers need BOTH
// outboundEmail and publicPrayerDigest, since turning the public digest
// off must stop their mail even while the admin digest keeps sending.
// The one place this is decided -- both the checkbox's own description
// and the confirm dialog's recipient summary build off this, so they
// can't drift from each other or from the backend's real behavior.
export function reachableUrgentChannels(enabledFeatures) {
  return {
    groupme: !!enabledFeatures.groupme,
    admins: !!enabledFeatures.outboundEmail,
    publicSubscribers: !!(enabledFeatures.outboundEmail && enabledFeatures.publicPrayerDigest),
  };
}

// The "Mark as urgent" checkbox's own helper text -- settings-only, no
// recipient counts (those aren't known until the confirm dialog fetches
// them).
export function urgentSendDescription(enabledFeatures) {
  const reach = reachableUrgentChannels(enabledFeatures);
  const audiences = [];
  if (reach.groupme) audiences.push("GroupMe");
  if (reach.admins) audiences.push("admins");
  if (reach.publicSubscribers) audiences.push("public subscribers");

  const groupmeClause = reach.groupme
    ? ", and still respects a muted GroupMe content type -- urgent only skips the wait, never those safety rules."
    : " -- urgent only skips the wait, never that safety rule.";
  return (
    `Sends immediately to ${joinWithAnd(audiences)}, bypassing everyone's own schedule -- you'll be asked to ` +
    `confirm the real recipient counts before it actually sends. Still waits on review if this partner ` +
    `is restricted${groupmeClause}`
  );
}

// The confirm dialog's own recipient line -- same reachable-channel
// gating as above, with real counts substituted in for admins/public
// subscribers once known (fetchUrgentRecipientCount already returns 0
// for an audience whose feature is off, so this only needs to decide
// whether to mention that audience at all, not re-derive the count).
export function urgentRecipientSummary(enabledFeatures, { adminCount, publicCount }) {
  const reach = reachableUrgentChannels(enabledFeatures);
  const parts = [];
  if (reach.groupme) parts.push("GroupMe");
  if (reach.admins) parts.push(pluralize(adminCount, "admin"));
  if (reach.publicSubscribers) parts.push(pluralize(publicCount, "public subscriber"));
  return joinWithAnd(parts);
}
