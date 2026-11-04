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

// Same reasoning/placement as groupme.js's own appBaseUrl(): resolves to
// "" when neither env var is set, so a link just isn't built rather than
// pointing at nothing.
function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
}

// Same wording/behavior as groupme.js's own sourceLinkLine(), operating
// on the payload's own sourceNewsletterId/sourceDocumentId instead of a
// live Prisma include (the row's payload is a frozen snapshot -- see the
// schema.prisma comment on PendingNotification for why).
function sourceLinkLine(payload) {
  const base = appBaseUrl();
  if (!base) return "";
  if (payload.sourceNewsletterId)
    return `\n\nFrom: ${base}/api/newsletters/${payload.sourceNewsletterId}/download`;
  if (payload.sourceDocumentId) return `\n\nFrom: ${base}/api/documents/${payload.sourceDocumentId}/download`;
  return "";
}

function sourceLinkUrl(payload) {
  const base = appBaseUrl();
  if (!base) return null;
  if (payload.sourceNewsletterId) return `${base}/api/newsletters/${payload.sourceNewsletterId}/download`;
  if (payload.sourceDocumentId) return `${base}/api/documents/${payload.sourceDocumentId}/download`;
  return null;
}

// Same labels/thresholds as groupme.js's own supportNeedOutcomeLabel()
// (which matches statusFor() in AdminOneTimeNeeds.jsx and needStatus()
// in PartnerFinancialSection.jsx).
function supportNeedOutcomeLabel(payload) {
  if (payload.approvedAmount === 0) return "Declined";
  if (payload.approvedAmount < payload.requestedAmount) return "Partially Funded";
  return "Fully Funded";
}

// Builds one blurb from a PendingNotification row. Returns null for a
// type this function doesn't recognize (defensive -- should never
// happen since `type` is only ever written by notifications.js below)
// rather than throwing and taking down an entire flush over one bad row.
function buildBlurb(row) {
  const { type, payload } = row;
  const partnerName = payload.partnerName || "A partner";

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
        bodyText: payload.requestText,
        amount: null,
        sourceNewsletterId: payload.sourceNewsletterId || null,
        sourceDocumentId: payload.sourceDocumentId || null,
        sourceLinkUrl: sourceLinkUrl(payload),
        groupmeText: `🙏 New prayer request from ${partnerName}:\n${payload.requestText}${sourceLinkLine(payload)}`,
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
        bodyText: `"${payload.requestText}"\n\n${note}`,
        amount: null,
        sourceNewsletterId: payload.sourceNewsletterId || null,
        sourceDocumentId: payload.sourceDocumentId || null,
        sourceLinkUrl: sourceLinkUrl(payload),
        groupmeText:
          `🙏 Prayer request answered, from ${partnerName}:\n` +
          `"${payload.requestText}"\n\n` +
          `${note}${sourceLinkLine(payload)}`,
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
        bodyText: payload.description,
        amount: null,
        sourceNewsletterId: payload.sourceNewsletterId || null,
        sourceDocumentId: payload.sourceDocumentId || null,
        sourceLinkUrl: sourceLinkUrl(payload),
        groupmeText:
          `🎁 New one-time need from ${partnerName}:\n` +
          `Be praying about this opportunity — we'll talk about it more at our next meeting.\n\n` +
          `${payload.description}${sourceLinkLine(payload)}`,
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
        bodyText: `"${payload.description}"`,
        amount,
        sourceNewsletterId: payload.sourceNewsletterId || null,
        sourceDocumentId: payload.sourceDocumentId || null,
        sourceLinkUrl: sourceLinkUrl(payload),
        groupmeText:
          `🎁 One-time need decided (${label}), from ${partnerName}:\n` +
          `"${payload.description}"\n\n` +
          `Approved: ${amount}${sourceLinkLine(payload)}`,
      };
    }

    case "newsletterCreated": {
      const base = appBaseUrl();
      const link = base ? `${base}/api/newsletters/${payload.newsletterId}/download` : null;
      return {
        id: row.id,
        type,
        partnerId: row.partnerId,
        partnerName,
        topicKey: "groupmeNewsletterTopicId",
        emoji: "📰",
        summary: "New newsletter",
        bodyText: null,
        amount: null,
        newsletterId: payload.newsletterId,
        sourceNewsletterId: null,
        sourceDocumentId: null,
        sourceLinkUrl: link,
        // Same as groupme.js's own notifyNewsletterCreated: no link, no
        // message -- a newsletter notification with nothing to point at
        // isn't worth sending at all.
        groupmeText: link ? `📰 New newsletter from ${partnerName}:\n${link}` : null,
      };
    }

    default:
      return null;
  }
}

module.exports = { buildBlurb, appBaseUrl };
