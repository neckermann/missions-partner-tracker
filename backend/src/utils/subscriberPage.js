// The raw, server-rendered HTML page shown after clicking a confirm or
// unsubscribe link from a scoped-digest email (#202) -- same pattern
// routes/auth.js's existing GET /unsubscribe already uses for User
// recipients, shared here since publicSubscribe.js (confirm) and
// publicUnsubscribe.js (unsubscribe) both need the identical branded
// shell. A link clicked from an email, not an API call, so it's a page,
// not JSON.
const prisma = require("../prismaClient");
const { appBaseUrl } = require("./dispatchBlurbs");

const PRIVACY_LINE =
  "Your email is used only to send these updates -- we never share it with anyone else, and you can unsubscribe anytime.";

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

async function renderSubscriberPage(message) {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { churchName: true, headerColor: true, logoContentType: true, brandFont: true },
  });
  const churchName = settings?.churchName || "Missions Partner Tracker";
  const headerColor = settings?.headerColor || "#2c2a28";
  const fontFamily =
    settings?.brandFont || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const base = appBaseUrl();
  const logoHtml =
    settings?.logoContentType && base
      ? `<img src="${base}/api/public/settings/logo/raw" alt="${escapeHtml(churchName)}" style="max-height:40px;width:auto;max-width:240px;margin-bottom:10px;">`
      : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Prayer updates</title></head>
<body style="font-family:${fontFamily};background:#f7f5f0;margin:0;padding:40px 16px;">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
  <div style="background-color:${headerColor};padding:28px 24px;text-align:center;">
    ${logoHtml}
    <h2 style="margin:0;color:#ffffff;font-size:18px;">${escapeHtml(churchName)}</h2>
  </div>
  <div style="padding:32px 24px;text-align:center;color:#222;">
    <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">${message}</p>
    <p style="margin:0;font-size:12px;color:#888;line-height:1.4;">${escapeHtml(PRIVACY_LINE)}</p>
  </div>
</div>
</body></html>`;
}

module.exports = { renderSubscriberPage, escapeHtml, PRIVACY_LINE };
