// Channel-neutral notification text, shared by GroupMe and both digest
// audiences -- built once here instead of each channel re-implementing
// its own wording. This is the real, load-bearing masking authority in
// the whole system: groupmeChannel.js, adminDigestContent.js, and
// publicDigestContent.js all build their output by calling buildBlurb()
// on every row before rendering anything from it, never reading a raw
// NotifiableEvent row's fields directly. A "blurb" is one
// NotifiableEvent row turned into everything any channel needs: GroupMe
// wants one ready-to-pack message string per topic; both digest
// audiences want the same content as structured fields so they can
// render real HTML (headings, nested items, an amount styled on its
// own) and group by partner instead of by flat type.
//
// Masking: GroupMe posts and digest emails all leave this app's own
// auth boundary -- a GroupMe group can include non-admin members, and a
// digest email can sit in an inbox that gets forwarded or auto-synced
// somewhere public. That's the same exposure utils/maskData.js's
// toPublicPartner() already guards against for the public website, so a
// restricted partner's notifications get the same treatment here: an
// initialed name and a generic "details withheld" line instead of the
// real name and the specific request/need/newsletter content, and no
// link to the actual file (even though the download routes are
// auth-gated, a restricted partner's notification should never hint at
// specific content to begin with). isRestricted is read fresh from the
// partner at build time, not from the payload's own frozen snapshot --
// the flag can change after a notification was already recorded.
const { toInitials } = require("./maskData");

const RESTRICTED_NOTICE =
  "Specific details are withheld for security -- please pray for this partner's safety and ministry.";

// The 4 "real content" event types -- the ones a restricted partner's
// notification needs manual review for before it's eligible to send at
// all (#187; see notificationEligibility.js's needsReview()).
// newsletterCreated is deliberately excluded: it already fully
// suppresses for a restricted partner (bodyText/groupmeText both come
// back masked-to-nothing below), so there's no real content there to
// ever gate. Exported so notificationEligibility.js's
// isEligibleForChannel and routes/notifications.js share this exact
// list instead of each re-deriving "which types are real content" and
// drifting apart.
const REVIEW_GATED_TYPES = new Set([
  "prayerRequestCreated",
  "prayerRequestAnswered",
  "supportNeedCreated",
  "supportNeedDecided",
]);

// The subset of types eligible for the public digest audience
// specifically -- admin (User) recipients aren't restricted by this set
// at all, they keep every type. See notificationEligibility.js's
// isEligibleForChannel for where this is used.
const PUBLIC_DIGEST_TYPES = new Set(["prayerRequestCreated", "prayerRequestAnswered"]);

// Same reasoning/placement as groupme.js's own appBaseUrl(): resolves to
// "" when neither env var is set, so a link just isn't built rather than
// pointing at nothing.
function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
}

// Same wording/behavior as groupme.js's own sourceLinkLine(), operating on
// the payload's own sourceFileId instead of a live Prisma include (the
// row's payload is a frozen snapshot -- see the schema.prisma comment on
// PendingNotification for why).
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

// Same labels/thresholds as groupme.js's own supportNeedOutcomeLabel()
// (which matches statusFor() in AdminOneTimeNeeds.jsx and needStatus()
// in PartnerFinancialSection.jsx).
function supportNeedOutcomeLabel(payload) {
  if (payload.approvedAmount === 0) return "Declined";
  if (payload.approvedAmount < payload.requestedAmount) return "Partially Funded";
  return "Fully Funded";
}

