// The shared render shell for both the admin digest and the public
// digest -- masthead/card/footer markup, brand color/logo resolution,
// the partner-photo-tile header, the subject-line template, the
// signature block, and the plain-text fallback renderer. Everything
// genuinely audience-agnostic lives here; adminDigestContent.js and
// publicDigestContent.js each build their own `content` (an
// { itemsHtml, textLines, subtitleLine } shape) and hand it to
// buildDigestMessage below, which wraps it in this shared shell.
const jwt = require("jsonwebtoken");
const { appBaseUrl } = require("./notificationBlurbs");
const { missionaryHouseholdCategory } = require("./maskData");
const { silhouetteFor } = require("./silhouette");
const { withPhotoUrl } = require("./photoUrls");

const HEADER_FALLBACK_COLOR = "#2c2a28";
const ACCENT_FALLBACK_COLOR = "#2a5d3c";
// #a6540f, not the lighter #c97a3d it might look like it should be --
// see the matching comment in frontend/src/index.css: a lighter
// terracotta fails WCAG AA color-contrast against the white text it
// pairs with in several uses.
const HIGHLIGHT_FALLBACK_COLOR = "#a6540f";
const FONT_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function nl2br(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

// A colored uppercase label (church's own highlightColor) in place of a
// plain bold line.
function typeLabel(label, highlightColor) {
  return `<p style="margin:0;color:${highlightColor};font-size:14px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;">${escapeHtml(label)}</p>`;
}

// A real button (church's own accentColor) instead of a plain text link.
function brandButton(url, label, accentColor) {
  return `<a href="${url}" style="display:inline-block;margin-top:10px;padding:9px 18px;background-color:${accentColor};color:#ffffff;border-radius:7px;text-decoration:none;font-size:13px;font-weight:600;">${escapeHtml(label)}</a>`;
}

// Resolves to a church-free generic fallback when `p` is missing (the
// partner's been deleted) -- missionaryHouseholdCategory handles an
// empty object fine (no adults/children -> "single"), so this never
// throws, it just renders a plain default silhouette as a last resort.
// Shared by both audiences now -- the public digest gains this same
// photo-tile treatment, with the same restricted-partner masking
// (silhouette, no real photo) built in regardless of who's looking.
function partnerTileDetails(p) {
  if (!p) return null;
  const restricted = !!p.isRestricted;
  const base = appBaseUrl();
  const category = p.kind === "organization" ? "organization" : missionaryHouseholdCategory(p);
  const realPhotoSrc =
    !restricted && base && p.photos?.[0] ? `${base}${withPhotoUrl(p.photos[0]).url}` : null;
  // Never the real photo for a restricted partner -- a generic
  // silhouette instead, same as a missing photo gets for anyone else.
  // Must be an actual URL here, not silhouetteFor()'s data: URI -- most
  // email clients (Outlook chief among them) strip or refuse a data:
  // URI in an email. routes/silhouette.js serves the same shape as a
  // real, reachable image.
  const silhouetteSrc = base ? `${base}/api/silhouette/${category}.svg` : silhouetteFor(category);
  return {
    fieldDisplayName: p.fieldDisplayName || null,
    supportingSinceYear: p.supportingSince ? new Date(p.supportingSince).getFullYear() : null,
    overviewShort: restricted ? "Restricted-access location." : p.overviewShort || null,
    photoSrc: realPhotoSrc || silhouetteSrc,
  };
}

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

// Same two-distinct-discriminator-keys reasoning as routes/auth.js's own
// unsubscribe token above -- a confirm link can never be replayed as an
// unsubscribe link or vice versa, and a PublicSubscriber token can't be
// confused with a User one either.
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

// A plain postal address string from the structured Address fields on
// the About Church settings page -- null if nothing's set.
function formatAddress(address) {
  if (!address) return null;
  const line1 = [address.addressLine1, address.addressLine2].filter(Boolean).join(", ");
  const cityState = [address.city, address.stateProvinceRegion].filter(Boolean).join(", ");
  const cityStateZip = [cityState, address.postalCode].filter(Boolean).join(" ");
  return [line1, cityStateZip, address.country].filter(Boolean).join(", ") || null;
}

// The footer's church-contact block -- church name, mailing address,
// phone, website, each included only if actually configured. A real
// mailing address in a periodic bulk email's footer is expected
// practice (CAN-SPAM), not just a nice-to-have. Shared by both
// audiences now -- the public digest gains this same footer.
function buildContactLines(churchSettings, churchName, accentColor) {
  const address = formatAddress(churchSettings?.address);
  const phone = churchSettings?.phone || null;
  const website = churchSettings?.websiteLink || null;

  const html = [`<strong style="font-size:14px;color:#333;">${escapeHtml(churchName)}</strong>`];
  const text = [churchName];
  if (address) {
    html.push(escapeHtml(address));
    text.push(address);
  }
  if (phone) {
    html.push(escapeHtml(phone));
    text.push(phone);
  }
  if (website) {
    html.push(
      `<a href="${escapeHtml(website)}" style="color:${accentColor};text-decoration:none;">${escapeHtml(website)}</a>`
    );
    text.push(website);
  }
  return { html, text };
}

// The built-in subject when an admin hasn't written their own -- same
// token template a custom subject uses, not a separate hardcoded
// string. {term} resolves to whatever this church calls its partners.
const DEFAULT_SUBJECT_TEMPLATE = "{date} {church} - {term} Updates";

// A custom subject is plain text with a handful of supported tokens, not
// a real template language. {cadence} (renamed from {frequency} to
// match the field rename -- see schema.prisma's own comment) reflects
// the tier actually being sent.
function buildSubject(template, churchName, churchSettings, recipientName, cadence) {
  const now = new Date();
  const cadenceLabel = cadence ? cadence.charAt(0).toUpperCase() + cadence.slice(1) : "";
  const term = churchSettings?.partnerTermSingular || "Missionary";
  return (template || DEFAULT_SUBJECT_TEMPLATE)
    .replace(/\{church\}/g, churchName)
    .replace(/\{month\}/g, now.toLocaleString("en-US", { month: "long" }))
    .replace(/\{year\}/g, String(now.getFullYear()))
    .replace(/\{date\}/g, now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))
    .replace(/\{cadence\}/g, cadenceLabel)
    .replace(/\{name\}/g, recipientName || "there")
    .replace(/\{term\}/g, term);
}

