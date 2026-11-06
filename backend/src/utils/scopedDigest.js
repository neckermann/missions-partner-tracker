// Shared mechanism behind the scoped prayer-request/content digest
// (#202) -- named for the mechanism, not either audience. `User`
// (admin/editor/viewer) and `PublicSubscriber` recipients both ride the
// same cadence tiers and the same send pass; see the plan this was built
// from for the full architecture.
const jwt = require("jsonwebtoken");
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { sendEmail } = require("./email");
const { buildBlurb, appBaseUrl, PUBLIC_DIGEST_TYPES } = require("./notificationBlurbs");
const { needsReview } = require("./notificationFlush");
const { renderDigestEmail, buildUnsubscribeUrl, partnerTileDetails } = require("./emailDigest");

// Same { id, <purpose>: true } shape routes/auth.js already uses for its
// own unsubscribe token (and MFA-pending/MFA-setup tokens before that),
// signed with the same SESSION_SECRET, deliberately with no expiresIn --
// a confirm/unsubscribe link saved from an old email should still work.
// Two distinct discriminator keys, not one shared `subscriber: true`,
// so a confirm link can never be replayed as an unsubscribe link or vice
// versa -- and distinct from User's own `{ id, unsubscribe: true }`
// shape so a PublicSubscriber token can't be confused with a User one
// either (both are verified with the same secret, so the discriminator
// key is the only thing telling them apart).
function buildSubscriberConfirmToken(subscriberId) {
  return jwt.sign({ id: subscriberId, subscriberConfirm: true }, process.env.SESSION_SECRET);
}

function buildSubscriberUnsubscribeToken(subscriberId) {
  return jwt.sign({ id: subscriberId, subscriberUnsubscribe: true }, process.env.SESSION_SECRET);
}

function buildSubscriberConfirmUrl(subscriberId) {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/api/public/subscribe/confirm?token=${encodeURIComponent(buildSubscriberConfirmToken(subscriberId))}`;
}

function buildSubscriberUnsubscribeUrl(subscriberId) {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/api/public/unsubscribe?token=${encodeURIComponent(buildSubscriberUnsubscribeToken(subscriberId))}`;
}

