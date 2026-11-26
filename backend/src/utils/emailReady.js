// "Email (Sending) is on" is not the same as "this site can send email": the toggle can be switched on
// before a Postmark account and sender address are entered. Anything that chooses between sending an
// email and a fallback (copy a link, say nothing was sent) asks here, not at the toggle alone.
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");

const READY_SELECT = { enabledFeatures: true, postmarkServerToken: true, emailFromAddress: true };

// `settings` needs enabledFeatures, postmarkServerToken and emailFromAddress (READY_SELECT).
function isOutboundEmailReady(settings) {
  return Boolean(
    isFeatureEnabled(settings?.enabledFeatures, "outboundEmail") &&
    settings?.postmarkServerToken &&
    settings?.emailFromAddress
  );
}

async function loadOutboundEmailReady() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: READY_SELECT,
  });
  return isOutboundEmailReady(settings);
}

// The toggle is on but sending can't work yet: what the admin notice is about.
function isOutboundEmailUnfinished(settings) {
  return isFeatureEnabled(settings?.enabledFeatures, "outboundEmail") && !isOutboundEmailReady(settings);
}

module.exports = { READY_SELECT, isOutboundEmailReady, loadOutboundEmailReady, isOutboundEmailUnfinished };
