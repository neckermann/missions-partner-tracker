// Shared render shell for the admin and public digests: masthead/card/footer
// markup, brand color/logo, partner-photo-tile header, subject template,
// signature, plain-text fallback. adminEmailDispatchContent.js and
// publicEmailDispatchContent.js build `content` ({ itemsHtml, textLines,
// subtitleLine }) and pass it to buildEmailDispatchMessage below.
const jwt = require("jsonwebtoken");
const { appBaseUrl } = require("./dispatchBlurbs");
const { missionaryHouseholdCategory } = require("./maskData");
const { silhouetteFor } = require("./silhouette");
const { withPhotoUrl } = require("./photoUrls");

const HEADER_FALLBACK_COLOR = "#2c2a28";
const ACCENT_FALLBACK_COLOR = "#2a5d3c";
// #a6540f, not a lighter terracotta: it must pass WCAG AA contrast against its
// white text (see the matching comment in frontend/src/index.css).
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

// A colored uppercase label (church highlightColor) in place of a plain bold line.
function typeLabel(label, highlightColor) {
  return `<p style="margin:0;color:${highlightColor};font-size:14px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;">${escapeHtml(label)}</p>`;
}

// A real button (church accentColor) instead of a plain text link.
function brandButton(url, label, accentColor) {
  return `<a href="${url}" style="display:inline-block;margin-top:10px;padding:9px 18px;background-color:${accentColor};color:#ffffff;border-radius:7px;text-decoration:none;font-size:13px;font-weight:600;">${escapeHtml(label)}</a>`;
}

// Falls back to a generic silhouette when `p` is missing (partner deleted).
// Shared by both audiences, with restricted-partner masking built in.
function partnerTileDetails(p) {
  if (!p) return null;
  const restricted = !!p.isRestricted;
  const base = appBaseUrl();
  // A restricted missionary always gets the single-person shape: the real
  // household shape is itself identifying. Non-restricted ones without a photo
  // keep the household shape (placeholder variety, not a security boundary).
  const category =
    p.kind === "organization" ? "organization" : restricted ? "single" : missionaryHouseholdCategory(p);
  const realPhotoSrc =
    !restricted && base && p.photos?.[0] ? `${base}${withPhotoUrl(p.photos[0]).url}` : null;
  // Never the real photo for a restricted partner. Must be a reachable URL, not
  // silhouetteFor()'s data: URI, which many email clients (Outlook) strip;
  // routes/silhouette.js serves the same shape.
  const silhouetteSrc = base ? `${base}/api/silhouette/${category}.svg` : silhouetteFor(category);
  return {
    fieldDisplayName: p.fieldDisplayName || null,
    // Dropped for a restricted partner (as in maskData.js toPublicPartner): with
    // country and a masked name, "supported since 2014" narrows a small expat community.
    supportingSinceYear: restricted || !p.supportingSince ? null : new Date(p.supportingSince).getFullYear(),
    overviewShort: restricted ? "Restricted-access location." : p.overviewShort || null,
    photoSrc: realPhotoSrc || silhouetteSrc,
  };
}

// Same { id, <purpose>: true } shape as routes/auth.js's MFA tokens, signed with
// SESSION_SECRET. requireAuth rejects it as a session, but it also expires: 90
// days, long enough for an unsubscribe link saved from an old digest.
const UNSUBSCRIBE_TOKEN_TTL = "90d";

function buildUnsubscribeToken(userId) {
  return jwt.sign({ id: userId, unsubscribe: true }, process.env.SESSION_SECRET, {
    expiresIn: UNSUBSCRIBE_TOKEN_TTL,
  });
}

function buildUnsubscribeUrl(userId) {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/api/auth/unsubscribe?token=${encodeURIComponent(buildUnsubscribeToken(userId))}`;
}

// Distinct discriminator keys: a confirm link can't be replayed as an
// unsubscribe link, and a PublicSubscriber token can't pass as a User one.
function buildSubscriberConfirmToken(subscriberId) {
  return jwt.sign({ id: subscriberId, subscriberConfirm: true }, process.env.SESSION_SECRET);
}

function buildSubscriberUnsubscribeToken(subscriberId) {
  return jwt.sign({ id: subscriberId, subscriberUnsubscribe: true }, process.env.SESSION_SECRET);
}

// A change to an already-confirmed subscriber's preferences must be confirmed
// by the email owner, or anyone knowing the address could re-scope their
// subscription. The proposed values travel inside the token (nothing is written until confirmed).
function buildSubscriberConfirmChangeToken(subscriberId, { cadence, allPartners, partnerIds }) {
  return jwt.sign(
    { id: subscriberId, subscriberConfirmChange: true, cadence, allPartners, partnerIds },
    process.env.SESSION_SECRET
  );
}

function buildSubscriberConfirmUrl(subscriberId) {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/api/public/subscribe/confirm?token=${encodeURIComponent(buildSubscriberConfirmToken(subscriberId))}`;
}

function buildSubscriberConfirmChangeUrl(subscriberId, proposed) {
  const base = appBaseUrl();
  if (!base) return null;
  const token = buildSubscriberConfirmChangeToken(subscriberId, proposed);
  return `${base}/api/public/subscribe/confirm?token=${encodeURIComponent(token)}`;
}

