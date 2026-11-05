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
// Colors/font reuse the exact same three-role branding system (see
// #182's history) the rest of the app uses: Header (the band at the
// top), Accent (links), Highlight (the item accent border) --
// `routes/publicSettings.js`/`schema.prisma` are the source of truth for
// the stored fields and their own fallback defaults, mirrored here so
// an unconfigured church's digest looks the same as its site.
const jwt = require("jsonwebtoken");
const prisma = require("../prismaClient");
const { sendEmail } = require("./email");
const { appBaseUrl } = require("./notificationBlurbs");

const HEADER_FALLBACK_COLOR = "#2c2a28";
const ACCENT_FALLBACK_COLOR = "#2a5d3c";
// #a6540f, not the lighter #c97a3d it might look like it should be --
// see the matching comment in frontend/src/index.css: a lighter
// terracotta fails WCAG AA color-contrast against the white text it
// pairs with in several uses.
const HIGHLIGHT_FALLBACK_COLOR = "#a6540f";
const FONT_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

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

function renderBlurbHtml(blurb, accentColor, highlightColor) {
  const amountLine = blurb.amount
    ? `<p style="margin:6px 0 0;font-weight:600;color:#444;">Approved: ${escapeHtml(blurb.amount)}</p>`
    : "";
  const link = blurb.sourceLinkUrl
    ? `<p style="margin:6px 0 0;"><a href="${blurb.sourceLinkUrl}" style="color:${accentColor};">Read the source</a></p>`
    : "";
  return `
    <div style="margin:14px 0;padding-left:14px;border-left:3px solid ${highlightColor};">
      <p style="margin:0;font-weight:600;line-height:1.4;">${blurb.emoji} ${escapeHtml(blurb.summary)}</p>
      <p style="margin:6px 0 0;color:#444;line-height:1.5;">${nl2br(blurb.bodyText)}</p>
      ${amountLine}
      ${link}
    </div>`;
}

function renderPartnerHtml(group, accentColor, highlightColor) {
  const newsletterBlocks = group.newsletters
    .map(
      ({ blurb, children }) => `
      <div style="margin:0 0 16px;">
        <p style="margin:0;font-weight:700;line-height:1.4;">${blurb.emoji} New newsletter</p>
        ${
          blurb.sourceLinkUrl
            ? `<p style="margin:6px 0 0;"><a href="${blurb.sourceLinkUrl}" style="color:${accentColor};">Read the full newsletter</a></p>`
            : ""
        }
        ${children.map((c) => renderBlurbHtml(c, accentColor, highlightColor)).join("")}
      </div>`
    )
    .join("");
  const standaloneBlocks = group.standalone
    .map((b) => renderBlurbHtml(b, accentColor, highlightColor))
    .join("");

  return `
    <div style="margin:20px 0;padding:18px 20px;background-color:#f7f5f0;border-radius:10px;">
      <h3 style="margin:0 0 10px;font-size:16px;color:#222;">${escapeHtml(group.partnerName)}</h3>
      ${newsletterBlocks}
      ${standaloneBlocks}
    </div>`;
}

// A plain postal address string from the structured Address fields on
// the About Church settings page -- null if nothing's set. Each piece is
// optional, so this joins only what's actually there rather than leaving
// stray ", ," gaps.
function formatAddress(address) {
  if (!address) return null;
  const line1 = [address.addressLine1, address.addressLine2].filter(Boolean).join(", ");
  const cityState = [address.city, address.stateProvinceRegion].filter(Boolean).join(", ");
  const cityStateZip = [cityState, address.postalCode].filter(Boolean).join(" ");
  return [line1, cityStateZip, address.country].filter(Boolean).join(", ") || null;
}

// The footer's church-contact block -- mailing address, phone, website,
// each included only if actually configured. A real mailing address in
// a periodic bulk email's footer is expected practice (CAN-SPAM), not
// just a nice-to-have. Deliberately not aboutText (the public-site
// blurb) -- written for a different audience/length than a plain email
// footer calls for.
function buildContactLines(churchSettings) {
  const address = formatAddress(churchSettings?.address);
  const phone = churchSettings?.phone || null;
  const website = churchSettings?.websiteLink || null;

  const html = [];
  const text = [];
  if (address) {
    html.push(escapeHtml(address));
    text.push(address);
  }
  if (phone) {
    html.push(escapeHtml(phone));
    text.push(phone);
  }
  if (website) {
    html.push(`<a href="${escapeHtml(website)}" style="color:#888;">${escapeHtml(website)}</a>`);
    text.push(website);
  }
  return { html, text };
}

