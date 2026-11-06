// Admin-only digest content building -- source links, newsletter blocks
// with titles, nesting a request/need under the newsletter it was
// sourced from. Renamed from emailDigest.js: that name suggested it
// owned "the email digest" generally, which stopped being true once the
// public digest got its own content-builder (publicDigestContent.js).
const { escapeHtml, nl2br, typeLabel, brandButton } = require("./digestShell");

// Groups blurbs by partner, and within each partner, nests a
// request/need under the newsletter blurb it was sourced from when that
// newsletter is also in this batch.
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

function renderBlurbHtml(blurb, accentColor, highlightColor) {
  const amountLine = blurb.amount
    ? `<p style="margin:8px 0 0;font-weight:600;color:#444;">${escapeHtml(blurb.amountLabel || "Approved")}: ${escapeHtml(blurb.amount)}</p>`
    : "";
  const noteLine = blurb.decisionNote
    ? `<p style="margin:4px 0 0;color:#666;font-size:13px;font-style:italic;">${escapeHtml(blurb.decisionNote)}</p>`
    : "";
  const link = blurb.sourceLinkUrl
    ? `<p style="margin:0;">${brandButton(blurb.sourceLinkUrl, "Read the source", accentColor)}</p>`
    : "";
  return `
    <div style="margin:14px 0;">
      ${typeLabel(`${blurb.emoji} ${blurb.summary}`, highlightColor)}
      <p style="margin:6px 0 0;color:#444;line-height:1.55;">${nl2br(blurb.bodyText)}</p>
      ${amountLine}
      ${noteLine}
      ${link}
    </div>`;
}

// The newsletter block's own title line (new -- see buildBlurb's
// newsletterCreated case in notificationBlurbs.js) renders right under
// the "New Newsletter" label, above the "Read the full newsletter"
// button. Masked to nothing for a restricted partner's newsletter, same
// as every other identifying field on that row.
function renderNewsletterBlock(blurb, children, accentColor, highlightColor) {
  return `
    <div style="margin:0;">
      ${typeLabel(`${blurb.emoji} New Newsletter`, highlightColor)}
      ${blurb.title ? `<p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#222;">${escapeHtml(blurb.title)}</p>` : ""}
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

  const topLevelItems = [
    ...group.newsletters.map(({ blurb, children }) =>
      renderNewsletterBlock(blurb, children, accentColor, highlightColor)
    ),
    ...group.standalone.map((b) => renderBlurbHtml(b, accentColor, highlightColor)),
  ];
  const itemsHtml = topLevelItems.join('<div style="border-top:1px solid #eeeeee;margin:14px 0;"></div>');

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

  return `
    <div style="margin:20px 0;padding:22px 24px;background-color:#ffffff;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.06);">
      ${header}
      ${itemsHtml}
      ${headerClose}
    </div>`;
}

function renderPartnerText(group, tile) {
  const lines = [group.partnerName, "-".repeat(group.partnerName.length)];
  const metaLine = [
    tile?.fieldDisplayName,
    tile?.supportingSinceYear && `Supporting since ${tile.supportingSinceYear}`,
  ]
    .filter(Boolean)
    .join(" · ");
  if (metaLine) lines.push(metaLine);
  if (tile?.overviewShort) lines.push(tile.overviewShort);
  for (const { blurb, children } of group.newsletters) {
    lines.push(
      `${blurb.emoji} New newsletter${blurb.title ? `: ${blurb.title}` : ""}${blurb.sourceLinkUrl ? ` -- ${blurb.sourceLinkUrl}` : ""}`
    );
    for (const child of children) {
      lines.push(`  ${child.emoji} ${child.summary}: ${child.bodyText}`);
      if (child.amount) lines.push(`    ${child.amountLabel || "Approved"}: ${child.amount}`);
      if (child.decisionNote) lines.push(`    ${child.decisionNote}`);
    }
  }
  for (const blurb of group.standalone) {
    lines.push(`${blurb.emoji} ${blurb.summary}: ${blurb.bodyText}`);
    if (blurb.amount) lines.push(`  ${blurb.amountLabel || "Approved"}: ${blurb.amount}`);
    if (blurb.decisionNote) lines.push(`  ${blurb.decisionNote}`);
  }
  lines.push("");
  return lines;
}

// `eligibleRows` are the NotifiableEvent rows already filtered through
// isEligibleForChannel for CHANNELS.ADMIN_DIGEST, already turned into
// blurbs via buildBlurb (notificationBlurbs.js) by the caller
// (digestDelivery.js). `tile` lookup is partnerDetailsById -- undefined
// entries fall back to the classic, tile-less layout.
function buildAdminDigestContent(blurbs, partnerDetailsById, churchSettings) {
  const groups = groupByPartner(blurbs);
  const accentColor = churchSettings?.primaryColor || "#2a5d3c";
  const highlightColor = churchSettings?.highlightColor || "#a6540f";
  const itemsHtml = groups
    .map((g) => renderPartnerHtml(g, accentColor, highlightColor, partnerDetailsById?.get(g.partnerId)))
    .join("");
  const textLines = groups.flatMap((g) => renderPartnerText(g, partnerDetailsById?.get(g.partnerId)));
  const subtitleLine = `${churchSettings?.partnerTermPlural || "Missionaries"} Updates`;
  return { itemsHtml, textLines, subtitleLine };
}

module.exports = { buildAdminDigestContent, groupByPartner };
