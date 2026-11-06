// Builds and sends the batched notification digest email (see #129) --
// the first real consumer of utils/email.js's sendEmail() besides the
// admin's own "Send Test Email" button. One email per opted-in
// (`User.digestFrequency` not null) active user, grouped by partner rather than by
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
// #182's history) the rest of the app uses: Header (the masthead band),
// Accent (buttons/links), Highlight (each item's small type label) --
// `routes/publicSettings.js`/`schema.prisma` are the source of truth for
// the stored fields and their own fallback defaults, mirrored here so
// an unconfigured church's digest looks the same as its site.
const jwt = require("jsonwebtoken");
const prisma = require("../prismaClient");
const { sendEmail } = require("./email");
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
  const byPartner = new Map(); // partnerId -> { partnerId, partnerName, newsletters: [{ blurb, children: [] }], standalone: [] }

  for (const blurb of blurbs) {
    if (!byPartner.has(blurb.partnerId)) {
      byPartner.set(blurb.partnerId, {
        partnerId: blurb.partnerId,
        partnerName: blurb.partnerName,
        newsletters: [],
        standalone: [],
      });
    }
    const group = byPartner.get(blurb.partnerId);
    if (blurb.type === "newsletterCreated") group.newsletters.push({ blurb, children: [] });
  }

  for (const blurb of blurbs) {
    if (blurb.type === "newsletterCreated") continue;
    const group = byPartner.get(blurb.partnerId);
    const parent = blurb.sourceFileId
      ? group.newsletters.find((n) => n.blurb.newsletterId === blurb.sourceFileId)
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

// A colored uppercase label (church's own highlightColor) in place of a
// plain bold line. Deliberately just colored text, not a solid pill -- a
// filled badge next to a colored left-border bar on every single item
// read as cluttered/dated ("every element gets its own box"), so this
// round drops the border bar and the pill fill, keeping only the one
// colored signal -- sized close to the button below it (14px, not a tiny
// 11px caption) so it reads as the item's own heading, not a footnote.
function typeLabel(label, highlightColor) {
  return `<p style="margin:0;color:${highlightColor};font-size:14px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;">${escapeHtml(label)}</p>`;
}

// A real button (church's own accentColor) instead of a plain text link
// -- every other brand surface in this app (the public site's own .btn
// class) already renders its primary actions this way.
function brandButton(url, label, accentColor) {
  return `<a href="${url}" style="display:inline-block;margin-top:10px;padding:9px 18px;background-color:${accentColor};color:#ffffff;border-radius:7px;text-decoration:none;font-size:13px;font-weight:600;">${escapeHtml(label)}</a>`;
}

function renderBlurbHtml(blurb, accentColor, highlightColor) {
  const amountLine = blurb.amount
    ? `<p style="margin:8px 0 0;font-weight:600;color:#444;">Approved: ${escapeHtml(blurb.amount)}</p>`
    : "";
  const link = blurb.sourceLinkUrl
    ? `<p style="margin:0;">${brandButton(blurb.sourceLinkUrl, "Read the source", accentColor)}</p>`
    : "";
  return `
    <div style="margin:14px 0;">
      ${typeLabel(`${blurb.emoji} ${blurb.summary}`, highlightColor)}
      <p style="margin:6px 0 0;color:#444;line-height:1.55;">${nl2br(blurb.bodyText)}</p>
      ${amountLine}
      ${link}
    </div>`;
}

// The partner-tile's photo + field/tenure + short overview -- built once
// per partner per send (not per-recipient) by sendPendingNotificationsDigest
// and looked up here by partnerId. `tile` is undefined for the "classic"
// digest template (the tile is a "snapshot"-only addition -- see
// ChurchSettings.digestTemplate) and also for a partner that's since been
// deleted (rare -- the notification outlives the record by design, see
// the PendingNotification schema comment); either way it's simply
// omitted rather than left half-rendered, which is exactly what "classic"
// is: this same function with no tile ever passed in.
//
// fieldDisplayName/supportingSince are shown even for a restricted
// partner -- same precedent as maskData.js's toPublicPartner (see the
// field's own "safe to show even if restricted" schema comment); only
// the photo and overview are masked.
function renderNewsletterBlock(blurb, children, accentColor, highlightColor) {
  return `
    <div style="margin:0;">
      ${typeLabel(`${blurb.emoji} New Newsletter`, highlightColor)}
      ${
        blurb.sourceLinkUrl
          ? `<p style="margin:0;">${brandButton(blurb.sourceLinkUrl, "Read the full newsletter", accentColor)}</p>`
          : ""
      }
      ${children.map((c) => renderBlurbHtml(c, accentColor, highlightColor)).join("")}
    </div>`;
}

function renderPartnerHtml(group, accentColor, highlightColor, tile) {
  const metaLine = [
    tile?.fieldDisplayName,
    tile?.supportingSinceYear && `Supporting since ${tile.supportingSinceYear}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // Dividers sit *between* top-level items (a newsletter-with-its-children
  // counts as one item, each standalone request/need as another) -- never
  // before the first or after the last, same rhythm the reference email
  // uses between its own stacked items.
  const topLevelItems = [
    ...group.newsletters.map(({ blurb, children }) =>
      renderNewsletterBlock(blurb, children, accentColor, highlightColor)
    ),
    ...group.standalone.map((b) => renderBlurbHtml(b, accentColor, highlightColor)),
  ];
  const itemsHtml = topLevelItems.join('<div style="border-top:1px solid #eeeeee;margin:14px 0;"></div>');

  // Same photo-left/name-and-meta-right/overview-below shape the public
  // partner profile page uses (see .partner-detail-photo in index.css),
  // close to that page's own 160px now (150px) rather than a small
  // avatar-sized version of it -- and a thin divider in place of that
  // page's section spacing to keep the items below reading as clearly
  // "under" this partner, not blended into the header block.
  const header = tile
    ? `
      <div style="display:flex;align-items:center;gap:18px;margin-bottom:${tile.overviewShort ? "14px" : "16px"};">
        <img src="${tile.photoSrc}" alt="" width="150" height="150" style="width:150px;height:150px;border-radius:50%;object-fit:cover;flex-shrink:0;display:block;">
        <div>
          <h3 style="margin:0;font-size:20px;line-height:1.3;color:#222;">${escapeHtml(group.partnerName)}</h3>
          ${metaLine ? `<p style="margin:5px 0 0;font-size:13px;color:#888;">${escapeHtml(metaLine)}</p>` : ""}
        </div>
      </div>
      ${tile.overviewShort ? `<p style="margin:0 0 16px;font-size:13px;color:#555;line-height:1.55;">${escapeHtml(tile.overviewShort)}</p>` : ""}
      <div style="border-top:1px solid #eeeeee;padding-top:16px;">`
    : `<h3 style="margin:0 0 10px;font-size:16px;color:#222;">${escapeHtml(group.partnerName)}</h3>`;
  const headerClose = tile ? "</div>" : "";

  // A real shadow + white fill (not a flat tinted-beige block sitting
  // directly on the page) -- a card reads as a distinct surface because
  // it's lifted off the background, not because it's a different flat
  // color from it.
  return `
    <div style="margin:20px 0;padding:22px 24px;background-color:#ffffff;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.06);">
      ${header}
      ${itemsHtml}
      ${headerClose}
    </div>`;
}

// Resolves to a church-free generic fallback when `p` is missing (the
// partner's been deleted) -- missionaryHouseholdCategory handles an
// empty object fine (no adults/children -> "single"), so this never
// throws, it just renders a plain default silhouette as a last resort.
function partnerTileDetails(p) {
  if (!p) return null;
  const restricted = !!p.isRestricted;
  const base = appBaseUrl();
  const category = p.kind === "organization" ? "organization" : missionaryHouseholdCategory(p);
  const realPhotoSrc =
    !restricted && base && p.photos?.[0] ? `${base}${withPhotoUrl(p.photos[0]).url}` : null;
  // Never the real photo for a restricted partner (see the file-header
  // masking comment in notificationBlurbs.js) -- a generic silhouette
  // instead, same as a missing photo gets for anyone else. Must be an
  // actual URL here, not silhouetteFor()'s data: URI -- that renders
  // fine in the public site's own <img> tags, but most email clients
  // (Outlook chief among them) strip or refuse a data: URI in an email,
  // leaving a blank gap where the tile's photo should be. routes/
  // silhouette.js serves the same shape as a real, reachable image.
  const silhouetteSrc = base ? `${base}/api/silhouette/${category}.svg` : silhouetteFor(category);
  return {
    fieldDisplayName: p.fieldDisplayName || null,
    supportingSinceYear: p.supportingSince ? new Date(p.supportingSince).getFullYear() : null,
    overviewShort: restricted ? "Restricted-access location." : p.overviewShort || null,
    photoSrc: realPhotoSrc || silhouetteSrc,
  };
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

// The footer's church-contact block -- church name, mailing address,
// phone, website, each included only if actually configured (churchName
// always is, via renderDigestEmail's own fallback). A real mailing
// address in a periodic bulk email's footer is expected practice
// (CAN-SPAM), not just a nice-to-have. Deliberately not aboutText (the
// public-site blurb) -- written for a different audience/length than a
// plain email footer calls for.
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

// Plain-text fallback -- every email client that renders HTML also
// accepts a text part, and some (screen readers, very old clients)
// prefer it outright.
function renderText(groups, unsubscribeUrl, greetingName, signature, contactLines, partnerDetailsById) {
  const lines = [];
  lines.push(greetingName ? `Hi ${greetingName},` : "Hi there,", "");
  for (const group of groups) {
    lines.push(group.partnerName, "-".repeat(group.partnerName.length));
    const tile = partnerDetailsById?.get(group.partnerId);
    const metaLine = [
      tile?.fieldDisplayName,
      tile?.supportingSinceYear && `Supporting since ${tile.supportingSinceYear}`,
    ]
      .filter(Boolean)
      .join(" · ");
    if (metaLine) lines.push(metaLine);
    if (tile?.overviewShort) lines.push(tile.overviewShort);
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

function renderDigestEmail(blurbs, churchSettings, unsubscribeUrl, recipientName, partnerDetailsById) {
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
  const signature = churchSettings?.digestSignature || null;
  // A short colored rule above the closing line, like a real letter's
  // sign-off, instead of the signature just trailing straight off the
  // last card with no visual transition.
  const signatureHtml = signature
    ? `<div style="margin:28px 4px 0;">
         <div style="width:36px;border-top:2px solid ${highlightColor};margin-bottom:14px;"></div>
         <p style="margin:0;font-size:14px;line-height:1.6;color:#444;font-style:italic;">${nl2br(signature)}</p>
       </div>`
    : "";
  const contactLines = buildContactLines(churchSettings, churchName, accentColor);
  const contactHtml = contactLines.html.length
    ? `<p style="margin:0 0 8px;line-height:1.6;">${contactLines.html.join("<br>")}</p>`
    : "";

  // A light neutral canvas behind the centered content, not a page that's
  // just whatever white the email client defaults to -- that's what lets
  // the white, shadowed partner cards below actually read as cards
  // instead of disappearing into the page they sit on. The footer gets
  // the same white-card-with-shadow treatment as a partner card, not a
  // bare strip of small gray text, so the whole email reads as one
  // consistent design instead of "nice cards, plain everything else."
  const html = `
    <div style="background-color:#f4f4f5;padding:32px 16px;">
      <div style="font-family:${fontFamily};max-width:600px;margin:0 auto;color:#222;">
        <div style="background-color:${headerColor};padding:32px 24px;border-radius:14px;text-align:center;">
          ${logoHtml}
          <h2 style="margin:0;color:#ffffff;font-size:22px;letter-spacing:0.2px;">${escapeHtml(churchName)}</h2>
          <div style="width:40px;border-top:3px solid ${highlightColor};margin:14px auto 0;"></div>
          <p style="margin:12px 0 0;color:#ffffffcc;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;">${escapeHtml(churchSettings?.partnerTermPlural || "Missionaries")} Updates</p>
        </div>
        <div style="padding:28px 4px 4px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.5;">${greeting}</p>
          ${groups
            .map((g) =>
              renderPartnerHtml(g, accentColor, highlightColor, partnerDetailsById?.get(g.partnerId))
            )
            .join("")}
          ${signatureHtml}
        </div>
        <div style="margin:24px 0 0;padding:26px 24px;background-color:#ffffff;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.06);font-size:12px;color:#888;line-height:1.5;text-align:center;">
          ${contactHtml}
          <p style="margin:12px 0 0;">You're receiving this because email notifications are turned on for your account.</p>
          ${unsubscribeUrl ? `<p style="margin:10px 0 0;"><a href="${unsubscribeUrl}" style="display:inline-block;padding:6px 16px;border:1px solid #ddd;border-radius:999px;color:#666;text-decoration:none;">Unsubscribe</a></p>` : ""}
        </div>
      </div>
    </div>`;

  return {
    subject: buildSubject(churchSettings?.digestSubjectTemplate, churchName, churchSettings, recipientName),
    html,
    text: renderText(groups, unsubscribeUrl, recipientName, signature, contactLines, partnerDetailsById),
  };
}

// The built-in subject when an admin hasn't written their own -- expressed
// as the same token template a custom subject uses (see buildSubject
// below), not a separate hardcoded string, so the default and any custom
// wording go through identical substitution logic. {term} resolves to
// whatever this church calls its partners (Partner Terminology on the
// Branding settings page), so the out-of-the-box subject already reads
// naturally whether or not a church has customized that wording.
const DEFAULT_SUBJECT_TEMPLATE = "{date} {church} - {term} Updates";

// A custom subject is plain text with a handful of supported tokens, not
// a real template language (no conditionals/loops) -- an admin writing
// their own subject line never needs more than "put a date/name/church
// name somewhere in my own wording". Substitutes nothing for a token that
// doesn't match any of these (never a hard error over a typo in an
// admin's own text). {count} is deliberately NOT offered here -- a raw
// item count read poorly in a subject line ("3 updates" says less than it
// seems to); {date}/{month}/{year} solve the same original problem (every
// send sharing an identical subject, risking Gmail/webmail
// thread-collapse) without that.
function buildSubject(template, churchName, churchSettings, recipientName) {
  const now = new Date();
  const frequency = churchSettings?.digestFrequency
    ? churchSettings.digestFrequency.charAt(0).toUpperCase() + churchSettings.digestFrequency.slice(1)
    : "";
  const term = churchSettings?.partnerTermSingular || "Missionary";
  return (template || DEFAULT_SUBJECT_TEMPLATE)
    .replace(/\{church\}/g, churchName)
    .replace(/\{month\}/g, now.toLocaleString("en-US", { month: "long" }))
    .replace(/\{year\}/g, String(now.getFullYear()))
    .replace(/\{date\}/g, now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))
    .replace(/\{frequency\}/g, frequency)
    .replace(/\{name\}/g, recipientName || "there")
    .replace(/\{term\}/g, term);
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
  // notifyByEmail: true always meant "subscribed" here -- replaced by
  // #202's richer digestFrequency field (null = not subscribed, a
  // value = which cadence), but this internal digest's own schedule is
  // still ChurchSettings.digestFrequency, not the per-user one, so any
  // non-null value here still just means "send me the one shared
  // digest" until a later phase makes this scoped-digest-aware.
  const recipients = await prisma.user.findMany({
    where: { digestFrequency: { not: null }, active: true },
    select: { id: true, email: true, name: true },
  });
  if (recipients.length === 0) return false;

  const churchSettings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });

  // Two digest layouts share this one render path: "classic" (the
  // original, text-only partner cards) and "snapshot" (adds each
  // partner's photo/field/tenure/overview -- see partnerTileDetails()
  // below). Null/"classic" means partnerDetailsById stays undefined,
  // which renderPartnerHtml/renderText already treat as "no tile" and
  // fall back to the exact classic markup -- so classic churches never
  // pay for this query at all, and the two layouts can't drift apart
  // since they're the same template with tile data present or absent.
  let partnerDetailsById;
  if (churchSettings?.digestTemplate === "snapshot") {
    // Fetched once for the whole send (not per-recipient) -- the tile
    // content is identical for every recipient, only the greeting/subject
    // vary. Read fresh, not from each blurb's own frozen payload --
    // isRestricted can change after a notification was queued, same
    // reasoning as notificationFlush.js's own partner lookup for masking
    // the text content.
    const partnerIds = [...new Set(blurbs.map((b) => b.partnerId))];
    const partners = await prisma.partner.findMany({
      where: { id: { in: partnerIds } },
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
    partnerDetailsById = new Map(partners.map((p) => [p.id, partnerTileDetails(p)]));
  }

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
    const { subject, html, text } = renderDigestEmail(
      blurbs,
      churchSettings,
      unsubscribeUrl,
      recipient.name,
      partnerDetailsById
    );
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

module.exports = {
  sendPendingNotificationsDigest,
  buildUnsubscribeToken,
  buildUnsubscribeUrl,
  renderDigestEmail,
  escapeHtml,
  partnerTileDetails,
};
