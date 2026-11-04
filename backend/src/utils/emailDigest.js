// Builds and sends the batched notification digest email (see #129) --
// the first real consumer of utils/email.js's sendEmail() besides the
// admin's own "Send Test Email" button. One email per opted-in
// (`User.notifyByEmail`) active user, grouped by partner rather than by
// flat type sections: a partner with a newsletter in this batch gets it
// rendered as that block's own header (with a link to read the whole
// thing), and any prayer-request/need blurbs sourced from that same
// newsletter nest directly underneath instead of repeating the link in
// a separate section. A newsletter with nothing extracted from it in
// this batch still renders as a header with no children, so it doesn't
// just vanish; a request/need whose source newsletter already went out
// in an earlier digest keeps its own "Read the source" link with no
// header to nest under.
//
// Inline CSS throughout -- required for reliable rendering across real
// email clients (no external stylesheet, no flexbox/grid, nothing that
// Outlook's renderer or a stripped-down webmail preview would drop).
const jwt = require("jsonwebtoken");
const prisma = require("../prismaClient");
const { sendEmail } = require("./email");
const { appBaseUrl } = require("./notificationBlurbs");

const BRAND_FALLBACK_COLOR = "#2a5d3c";

// Same { id, <purpose>: true } shape routes/auth.js already uses for
// MFA-pending/MFA-setup tokens, signed with the same SESSION_SECRET --
// deliberately no expiresIn, since an unsubscribe link saved from an old
// email should still work whenever it's clicked.
function buildUnsubscribeToken(userId) {
  return jwt.sign({ id: userId, unsubscribe: true }, process.env.SESSION_SECRET);
}

function buildUnsubscribeUrl(userId) {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/api/auth/unsubscribe?token=${encodeURIComponent(buildUnsubscribeToken(userId))}`;
}

// Groups blurbs by partner, and within each partner, nests a
// request/need under the newsletter blurb it was sourced from when that
// newsletter is also in this batch -- see the file comment above.
function groupByPartner(blurbs) {
  const byPartner = new Map(); // partnerId -> { partnerName, newsletters: [{ blurb, children: [] }], standalone: [] }

  for (const blurb of blurbs) {
    if (!byPartner.has(blurb.partnerId)) {
      byPartner.set(blurb.partnerId, { partnerName: blurb.partnerName, newsletters: [], standalone: [] });
    }
    const group = byPartner.get(blurb.partnerId);
    if (blurb.type === "newsletterCreated") group.newsletters.push({ blurb, children: [] });
  }

  for (const blurb of blurbs) {
    if (blurb.type === "newsletterCreated") continue;
    const group = byPartner.get(blurb.partnerId);
    const parent = blurb.sourceNewsletterId
      ? group.newsletters.find((n) => n.blurb.newsletterId === blurb.sourceNewsletterId)
      : null;
    if (parent) parent.children.push(blurb);
    else group.standalone.push(blurb);
  }

  return [...byPartner.values()];
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function nl2br(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function renderBlurbHtml(blurb) {
  const amountLine = blurb.amount
    ? `<p style="margin:4px 0 0;font-weight:600;">Approved: ${escapeHtml(blurb.amount)}</p>`
    : "";
  const link = blurb.sourceLinkUrl
    ? `<p style="margin:4px 0 0;"><a href="${blurb.sourceLinkUrl}" style="color:#2a5d3c;">Read the source</a></p>`
    : "";
  return `
    <div style="margin:12px 0;padding-left:12px;border-left:3px solid #e5e5e5;">
      <p style="margin:0;font-weight:600;">${blurb.emoji} ${escapeHtml(blurb.summary)}</p>
      <p style="margin:4px 0 0;color:#333;">${nl2br(blurb.bodyText)}</p>
      ${amountLine}
      ${link}
    </div>`;
}

function renderPartnerHtml(group) {
  const newsletterBlocks = group.newsletters
    .map(
      ({ blurb, children }) => `
      <div style="margin:16px 0;">
        <p style="margin:0;font-weight:700;">${blurb.emoji} New newsletter</p>
        ${
          blurb.sourceLinkUrl
            ? `<p style="margin:4px 0 0;"><a href="${blurb.sourceLinkUrl}" style="color:#2a5d3c;">Read the full newsletter</a></p>`
            : ""
        }
        ${children.map(renderBlurbHtml).join("")}
      </div>`
    )
    .join("");
  const standaloneBlocks = group.standalone.map(renderBlurbHtml).join("");

  return `
    <div style="margin:24px 0;padding-bottom:16px;border-bottom:1px solid #e5e5e5;">
      <h3 style="margin:0 0 4px;font-size:16px;">${escapeHtml(group.partnerName)}</h3>
      ${newsletterBlocks}
      ${standaloneBlocks}
    </div>`;
}

// Plain-text fallback -- every email client that renders HTML also
// accepts a text part, and some (screen readers, very old clients)
// prefer it outright.
function renderText(groups, unsubscribeUrl) {
  const lines = [];
  for (const group of groups) {
    lines.push(group.partnerName, "-".repeat(group.partnerName.length));
    for (const { blurb, children } of group.newsletters) {
      lines.push(`${blurb.emoji} New newsletter${blurb.sourceLinkUrl ? ` -- ${blurb.sourceLinkUrl}` : ""}`);
      for (const child of children) {
        lines.push(`  ${child.emoji} ${child.summary}: ${child.bodyText}`);
      }
    }
    for (const blurb of group.standalone) {
      lines.push(`${blurb.emoji} ${blurb.summary}: ${blurb.bodyText}`);
    }
    lines.push("");
  }
  if (unsubscribeUrl) lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return lines.join("\n");
}

function renderDigestEmail(blurbs, churchSettings, unsubscribeUrl) {
  const groups = groupByPartner(blurbs);
  const churchName = churchSettings?.churchName || "Missions Partner Tracker";
  const color = churchSettings?.primaryColor || BRAND_FALLBACK_COLOR;
  const base = appBaseUrl();
  const logoHtml =
    churchSettings?.logoContentType && base
      ? `<img src="${base}/api/public/settings/logo/raw" alt="${escapeHtml(churchName)}" style="max-height:48px;margin-bottom:8px;">`
      : "";

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#222;">
      <div style="padding:20px 0;border-bottom:3px solid ${color};">
        ${logoHtml}
        <h2 style="margin:0;color:${color};">${escapeHtml(churchName)} updates</h2>
      </div>
      ${groups.map(renderPartnerHtml).join("")}
      <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:12px;color:#888;">
        <p>You're receiving this because email notifications are turned on for your account.</p>
        ${unsubscribeUrl ? `<p><a href="${unsubscribeUrl}" style="color:#888;">Unsubscribe</a></p>` : ""}
      </div>
    </div>`;

  return {
    subject: `${churchName} — partner updates`,
    html,
    text: renderText(groups, unsubscribeUrl),
  };
}