const TIER_LABEL = { weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly" };

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function nl2br(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

// Groups a public subscriber's eligible prayer-request blurbs by partner
// -- simpler than emailDigest.js's own groupByPartner, since the public
// audience never gets newsletterCreated rows to nest anything under
// (PUBLIC_DIGEST_TYPES is prayer-requests only).
function groupByPartnerForPublic(blurbs) {
  const byPartner = new Map();
  for (const blurb of blurbs) {
    if (!byPartner.has(blurb.partnerId)) {
      byPartner.set(blurb.partnerId, {
        partnerId: blurb.partnerId,
        partnerName: blurb.partnerName,
        items: [],
      });
    }
    byPartner.get(blurb.partnerId).items.push(blurb);
  }
  return [...byPartner.values()];
}

// The public-recipient render path -- deliberately a separate, much
// smaller function from emailDigest.js's renderDigestEmail rather than a
// shared one with a "no link" flag: it has no parameter capable of
// carrying a source link at all, which is a structural guarantee (not a
// runtime check) that one can never leak here, satisfying "no link back
// to a source newsletter, ever" for this audience by construction. Never
// reads blurb.sourceLinkUrl/sourceFileId -- those can be populated on the
// very same blurb object an admin recipient's render would show a link
// for (buildBlurb() has no notion of audience), so simply never looking
// at those fields here is what keeps this side clean.
function renderPublicDigestEmail(blurbs, churchSettings, unsubscribeUrl, tier) {
  const groups = groupByPartnerForPublic(blurbs);
  const churchName = churchSettings?.churchName || "Missions Partner Tracker";
  const headerColor = churchSettings?.headerColor || "#2c2a28";
  const highlightColor = churchSettings?.highlightColor || "#a6540f";
  const fontFamily =
    churchSettings?.brandFont || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const itemsHtml = groups
    .map(
      (group) => `
      <div style="margin:20px 0;padding:22px 24px;background-color:#ffffff;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.06);">
        <h3 style="margin:0 0 10px;font-size:16px;color:#222;">${escapeHtml(group.partnerName)}</h3>
        ${group.items
          .map(
            (b) => `
          <div style="margin:14px 0;">
            <p style="margin:0;color:${highlightColor};font-size:14px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;">${escapeHtml(`${b.emoji} ${b.summary}`)}</p>
            <p style="margin:6px 0 0;color:#444;line-height:1.55;">${nl2br(b.bodyText)}</p>
          </div>`
          )
          .join('<div style="border-top:1px solid #eeeeee;margin:14px 0;"></div>')}
      </div>`
    )
    .join("");

  const html = `
    <div style="background-color:#f4f4f5;padding:32px 16px;">
      <div style="font-family:${fontFamily};max-width:600px;margin:0 auto;color:#222;">
        <div style="background-color:${headerColor};padding:32px 24px;border-radius:14px;text-align:center;">
          <h2 style="margin:0;color:#ffffff;font-size:22px;letter-spacing:0.2px;">${escapeHtml(churchName)}</h2>
          <div style="width:40px;border-top:3px solid ${highlightColor};margin:14px auto 0;"></div>
          <p style="margin:12px 0 0;color:#ffffffcc;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;">Prayer Updates</p>
        </div>
        <div style="padding:28px 4px 4px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.5;">Hi there,</p>
          ${itemsHtml}
        </div>
        <div style="margin:24px 0 0;padding:26px 24px;background-color:#ffffff;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.06);font-size:12px;color:#888;line-height:1.5;text-align:center;">
          <p style="margin:0;">Your email is used only to send these updates -- we never share it with anyone else, and you can unsubscribe anytime.</p>
          ${unsubscribeUrl ? `<p style="margin:10px 0 0;"><a href="${unsubscribeUrl}" style="display:inline-block;padding:6px 16px;border:1px solid #ddd;border-radius:999px;color:#666;text-decoration:none;">Unsubscribe</a></p>` : ""}
        </div>
      </div>
    </div>`;

  const text = groups
    .map((group) =>
      [
        group.partnerName,
        "-".repeat(group.partnerName.length),
        ...group.items.map((b) => `${b.emoji} ${b.summary}: ${b.bodyText}`),
        "",
      ].join("\n")
    )
    .join("\n");

  return {
    subject: `${TIER_LABEL[tier] || ""} Prayer Updates -- ${churchName}`.trim(),
    html,
    text: `Hi there,\n\n${text}${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}`,
  };
}

// The scoped-digest send pass (#202): `tier` is "weekly"|"biweekly"|
// "monthly". Loads both recipient sets for that tier and sends each its
// own personally-scoped digest -- unlike emailDigest.js's own
// sendPendingNotificationsDigest (one identical batch for every
// recipient), scope here varies per recipient (allPartners vs.
// followedPartners/scopedPartners), so each recipient's eligible rows
// are computed individually. Returns the ids of every PendingNotification
// row actually considered (sent, or eligible-but-skipped only because
// nobody in either audience wanted it this time around isn't possible --
// "considered" here specifically means "included in at least one
// recipient's send"), so the caller (digestScheduler.js) knows which ids
// to stamp with this tier's column. Returns [] without touching anything
// if outboundEmail is off or there's simply nothing to send -- same
// "untouched, not a failure" reasoning sendPendingNotificationsDigest's
// own false return uses.
async function sendScopedDigest(tier, settings) {
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return { consideredIds: [] };

  const rows = await prisma.pendingNotification.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return { consideredIds: [] };

  const partners = await prisma.partner.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
    select: { id: true, displayName: true, isRestricted: true, isPublic: true },
  });
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  // Same review gate as flushPendingNotifications() -- a restricted
  // partner's unreviewed real-content row is held out of this send pass
  // exactly as it's held out of groupme/the internal digest.
  const sendableRows = rows.filter((row) => !needsReview(row, partnerById.get(row.partnerId)));
  const blurbById = new Map(
    sendableRows.map((row) => [row.id, buildBlurb(row, partnerById.get(row.partnerId))]).filter(([, b]) => b)
  );

  const [adminRecipients, publicRecipients] = await Promise.all([
    prisma.user.findMany({
      where: { digestFrequency: tier, active: true },
      select: {
        id: true,
        email: true,
        name: true,
        allPartners: true,
        followedPartners: { select: { partnerId: true } },
      },
    }),
    prisma.publicSubscriber.findMany({
      where: { frequency: tier, confirmedAt: { not: null } },
      select: { id: true, email: true, allPartners: true, scopedPartners: { select: { partnerId: true } } },
    }),
  ]);

  const consideredIds = new Set();
  if (adminRecipients.length === 0 && publicRecipients.length === 0) return { consideredIds: [] };

  const churchSettings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  // Same classic/snapshot split as sendPendingNotificationsDigest, built
  // once for the whole send -- see partnerTileDetails() in
  // emailDigest.js.
  let partnerDetailsById;
  if (adminRecipients.length > 0 && churchSettings?.digestTemplate === "snapshot") {
    const fullPartners = await prisma.partner.findMany({
      where: { id: { in: [...new Set(sendableRows.map((row) => row.partnerId))] } },
      select: {
        id: true,
        kind: true,
        isRestricted: true,
        fieldDisplayName: true,
        supportingSince: true,
        overviewShort: true,
        adults: { select: { id: true } },
        children: { select: { id: true } },
        photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], take: 1, select: { id: true } },
      },
    });
    partnerDetailsById = new Map(fullPartners.map((p) => [p.id, partnerTileDetails(p)]));
  }

  for (const recipient of adminRecipients) {
    const followedIds = new Set(recipient.followedPartners.map((fp) => fp.partnerId));
    const scopedBlurbs = sendableRows
      .filter((row) => recipient.allPartners || followedIds.has(row.partnerId))
      .map((row) => blurbById.get(row.id))
      .filter(Boolean);
    if (scopedBlurbs.length === 0) continue;
    scopedBlurbs.forEach((b) => consideredIds.add(b.id));

    const unsubscribeUrl = buildUnsubscribeUrl(recipient.id);
    // {frequency} in a custom subject template should reflect the tier
    // actually being sent, not ChurchSettings' own separate church-wide
    // digestFrequency (a different schedule entirely -- see this file's
    // header comment) -- overridden just for buildSubject()'s benefit.
    const { subject, html, text } = renderDigestEmail(
      scopedBlurbs,
      { ...churchSettings, digestFrequency: tier },
      unsubscribeUrl,
      recipient.name,
      partnerDetailsById
    );
    try {
      await sendEmail({ to: recipient.email, subject, text, html });
    } catch (err) {
      console.error(`Scoped digest email to ${recipient.email} failed:`, err);
    }
  }

  for (const subscriber of publicRecipients) {
    const scopedIds = new Set(subscriber.scopedPartners.map((sp) => sp.partnerId));
    const eligibleBlurbs = sendableRows
      .filter((row) => PUBLIC_DIGEST_TYPES.has(row.type) && !!partnerById.get(row.partnerId)?.isPublic)
      .filter((row) => subscriber.allPartners || scopedIds.has(row.partnerId))
      .map((row) => blurbById.get(row.id))
      .filter(Boolean);
    if (eligibleBlurbs.length === 0) continue;
    eligibleBlurbs.forEach((b) => consideredIds.add(b.id));

    const unsubscribeUrl = buildSubscriberUnsubscribeUrl(subscriber.id);
    const { subject, html, text } = renderPublicDigestEmail(
      eligibleBlurbs,
      churchSettings,
      unsubscribeUrl,
      tier
    );
    try {
      await sendEmail({ to: subscriber.email, subject, text, html });
    } catch (err) {
      console.error(`Scoped digest email to ${subscriber.email} failed:`, err);
    }
  }

  return { consideredIds: [...consideredIds] };
}

module.exports = {
  buildSubscriberConfirmToken,
  buildSubscriberUnsubscribeToken,
  buildSubscriberConfirmUrl,
  buildSubscriberUnsubscribeUrl,
  sendScopedDigest,
  renderPublicDigestEmail,
};
