// Urgent-send/approve-now copy shared by every creation form with these controls, so the
// audiences it promises match the channels that are actually on.

export function joinWithAnd(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

// Mirrors the backend's channel gating (dispatchOrchestrator.js sendUrgentDispatch): GroupMe and
// WhatsApp each need their own feature; admins need outboundEmail; public subscribers need BOTH
// outboundEmail and publicPrayerDigest (turning the public digest off must stop their mail). The
// checkbox text and the confirm summary both build on this so they can't drift from the backend.
export function reachableUrgentChannels(enabledFeatures) {
  return {
    groupme: !!enabledFeatures.groupme,
    whatsapp: !!enabledFeatures.whatsapp,
    admins: !!enabledFeatures.outboundEmail,
    publicSubscribers: !!(enabledFeatures.outboundEmail && enabledFeatures.publicPrayerDigest),
  };
}

// The chat channels (GroupMe/WhatsApp) that share the content-type mutes.
export function chatChannelNames(reach) {
  return [reach.groupme && "GroupMe", reach.whatsapp && "WhatsApp"].filter(Boolean);
}

// The "Mark as urgent" checkbox helper text: settings-only, no recipient counts.
export function urgentSendDescription(enabledFeatures) {
  const reach = reachableUrgentChannels(enabledFeatures);
  const audiences = [];
  if (reach.groupme) audiences.push("GroupMe");
  if (reach.whatsapp) audiences.push("WhatsApp");
  if (reach.admins) audiences.push("admins");
  if (reach.publicSubscribers) audiences.push("public subscribers");

  const chatClause =
    chatChannelNames(reach).length > 0
      ? `, and still respects a muted ${chatChannelNames(reach).join("/")} content type -- urgent only skips the wait, never those safety rules.`
      : " -- urgent only skips the wait, never that safety rule.";
  return (
    `Sends immediately to ${joinWithAnd(audiences)}, bypassing everyone's own schedule -- you'll be asked to ` +
    `confirm the real recipient counts before it actually sends. Still waits on review if this partner ` +
    `is restricted${chatClause}`
  );
}

// The confirm dialog's recipient line: same gating, with real counts for admins/public once known
// (fetchUrgentRecipientCount returns 0 for an audience whose feature is off).
export function urgentRecipientSummary(enabledFeatures, { adminCount, publicCount }) {
  const reach = reachableUrgentChannels(enabledFeatures);
  const parts = [];
  if (reach.groupme) parts.push("GroupMe");
  if (reach.whatsapp) parts.push("WhatsApp");
  if (reach.admins) parts.push(pluralize(adminCount, "admin"));
  if (reach.publicSubscribers) parts.push(pluralize(publicCount, "public subscriber"));
  return joinWithAnd(parts);
}