// Builds one blurb from a NotifiableEvent row. `partner` is the current
// Partner record (just { displayName, isRestricted } is enough) -- pass
// null/undefined when it's unavailable (e.g. the partner was since
// deleted) and masking is simply skipped, same as before this existed.
// Returns null for a type this function doesn't recognize (defensive --
// should never happen since `type` is only ever written by
// notificationRecording.js) rather than throwing and taking down an
// entire pass over one bad row.
//
// row.reviewedAt/row.reviewedText (#187): any row can carry an admin's
// saved edit, which -- once set -- is simply the authoritative body text
// for that row, full stop, overriding whatever would otherwise be
// computed. For a restricted partner's real-content row specifically,
// this is also what "reveals" the real content in place of
// RESTRICTED_NOTICE; for every other row it's just whatever edit the
// admin made. Whether an un-reviewed restricted row is actually allowed
// to *send* yet is a separate question this function has no opinion on
// -- see notificationEligibility.js's needsReview().
function buildBlurb(row, partner) {
  const { type, payload } = row;
  const restricted = !!partner?.isRestricted;
  const partnerName = restricted
    ? toInitials(partner.displayName || payload.partnerName || "A partner")
    : payload.partnerName || "A partner";
  // Masked out for a restricted partner regardless of type -- never a
  // working link to the actual file, even though the download routes
  // are auth-gated (see the file-header comment above).
  const maskedSourceFileId = restricted ? null : payload.sourceFileId || null;
  const maskedSourceLinkUrl = restricted ? null : sourceLinkUrl(payload);
  const maskedSourceLinkLine = restricted ? "" : sourceLinkLine(payload);

  switch (type) {
    case "prayerRequestCreated": {
      const bodyText = row.reviewedAt
        ? row.reviewedText
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
      const bodyText = row.reviewedAt
        ? row.reviewedText
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
      const bodyText = row.reviewedAt
        ? row.reviewedText
        : restricted
          ? RESTRICTED_NOTICE
          : payload.description;
      // One-time needs never reach the public digest -- not in
      // PUBLIC_DIGEST_TYPES above, admin-only on every channel -- so the
      // requested amount is safe to surface here the same way the
      // approved amount already is on the decided case below.
      // Restricted-partner masking still applies to the partner's
      // name/description; the dollar figure itself was never treated as
      // identifying. Guarded against a missing requestedAmount (a real
      // SupportNeed always has one -- the column is non-nullable -- but
      // a test fixture or a future caller that doesn't is safer showing
      // nothing than "$NaN").
      const amount =
        payload.requestedAmount != null ? `$${Number(payload.requestedAmount).toLocaleString()}` : null;
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
      const amount = `$${Number(payload.approvedAmount).toLocaleString()}`;
      const bodyText = row.reviewedAt
        ? row.reviewedText
        : restricted
          ? RESTRICTED_NOTICE
          : `"${payload.description}"`;
      // Documents *why* the decision came out this way -- same
      // admin-only reasoning as the amount above, so no masking beyond
      // what restricted already does to bodyText/partnerName.
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
          ? `🎁 One-time need decided (${label}), from ${partnerName}:\n${bodyText}\n\nApproved: ${amount}${decisionNoteLine}`
          : `🎁 One-time need decided (${label}), from ${partnerName}:\n${bodyText}\n\nApproved: ${amount}${decisionNoteLine}${maskedSourceLinkLine}`,
      };
    }

    case "newsletterCreated": {
      const base = appBaseUrl();
      const link = restricted || !base ? null : `${base}/api/partner-files/${payload.newsletterId}/download`;
      // The newsletter's real title (new) -- masked to null for a
      // restricted partner's newsletter, same as every other
      // identifying field on this row. Often genuinely null in
      // practice too (PartnerFile.title is optional) -- that's fine,
      // not a bug, there's just nothing to show for that row.
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
        // No link, no message -- a newsletter notification with
        // nothing to point at isn't worth sending at all. A restricted
        // partner's newsletter never gets a link in the first place, so
        // it's never worth a GroupMe post either, same reasoning.
        groupmeText: link
          ? `📰 New newsletter from ${partnerName}${title ? `: ${title}` : ""}:\n${link}`
          : null,
      };
    }

    default:
      return null;
  }
}

module.exports = { buildBlurb, appBaseUrl, REVIEW_GATED_TYPES, PUBLIC_DIGEST_TYPES };