function buildSubscriberUnsubscribeUrl(subscriberId) {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/api/public/unsubscribe?token=${encodeURIComponent(buildSubscriberUnsubscribeToken(subscriberId))}`;
}

// A postal address string from the About Church address fields; null if none set.
function formatAddress(address) {
  if (!address) return null;
  const line1 = [address.addressLine1, address.addressLine2].filter(Boolean).join(", ");
  const cityState = [address.city, address.stateProvinceRegion].filter(Boolean).join(", ");
  const cityStateZip = [cityState, address.postalCode].filter(Boolean).join(" ");
  return [line1, cityStateZip, address.country].filter(Boolean).join(", ") || null;
}

// The footer's church-contact block: name, mailing address, phone, website, each
// only if configured. A mailing address in bulk-email footers is expected (CAN-SPAM).
function buildContactLines(churchSettings, churchName, accentColor) {
  const address = formatAddress(churchSettings);
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

// Built-in subject when an admin hasn't written one; same token template as a
// custom subject. {term} is what this church calls its partners.
const DEFAULT_SUBJECT_TEMPLATE = "{date} {church} - {term} Updates";

// A custom subject is plain text with a few tokens, not a template language.
// {cadence} reflects the tier actually being sent.
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

// Plain-text fallback: some clients (screen readers, very old ones) prefer it.
function renderText(textLines, unsubscribeUrl, greetingName, signature, contactLines) {
  const lines = [];
  lines.push(greetingName ? `Hi ${greetingName},` : "Hi there,", "");
  lines.push(...textLines);
  if (signature) lines.push(signature, "");
  if (contactLines?.text.length) lines.push(...contactLines.text, "");
  if (unsubscribeUrl) lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return lines.join("\n");
}

// The one exported entry point. `recipient` is { email, name?, kind, cadence };
// `content` is what the admin/public content builders return; `settings` is the
// full ChurchSettings row. Returns { To, Subject, HtmlBody, TextBody} for
// sendEmailBatch; sends nothing itself.
function buildEmailDispatchMessage(recipient, content, settings, unsubscribeUrl) {
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
  const signature = settings?.emailDispatchSignature || null;
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
      <div style="font-family:${escapeHtml(fontFamily)};max-width:600px;margin:0 auto;color:#222;">
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
      settings?.emailDispatchSubjectTemplate,
      churchName,
      settings,
      recipient.name,
      recipient.cadence
    ),
    HtmlBody: html,
    TextBody: renderText(content.textLines, unsubscribeUrl, recipient.name, signature, contactLines),
    // RFC 8058 one-click unsubscribe: Gmail/Yahoo show a native button that POSTs
    // to unsubscribeUrl. Both headers are required together.
    Headers: [
      { Name: "List-Unsubscribe", Value: `<${unsubscribeUrl}>` },
      { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
    ],
  };
}

// The church's button/link color, with the shell's fallback.
function accentColorFor(settings) {
  return settings?.primaryColor || ACCENT_FALLBACK_COLOR;
}

// One-off transactional message (welcome email, notice) in the branded shell,
// without digest-only parts (subject template, signature, unsubscribe footer).
// `bodyHtml`/`bodyText` sit below the greeting; `footerNote` is the small print
// above the contact block. Returns { subject, html, text }; sends nothing itself.
function buildTransactionalMessage({
  settings,
  subject,
  subtitleLine,
  greetingName,
  bodyHtml,
  bodyText,
  footerNote,
  footerLink,
}) {
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
  const contactLines = buildContactLines(settings, churchName, accentColor);
  const contactHtml = contactLines.html.length
    ? `<p style="margin:0 0 8px;line-height:1.6;">${contactLines.html.join("<br>")}</p>`
    : "";

  const html = `
    <div style="background-color:#f4f4f5;padding:32px 16px;">
      <div style="font-family:${escapeHtml(fontFamily)};max-width:600px;margin:0 auto;color:#222;">
        <div style="background-color:${headerColor};padding:32px 24px;border-radius:14px;text-align:center;">
          ${logoHtml}
          <h2 style="margin:0;color:#ffffff;font-size:22px;letter-spacing:0.2px;">${escapeHtml(churchName)}</h2>
          <div style="width:40px;border-top:3px solid ${highlightColor};margin:14px auto 0;"></div>
          <p style="margin:12px 0 0;color:#ffffffcc;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;">${escapeHtml(subtitleLine)}</p>
        </div>
        <div style="padding:28px 4px 4px;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.5;">${greetingName ? `Hi ${escapeHtml(greetingName)},` : "Hi there,"}</p>
          ${bodyHtml}
        </div>
        <div style="margin:24px 0 0;padding:26px 24px;background-color:#ffffff;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.06);font-size:12px;color:#888;line-height:1.5;text-align:center;">
          ${contactHtml}
          ${footerNote ? `<p style="margin:12px 0 0;">${escapeHtml(footerNote)}</p>` : ""}
          ${footerLink?.url ? `<p style="margin:10px 0 0;"><a href="${escapeHtml(footerLink.url)}" style="color:${accentColor};text-decoration:none;">${escapeHtml(footerLink.label)}</a></p>` : ""}
        </div>
      </div>
    </div>`;

  const text = [
    greetingName ? `Hi ${greetingName},` : "Hi there,",
    "",
    ...bodyText,
    "",
    ...contactLines.text,
    ...(footerNote ? ["", footerNote] : []),
    ...(footerLink?.url ? [`${footerLink.label}: ${footerLink.url}`] : []),
  ].join("\n");

  return { subject, html, text };
}

module.exports = {
  buildTransactionalMessage,
  accentColorFor,
  escapeHtml,
  nl2br,
  typeLabel,
  brandButton,
  partnerTileDetails,
  buildUnsubscribeToken,
  buildUnsubscribeUrl,
  buildSubscriberConfirmToken,
  buildSubscriberConfirmChangeToken,
  buildSubscriberUnsubscribeToken,
  buildSubscriberConfirmUrl,
  buildSubscriberConfirmChangeUrl,
  buildSubscriberUnsubscribeUrl,
  buildEmailDispatchMessage,
};
