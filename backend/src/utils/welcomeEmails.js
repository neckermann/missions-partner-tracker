// Welcome email for a new account: a secure "set your password" button,
// the right guide links for the account type, and (when MFA is required)
// a plain-language heads-up about the authenticator app they'll need.
// Rendered in the same branded shell as the digests
// (emailDispatchShell.js's buildTransactionalMessage) so it looks like
// everything else this church sends.
//
// Guide URLs come from env (not hardcoded, so forks point at their own
// docs) and are simply left out when unset -- the guides may not exist
// until the related features ship, and a missing link beats a broken one.
const { renderEmail, blocks } = require("./emailTemplate");
const { buildSetupUrl, setupTtlHours } = require("./passwordSetup");

function cleanUrl(value) {
  const v = String(value || "").trim();
  return /^https?:\/\//i.test(v) ? v : null;
}

// { label, url } pairs for the guides relevant to this role.
function guideLinks(role, env = process.env) {
  const links =
    role === "tripLeader"
      ? [
          ["Trip Leader guide", env.TRIP_LEADER_GUIDE_URL],
          ["Support and help", env.SUPPORT_URL],
        ]
      : [
          ["User guide", env.USER_GUIDE_URL],
          ["Support and help", env.SUPPORT_URL],
        ];
  links.push(["Setting up two-factor authentication", env.MFA_HELP_URL]);
  return links.map(([label, url]) => ({ label, url: cleanUrl(url) })).filter((l) => l.url);
}

function describeExpiry(hours) {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "1 day" : `${days} days`;
  }
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

// Pure -- no I/O -- so it's unit-testable. `settings` is the ChurchSettings
// row (or null). Returns { subject, html, text }.
function buildWelcomeEmail({ user, setupUrl, expiresInHours, settings, requireMfa, env = process.env }) {
  const church = settings?.churchName || "the missions tracker";
  const isLeader = user.role === "tripLeader";
  const intro = isLeader
    ? `You've been given Trip Leader access to ${church} so you can help manage your trip.`
    : `You've been given an account on ${church}'s missions tracker.`;
  const expiry = describeExpiry(expiresInHours);
  const guides = guideLinks(user.role, env);

  return renderEmail({
    settings,
    subject: `Set up your ${settings?.churchName ? `${settings.churchName} ` : ""}missions tracker account`,
    eyebrow: isLeader ? "Trip Leader account" : "Account setup",
    greetingName: user.firstName,
    blocks: [
      blocks.paragraph(intro),
      blocks.button(setupUrl, "Choose your password"),
      blocks.note(
        `This link works once and expires in ${expiry}. If it expires, you can request a new one from the sign-in page.`
      ),
      requireMfa
        ? blocks.paragraph(
            "After you choose a password you'll be asked to set up two-factor authentication. You'll need an authenticator app on your phone -- we'll walk you through choosing and installing one."
          )
        : null,
      blocks.links("Helpful links:", guides),
    ],
    footerNote:
      "Didn't expect this email? You can safely ignore it -- no account is active until you choose a password.",
  });
}

// Issues a fresh setup link and emails it. Throws if email isn't
// configured or APP_BASE_URL is unset (nothing clickable to send); callers
// catch and report that so the account itself is never lost to a mail
// failure.
async function sendWelcomeEmail(user, { requireMfa = false } = {}) {
  // Required lazily so the pure builders above stay unit-testable without a
  // generated Prisma client / database.
  const prisma = require("../prismaClient");
  const { sendEmail } = require("./email");
  const { issueSetupToken } = require("./passwordSetup");
  if (!buildSetupUrl("probe")) {
    const err = new Error("APP_BASE_URL isn't set, so a setup link can't be built");
    err.status = 400;
    throw err;
  }
  const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  const { token } = await issueSetupToken(user);
  const message = buildWelcomeEmail({
    user,
    setupUrl: buildSetupUrl(token),
    expiresInHours: setupTtlHours(user.role),
    settings,
    requireMfa,
  });
  await sendEmail({ to: user.email, ...message });
}

module.exports = { buildWelcomeEmail, guideLinks, sendWelcomeEmail };
