// The server-rendered HTML page shown after clicking a confirm or unsubscribe link
// in a digest email (a page, not JSON, since it's a click from email). Shared by
// publicSubscribe.js and publicUnsubscribe.js; same pattern as routes/auth.js's GET /unsubscribe.
const prisma = require("../prismaClient");
const { appBaseUrl } = require("./dispatchBlurbs");

const PRIVACY_LINE =
  "Your email is used only to send these updates -- we never share it with anyone else, and you can unsubscribe anytime.";

// Under "You've been unsubscribed": the privacy line would tell someone who has just left that they can
// unsubscribe anytime.
const UNSUBSCRIBED_LINE = "Your email address has been removed. We won't send you these updates again.";

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// footerLine defaults to the subscriber-digest privacy line; another click-from-email
// page (e.g. the meeting-RSVP page) passes its own, or "" to omit the footer.
//
// `message` is a plain string, or a (highlightColor) => string function for a
// caller that needs the brand color inline without a second settings query.
async function renderSubscriberPage(message, footerLine = PRIVACY_LINE, title = "Prayer updates") {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      churchName: true,
      headerColor: true,
      highlightColor: true,
      logoContentType: true,
      brandFont: true,
    },
  });
  const churchName = settings?.churchName || "Missions Partner Tracker";
  const headerColor = settings?.headerColor || "#2c2a28";
  const highlightColor = settings?.highlightColor || "#a6540f";
  const fontFamily =
    settings?.brandFont || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const base = appBaseUrl();
  const logoHtml =
    settings?.logoContentType && base
      ? `<img src="${base}/api/public/settings/logo/raw" alt="${escapeHtml(churchName)}" style="max-height:40px;width:auto;max-width:240px;margin-bottom:10px;">`
      : "";
  const footerHtml = footerLine
    ? `<p style="margin:0;font-size:12px;color:#888;line-height:1.4;">${escapeHtml(footerLine)}</p>`
    : "";
  const body = typeof message === "function" ? message(highlightColor) : message;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="font-family:${escapeHtml(fontFamily)};background:#f7f5f0;margin:0;padding:40px 16px;">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
  <div style="background-color:${headerColor};padding:28px 24px;text-align:center;">
    ${logoHtml}
    <h2 style="margin:0;color:#ffffff;font-size:18px;">${escapeHtml(churchName)}</h2>
  </div>
  <div style="padding:32px 24px;text-align:center;color:#222;">
    <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">${body}</p>
    ${footerHtml}
  </div>
</div>
</body></html>`;
}

module.exports = { renderSubscriberPage, escapeHtml, PRIVACY_LINE, UNSUBSCRIBED_LINE };