// Plain-text fallback -- every email client that renders HTML also
// accepts a text part, and some (screen readers, very old clients)
// prefer it outright.
function renderText(groups, unsubscribeUrl, greetingName, signature, contactLines) {
  const lines = [];
  lines.push(greetingName ? `Hi ${greetingName},` : "Hi there,", "");
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
  if (signature) lines.push(signature, "");
  if (contactLines?.text.length) lines.push(...contactLines.text, "");
  if (unsubscribeUrl) lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return lines.join("\n");
}

function renderDigestEmail(blurbs, churchSettings, unsubscribeUrl, recipientName) {
  const groups = groupByPartner(blurbs);
  const churchName = churchSettings?.churchName || "Missions Partner Tracker";
  const headerColor = churchSettings?.headerColor || HEADER_FALLBACK_COLOR;
  const accentColor = churchSettings?.primaryColor || ACCENT_FALLBACK_COLOR;
  const highlightColor = churchSettings?.highlightColor || HIGHLIGHT_FALLBACK_COLOR;
  const fontFamily = churchSettings?.brandFont || FONT_FALLBACK;
  const base = appBaseUrl();
  const logoHtml =
    churchSettings?.logoContentType && base
      ? `<img src="${base}/api/public/settings/logo/raw" alt="${escapeHtml(churchName)}" style="max-height:40px;width:auto;max-width:240px;margin-bottom:10px;">`
      : "";
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi there,";
  const count = blurbs.length;
  const signature = churchSettings?.digestSignature || null;
  const signatureHtml = signature
    ? `<p style="margin:20px 4px 0;font-size:14px;line-height:1.5;color:#444;">${nl2br(signature)}</p>`
    : "";
  const contactLines = buildContactLines(churchSettings);
  const contactHtml = contactLines.html.length
    ? `<p style="margin:0 0 6px;">${contactLines.html.join("<br>")}</p>`
    : "";

  const html = `
    <div style="font-family:${fontFamily};max-width:600px;margin:0 auto;color:#222;">
      <div style="background-color:${headerColor};padding:28px 24px;border-radius:10px 10px 0 0;">
        ${logoHtml}
        <h2 style="margin:0;color:#ffffff;font-size:20px;">${escapeHtml(churchName)} updates</h2>
      </div>
      <div style="padding:20px 4px 4px;">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">${greeting}</p>
        ${groups.map((g) => renderPartnerHtml(g, accentColor, highlightColor)).join("")}
        ${signatureHtml}
      </div>
      <div style="margin-top:12px;padding:16px 4px 0;border-top:1px solid #e5e2d8;font-size:12px;color:#888;line-height:1.5;">
        ${contactHtml}
        <p style="margin:0 0 6px;">You're receiving this because email notifications are turned on for your account.</p>
        ${unsubscribeUrl ? `<p style="margin:0;"><a href="${unsubscribeUrl}" style="color:#888;">Unsubscribe</a></p>` : ""}
      </div>
    </div>`;

  return {
    subject: buildSubject(churchSettings?.digestSubjectTemplate, count, churchName),
    html,
    text: renderText(groups, unsubscribeUrl, recipientName, signature, contactLines),
  };
}

// A custom subject is plain text with two supported tokens, not a real
// template language (no conditionals/loops) -- an admin writing their
// own subject line never needs more than "put the count/church name
// somewhere in my own wording". Falls back to the built-in default when
// no template is set, or when one is set but matches neither token
// (still works, just doesn't substitute anything -- never a hard error
// over a typo in an admin's own text).
function buildSubject(template, count, churchName) {
  if (!template) return `${count} update${count === 1 ? "" : "s"} from ${churchName}`;
  return template.replace(/\{count\}/g, String(count)).replace(/\{church\}/g, churchName);
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
    select: { id: true, email: true, name: true },
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
    const { subject, html, text } = renderDigestEmail(blurbs, churchSettings, unsubscribeUrl, recipient.name);
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

module.exports = { sendPendingNotificationsDigest, buildUnsubscribeToken, renderDigestEmail, escapeHtml };
