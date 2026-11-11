// Public-only digest content building -- narrow function signatures, no
// source-link parameter at all, mirroring adminEmailDispatchContent.js's role
// for symmetry. The structural guarantee this plan calls for: the
// per-item renderer below only ever destructures { emoji, summary,
// bodyText } from a blurb -- sourceLinkUrl/sourceFileId are not
// parameters that exist here, not just values that happen to go
// unused. A future edit can't accidentally introduce a link without
// first widening this function's own signature, which is a much
// louder, more reviewable change than adding a line inside it.
const { escapeHtml, nl2br, typeLabel } = require("./emailDispatchShell");

// Groups a public subscriber's eligible prayer-request blurbs by
// partner -- simpler than adminEmailDispatchContent.js's own groupByPartner,
// since the public audience never gets newsletterCreated rows to nest
// anything under (only prayer-request types are ever eligible here).
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

// Deliberately takes only { emoji, summary, bodyText } -- see the file
// header comment.
function renderItemHtml({ emoji, summary, bodyText }, highlightColor) {
  return `
    <div style="margin:14px 0;">
      ${typeLabel(`${emoji} ${summary}`, highlightColor)}
      <p style="margin:6px 0 0;color:#444;line-height:1.55;">${nl2br(bodyText)}</p>
    </div>`;
}

function renderPartnerHtml(group, highlightColor, tile) {
  const metaLine = [
    tile?.fieldDisplayName,
    tile?.supportingSinceYear && `Supporting since ${tile.supportingSinceYear}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const itemsHtml = group.items
    .map((b) => renderItemHtml(b, highlightColor))
    .join('<div style="border-top:1px solid #eeeeee;margin:14px 0;"></div>');

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
  for (const { emoji, summary, bodyText } of group.items) {
    lines.push(`${emoji} ${summary}: ${bodyText}`);
  }
  lines.push("");
  return lines;
}

function buildPublicEmailDispatchContent(blurbs, partnerDetailsById, churchSettings) {
  const groups = groupByPartnerForPublic(blurbs);
  const highlightColor = churchSettings?.highlightColor || "#a6540f";
  const itemsHtml = groups
    .map((g) => renderPartnerHtml(g, highlightColor, partnerDetailsById?.get(g.partnerId)))
    .join("");
  const textLines = groups.flatMap((g) => renderPartnerText(g, partnerDetailsById?.get(g.partnerId)));
  return { itemsHtml, textLines, subtitleLine: "Prayer Updates" };
}

module.exports = { buildPublicEmailDispatchContent, groupByPartnerForPublic };