// Plain-text fallback -- every email client that renders HTML also
// accepts a text part, and some (screen readers, very old clients)
// prefer it outright.
function renderText(textLines, unsubscribeUrl, greetingName, signature, contactLines) {
  const lines = [];
  lines.push(greetingName ? `Hi ${greetingName},` : "Hi there,", "");
  lines.push(...textLines);
  if (signature) lines.push(signature, "");
  if (contactLines?.text.length) lines.push(...contactLines.text, "");
  if (unsubscribeUrl) lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return lines.join("\n");
}

// The one exported entry point. `recipient` is { email, name?, kind,
// cadence }, `content` is whatever adminDigestContent.js/
// publicDigestContent.js built ({ itemsHtml, textLines, subtitleLine }),
// `settings` is the full ChurchSettings row. Returns a plain
// { To, Subject, HtmlBody, TextBody } object -- the exact shape
// sendEmailBatch expects. Doesn't send anything itself.
function buildDigestMessage(recipient, content, settings, unsubscribeUrl) {
  const churchName = settings?.churchName || "Missions Partner Tracker";
  const headerColor = settings?.headerColor || HEADER_FALLBACK_COLOR;
  const accentColor = settings?.primaryColor || ACCENT_FALLBACK_COLOR;
  const highlightColor = settings?.highlightColor || HIGHLIGHT_FALLBACK_COLOR;
  const fontFamily = settings?.brandFont || FONT_FALLBACK;
  const base = appBaseUrl();
  const logoHtml =
    settings?.logoContentType && base
      ? `<img src="${base}/api/public/settings/logo/raw" alt="${escapeHtml(churchName)}" style="max-height:40px;width:auto;max-width:240px;margin-bottom:10px;">`
      : "";
  const greeting = recipient.name ? `Hi ${escapeHtml(recipient.name)},` : "Hi there,";
  const signature = settings?.digestSignature || null;
  const signatureHtml = signature
    ? `<div style="margin:28px 4px 0;">
         <div style="width:36px;border-top:2px solid ${highlightColor};margin-bottom:14px;"></div>
         <p style="margin:0;font-size:14px;line-height:1.6;color:#444;font-style:italic;">${nl2br(signature)}</p>
       </div>`
    : "";
  const contactLines = buildContactLines(settings, churchName, accentColor);
  const contactHtml = contactLines.html.length
    ? `<p style="margin:0 0 8px;line-height:1.6;">${contactLines.html.join("<br>")}</p>`
    : "";

  const html = `
    <div style="background-color:#f4f4f5;padding:32px 16px;">
      <div style="font-family:${fontFamily};max-width:600px;margin:0 auto;color:#222;">
        <div style="background-color:${headerColor};padding:32px 24px;border-radius:14px;text-align:center;">
          ${logoHtml}
          <h2 style="margin:0;color:#ffffff;font-size:22px;letter-spacing:0.2px;">${escapeHtml(churchName)}</h2>
          <div style="width:40px;border-top:3px solid ${highlightColor};margin:14px auto 0;"></div>
          <p style="margin:12px 0 0;color:#ffffffcc;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;">${escapeHtml(content.subtitleLine)}</p>
        </div>
        <div style="padding:28px 4px 4px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.5;">${greeting}</p>
          ${content.itemsHtml}
          ${signatureHtml}
        </div>
        <div style="margin:24px 0 0;padding:26px 24px;background-color:#ffffff;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.06);font-size:12px;color:#888;line-height:1.5;text-align:center;">
          ${contactHtml}
          <p style="margin:12px 0 0;">Your email is used only to send these updates -- we never share it with anyone else, and you can unsubscribe anytime.</p>
          ${unsubscribeUrl ? `<p style="margin:10px 0 0;"><a href="${unsubscribeUrl}" style="display:inline-block;padding:6px 16px;border:1px solid #ddd;border-radius:999px;color:#666;text-decoration:none;">Unsubscribe</a></p>` : ""}
        </div>
      </div>
    </div>`;

  return {
    To: recipient.email,
    Subject: buildSubject(
      settings?.digestSubjectTemplate,
      churchName,
      settings,
      recipient.name,
      recipient.cadence
    ),
    HtmlBody: html,
    TextBody: renderText(content.textLines, unsubscribeUrl, recipient.name, signature, contactLines),
  };
}

module.exports = {
  escapeHtml,
  nl2br,
  typeLabel,
  brandButton,
  partnerTileDetails,
  buildUnsubscribeToken,
  buildUnsubscribeUrl,
  buildSubscriberConfirmToken,
  buildSubscriberUnsubscribeToken,
  buildSubscriberConfirmUrl,
  buildSubscriberUnsubscribeUrl,
  buildDigestMessage,
};
