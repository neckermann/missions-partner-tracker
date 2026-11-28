// Channel-neutral dispatch text shared by GroupMe, WhatsApp and both email
// audiences. This is the load-bearing masking authority: those four channel
// modules call buildBlurb() on every row and never read raw DispatchRecord
// fields. A blurb gives GroupMe/WhatsApp a ready message string and the emails
// structured fields.
//
// Masking: these channels leave the auth boundary (non-admins in a group, forwarded
// emails), the same exposure toPublicPartner() guards on the public site. So a
// restricted partner gets a masked name (maskedDisplayName()), a generic
// "details withheld" line and no file link. isRestricted is read fresh from the
// partner, not the payload snapshot, because the flag can change after recording.
const { maskedDisplayName, MASK_NAME_SELECT } = require("./maskData");

// The partner fields every channel loads before calling buildBlurb(): what eligibility needs, and the adults, so a
// restricted household is named by its adults' initials (maskedDisplayName). One select for all channels, so none
// can forget the adults.
const DISPATCH_PARTNER_SELECT = {
  id: true,
  displayName: true,
  fieldDisplayName: true,
  isRestricted: true,
  isPublic: true,
  ...MASK_NAME_SELECT,
};
const { formatMoney } = require("./money");
const { keyDateWhat, when: whenKeyDate } = require("./keyDateText");

const RESTRICTED_NOTICE =
  "Specific details are withheld for security -- please pray for this partner's safety and ministry.";

// The 4 "real content" event types: a restricted partner's dispatch of these
// needs manual review before it can send (see dispatchEligibility.js
// needsReview()). newsletterCreated is excluded because it already fully
// suppresses for a restricted partner. Exported so dispatchEligibility.js and
// routes/dispatches.js share one list.
const REVIEW_GATED_TYPES = new Set([
  "prayerRequestCreated",
  "prayerRequestAnswered",
  "supportNeedCreated",
  "supportNeedDecided",
]);

// The chat-only partner care posts (utils/careChatDispatch.js). They go to GroupMe/WhatsApp under their own switches
// and one shared topic/group; the email digest has its own key-date section and the bell has the rest, so they
// never ride in an email dispatch.
const CARE_DISPATCH_TYPES = new Set(["keyDateComing", "quietPartner", "updateToPassOn"]);

// A prayer request filed as "Everyday" (category "situational": health, travel, family, paperwork) is staff
// only. It is never recorded for sending (dispatchRecording.js), and this is the second line: a record that
// carries the category, or that outlived an edit to it, is refused by every channel (dispatchEligibility.js),
// is never built into text (buildBlurb returns null, so no chat post, digest or review queue shows it) and is
// cleared at once (dispatchOrchestrator.js).
function isEverydayPrayer(row) {
  return row?.payload?.category === "situational";
}

// Types eligible for the public email audience; admin (User) recipients keep every type.
const PUBLIC_EMAIL_DISPATCH_TYPES = new Set(["prayerRequestCreated", "prayerRequestAnswered"]);

// Like groupmeChannel.js's appBaseUrl(): "" when no env var is set, so no link is built.
function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
}

// Like groupmeChannel.js's sourceLinkLine(), but from the payload's sourceFileId
// (the payload is a frozen snapshot; see DispatchRecord in schema.prisma).
function sourceLinkLine(payload) {
  const base = appBaseUrl();
  if (!base || !payload.sourceFileId) return "";
  return `\n\nFrom: ${base}/api/partner-files/${payload.sourceFileId}/download`;
}

function sourceLinkUrl(payload) {
  const base = appBaseUrl();
  if (!base || !payload.sourceFileId) return null;
  return `${base}/api/partner-files/${payload.sourceFileId}/download`;
}

// Same labels/thresholds as groupmeChannel.js supportNeedOutcomeLabel() (and
// statusFor() in AdminOneTimeNeeds.jsx, needStatus() in PartnerFinancialSection.jsx).
function supportNeedOutcomeLabel(payload) {
  if (payload.approvedAmount === 0) return "Declined";
  if (payload.approvedAmount < payload.requestedAmount) return "Partially Funded";
  return "Fully Funded";
}