// Sends the digest to every opted-in active user. Returns true if the
// phase ran (even if one specific recipient's send failed -- see the
// PendingNotification.emailSentAt schema comment for why that's still
// "sent" for retry purposes), false if there was nobody to send to at
// all (not a failure, just nothing to do -- the caller shouldn't stamp
// emailSentAt on rows nobody saw). Throws only if something fails
// before any individual send is attempted (e.g. Postmark isn't
// configured), which the caller treats as the whole phase failing.
async function sendPendingNotificationsDigest(blurbs) {
  const recipients = await prisma.user.findMany({
    where: { notifyByEmail: true, active: true },
    select: { id: true, email: true },
  });
  if (recipients.length === 0) return false;

  const churchSettings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });

  // Tracked rather than unconditionally returning true once the loop
  // runs -- if Postmark isn't actually configured (or any other
  // across-the-board failure), every recipient's send throws
  // identically, and that's a total failure that should leave
  // emailSentAt unset for retry, not get treated as "sent" just because
  // the loop itself completed. One recipient's address bouncing while
  // others succeed is still a real send, though -- see the schema
  // comment on PendingNotification.emailSentAt for why this phase is
  // tracked as one unit, not per-recipient.
  let anySucceeded = false;
  for (const recipient of recipients) {
    const unsubscribeUrl = buildUnsubscribeUrl(recipient.id);
    const { subject, html, text } = renderDigestEmail(blurbs, churchSettings, unsubscribeUrl);
    try {
      await sendEmail({ to: recipient.email, subject, text, html });
      anySucceeded = true;
    } catch (err) {
      // One recipient's address bouncing/being rejected must never stop
      // the rest of the recipients from getting theirs.
      console.error(`Digest email to ${recipient.email} failed:`, err);
    }
  }

  return anySucceeded;
}

module.exports = { sendPendingNotificationsDigest, buildUnsubscribeToken, renderDigestEmail };
