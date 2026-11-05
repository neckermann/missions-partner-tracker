// Channel-neutral notification text, shared by the GroupMe batch sender
// and the email digest (see #129) -- built once here instead of each
// channel re-implementing its own wording. A "blurb" is one
// PendingNotification row turned into everything either channel needs:
// GroupMe wants one ready-to-pack message string per topic; the email
// digest wants the same content as structured fields so it can render
// real HTML (headings, nested items, an amount styled on its own) and
// group by partner instead of by flat type.
//
// Message wording below is unchanged from utils/groupme.js's own
// pre-#129 notify* functions -- same emoji, same phrasing -- just
// extracted so it isn't duplicated between the two channels.
//
// Masking: GroupMe posts and digest emails both leave this app's own
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
// the flag can change after a notification was already queued.
const { toInitials } = require("./maskData");

const RESTRICTED_NOTICE =
  "Specific details are withheld for security -- please pray for this partner's safety and ministry.";

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

// Builds one blurb from a PendingNotification row. `partner` is the
// current Partner record (just { displayName, isRestricted } is enough)
// -- pass null/undefined when it's unavailable (e.g. the partner was
// since deleted) and masking is simply skipped, same as before this
// existed. Returns null for a type this function doesn't recognize
// (defensive -- should never happen since `type` is only ever written by
// notifications.js below) rather than throwing and taking down an entire
// flush over one bad row.
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
    case "prayerRequestCreated":
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmePrayerTopicId",
        emoji: "🙏",
        summary: "New prayer request",
        bodyText: restricted ? RESTRICTED_NOTICE : payload.requestText,
        amount: null,
        sourceFileId: maskedSourceFileId,
        sourceLinkUrl: maskedSourceLinkUrl,
        groupmeText: restricted
          ? `🙏 New prayer request from ${partnerName}:\n${RESTRICTED_NOTICE}`
          : `🙏 New prayer request from ${partnerName}:\n${payload.requestText}${maskedSourceLinkLine}`,
      };

    case "prayerRequestAnswered": {
      const note = payload.answeredNote?.trim() || "(no note added)";
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmePrayerTopicId",
        emoji: "🙏",
        summary: "Prayer request answered",
        bodyText: restricted ? RESTRICTED_NOTICE : `"${payload.requestText}"\n\n${note}`,
        amount: null,
        sourceFileId: maskedSourceFileId,
        sourceLinkUrl: maskedSourceLinkUrl,
        groupmeText: restricted
          ? `🙏 Prayer request answered, from ${partnerName}:\n${RESTRICTED_NOTICE}`
          : `🙏 Prayer request answered, from ${partnerName}:\n` +
            `"${payload.requestText}"\n\n` +
            `${note}${maskedSourceLinkLine}`,
      };
    }

    case "supportNeedCreated":
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmeOneTimeNeedTopicId",
        emoji: "🎁",
        summary: "New one-time need",
        bodyText: restricted ? RESTRICTED_NOTICE : payload.description,
        amount: null,
        sourceFileId: maskedSourceFileId,
        sourceLinkUrl: maskedSourceLinkUrl,
        groupmeText: restricted
          ? `🎁 New one-time need from ${partnerName}:\n${RESTRICTED_NOTICE}`
          : `🎁 New one-time need from ${partnerName}:\n` +
            `Be praying about this opportunity — we'll talk about it more at our next meeting.\n\n` +
            `${payload.description}${maskedSourceLinkLine}`,
      };

    case "supportNeedDecided": {
      const label = supportNeedOutcomeLabel(payload);
      const amount = `$${Number(payload.approvedAmount).toLocaleString()}`;
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmeOneTimeNeedTopicId",
        emoji: "🎁",
        summary: `One-time need decided (${label})`,
        bodyText: restricted ? RESTRICTED_NOTICE : `"${payload.description}"`,
        amount,
        sourceFileId: maskedSourceFileId,
        sourceLinkUrl: maskedSourceLinkUrl,
        groupmeText: restricted
          ? `🎁 One-time need decided (${label}), from ${partnerName}:\n${RESTRICTED_NOTICE}\n\nApproved: ${amount}`
          : `🎁 One-time need decided (${label}), from ${partnerName}:\n` +
            `"${payload.description}"\n\n` +
            `Approved: ${amount}${maskedSourceLinkLine}`,
      };
    }

    case "newsletterCreated": {
      const base = appBaseUrl();
      const link = restricted || !base ? null : `${base}/api/partner-files/${payload.newsletterId}/download`;
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
        newsletterId: restricted ? null : payload.newsletterId,
        sourceFileId: null,
        sourceLinkUrl: link,
        // Same as groupme.js's own notifyNewsletterCreated: no link, no
        // message -- a newsletter notification with nothing to point at
        // isn't worth sending at all. A restricted partner's newsletter
        // never gets a link in the first place, so it's never worth a
        // GroupMe post either, same reasoning.
        groupmeText: link ? `📰 New newsletter from ${partnerName}:\n${link}` : null,
      };
    }

    default:
      return null;
  }
}

module.exports = { buildBlurb, appBaseUrl };