// Builds one blurb from a DispatchRecord row. `partner` is the current Partner
// ({ displayName, isRestricted } suffices); null/undefined (e.g. deleted) skips
// masking. Returns null for an unrecognized type (only dispatchRecording.js
// writes `type`) rather than failing a whole pass over one bad row.
//
// Once row.dispatchReviewedAt/dispatchReviewedText are set, the admin's saved
// edit is the authoritative body text (for a restricted row it also replaces
// RESTRICTED_NOTICE). Whether an un-reviewed restricted row may *send* is
// dispatchEligibility.js's needsReview(), not decided here.
function buildBlurb(row, partner, settings) {
  if (isEverydayPrayer(row)) return null;
  const { type, payload } = row;
  const restricted = !!partner?.isRestricted;
  const partnerName = restricted
    ? maskedDisplayName(
        { ...partner, displayName: partner.displayName || payload.partnerName || "A partner" },
        settings
      )
    : payload.partnerName || "A partner";
  // Masked out for a restricted partner regardless of type, even though downloads are auth-gated.
  const maskedSourceFileId = restricted ? null : payload.sourceFileId || null;
  const maskedSourceLinkUrl = restricted ? null : sourceLinkUrl(payload);
  const maskedSourceLinkLine = restricted ? "" : sourceLinkLine(payload);

  switch (type) {
    case "prayerRequestCreated": {
      const bodyText = row.dispatchReviewedAt
        ? row.dispatchReviewedText
        : restricted
          ? RESTRICTED_NOTICE
          : payload.requestText;
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmePrayerTopicId",
        emoji: "🙏",
        summary: "New prayer request",
        bodyText,
        amount: null,
        sourceFileId: maskedSourceFileId,
        sourceLinkUrl: maskedSourceLinkUrl,
        groupmeText: restricted
          ? `🙏 New prayer request from ${partnerName}:\n${bodyText}`
          : `🙏 New prayer request from ${partnerName}:\n${bodyText}${maskedSourceLinkLine}`,
      };
    }

    case "prayerRequestAnswered": {
      const note = payload.answeredNote?.trim() || "(no note added)";
      const bodyText = row.dispatchReviewedAt
        ? row.dispatchReviewedText
        : restricted
          ? RESTRICTED_NOTICE
          : `"${payload.requestText}"\n\n${note}`;
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmePrayerTopicId",
        emoji: "🙏",
        summary: "Prayer request answered",
        bodyText,
        amount: null,
        sourceFileId: maskedSourceFileId,
        sourceLinkUrl: maskedSourceLinkUrl,
        groupmeText: restricted
          ? `🙏 Prayer request answered, from ${partnerName}:\n${bodyText}`
          : `🙏 Prayer request answered, from ${partnerName}:\n${bodyText}${maskedSourceLinkLine}`,
      };
    }

    case "supportNeedCreated": {
      const bodyText = row.dispatchReviewedAt
        ? row.dispatchReviewedText
        : restricted
          ? RESTRICTED_NOTICE
          : payload.description;
      // One-time needs never reach the public digest (admin-only on every channel),
      // so the requested amount is safe to show like the approved amount below.
      // Restricted masking still applies to name/description. Guards a missing
      // requestedAmount (non-nullable in the schema, but fixtures may omit it) to avoid "$NaN".
      // A need can be saved with no amount (stored as 0): say nothing about money rather than "$0".
      const amount = payload.requestedAmount
        ? formatMoney(payload.requestedAmount, settings?.currency)
        : null;
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmeOneTimeNeedTopicId",
        emoji: "🎁",
        summary: "New one-time need",
        bodyText,
        amount,
        amountLabel: "Requested",
        decisionNote: null,
        sourceFileId: maskedSourceFileId,
        sourceLinkUrl: maskedSourceLinkUrl,
        groupmeText: restricted
          ? `🎁 New one-time need from ${partnerName}:\n${bodyText}${amount ? `\n\nRequested: ${amount}` : ""}`
          : `🎁 New one-time need from ${partnerName}:\n` +
            `Be praying about this opportunity — we'll talk about it more at our next meeting.\n\n` +
            `${bodyText}${amount ? `\n\nRequested: ${amount}` : ""}${maskedSourceLinkLine}`,
      };
    }

    case "supportNeedDecided": {
      const label = supportNeedOutcomeLabel(payload);
      // A decline (approved $0) says "Declined" and no amount, rather than "Approved: $0".
      const amount = payload.approvedAmount ? formatMoney(payload.approvedAmount, settings?.currency) : null;
      const approvedLine = amount ? `\n\nApproved: ${amount}` : "";
      const bodyText = row.dispatchReviewedAt
        ? row.dispatchReviewedText
        : restricted
          ? RESTRICTED_NOTICE
          : `"${payload.description}"`;
      // Why the decision came out this way; admin-only like the amount above.
      const decisionNote = payload.decisionNote?.trim() || null;
      const decisionNoteLine = decisionNote ? `\n\n${decisionNote}` : "";
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmeOneTimeNeedTopicId",
        emoji: "🎁",
        summary: `One-time need decided (${label})`,
        bodyText,
        amount,
        amountLabel: "Approved",
        decisionNote,
        sourceFileId: maskedSourceFileId,
        sourceLinkUrl: maskedSourceLinkUrl,
        groupmeText: restricted
          ? `🎁 One-time need decided (${label}), from ${partnerName}:\n${bodyText}${approvedLine}${decisionNoteLine}`
          : `🎁 One-time need decided (${label}), from ${partnerName}:\n${bodyText}${approvedLine}${decisionNoteLine}${maskedSourceLinkLine}`,
      };
    }

    case "newsletterCreated": {
      const base = appBaseUrl();
      const link = restricted || !base ? null : `${base}/api/partner-files/${payload.newsletterId}/download`;
      // The newsletter's real title, null for a restricted partner (like every
      // identifying field). Also null when PartnerFile.title is unset; that is fine.
      const title = restricted ? null : payload.title || null;
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmeNewsletterTopicId",
        emoji: "📰",
        summary: "New newsletter",
        bodyText: restricted ? RESTRICTED_NOTICE : null,
        amount: null,
        title,
        newsletterId: restricted ? null : payload.newsletterId,
        sourceFileId: null,
        sourceLinkUrl: link,
        // No link, no message: nothing to point at isn't worth sending (a
        // restricted partner's newsletter never gets a link).
        groupmeText: link
          ? `📰 New newsletter from ${partnerName}${title ? `: ${title}` : ""}:\n${link}`
          : null,
      };
    }

    case "keyDateComing": {
      const item = { ...payload, daysUntil: payload.daysUntil };
      const what = keyDateWhat(item, restricted);
      const when = whenKeyDate(item);
      const instructions =
        payload.specialInstructions && !restricted
          ? " Special communication instructions apply: see their page."
          : "";
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmeCareTopicId",
        emoji: "🎂",
        summary: "Key date coming up",
        bodyText: `${what}: ${when}.${instructions}`,
        amount: null,
        sourceFileId: null,
        sourceLinkUrl: null,
        groupmeText: `🎂 Coming up for ${partnerName}: ${what}, ${when}. A card or a call would mean a lot.${instructions}`,
      };
    }

    case "quietPartner": {
      const never = !payload.lastContactDate;
      const days = payload.daysQuiet;
      const bodyText = never
        ? "Nobody has logged contact with them yet."
        : `It has been ${days} days since we last heard from them.`;
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmeCareTopicId",
        emoji: "🤝",
        summary: "Time to reach out",
        bodyText,
        amount: null,
        sourceFileId: null,
        sourceLinkUrl: null,
        groupmeText: `🤝 Time to reach out to ${partnerName}. ${bodyText} Could someone get in touch?`,
      };
    }

    case "updateToPassOn": {
      // The need or prayer text is withheld for a restricted partner, like the prayer and need posts themselves.
      const label = restricted || !payload.label ? "" : ` (“${payload.label}”)`;
      const bodyText =
        payload.kind === "need"
          ? `The church's decision on their need${label} is ready to pass on.`
          : `Their prayer request${label} was answered, and they would love to hear it.`;
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmeCareTopicId",
        emoji: "📣",
        summary: "News to pass on",
        bodyText,
        amount: null,
        sourceFileId: null,
        sourceLinkUrl: null,
        groupmeText: `📣 News to pass on to ${partnerName}: ${bodyText} Could someone let them know?`,
      };
    }

    default:
      return null;
  }
}

module.exports = {
  DISPATCH_PARTNER_SELECT,
  buildBlurb,
  isEverydayPrayer,
  appBaseUrl,
  REVIEW_GATED_TYPES,
  PUBLIC_EMAIL_DISPATCH_TYPES,
  CARE_DISPATCH_TYPES,
};
