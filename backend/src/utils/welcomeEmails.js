// Welcome email for a new account: a secure "set your password" button,
// the right guide links for the account type, and (when MFA is required)
// a plain-language heads-up about the authenticator app they'll need.
// Rendered in the same branded shell as the digests
// (emailDispatchShell.js's buildTransactionalMessage) so it looks like
// everything else this church sends.
//
// Guide URLs point at this project's own published docs site (the
// GitHub Pages-rendered guide, not a raw GitHub blob -- see
// docs/user-guide.html and docs/assets/guide.js: that page reimplements
// GitHub's own heading-slug algorithm specifically so these #anchor
// fragments resolve identically there) -- not configurable per fork.
// These are this project's own documentation, not church-specific
// branding, so there's no "keep forks upgradable" reason to make them an
// env var or a ChurchSettings field (see issue #303).
const { renderEmail, blocks } = require("./emailTemplate");
const { buildSetupUrl, setupTtlHours, RESET_TTL_HOURS } = require("./passwordSetup");

const DOCS_BASE = "https://missionspartnertracker.com";
const USER_GUIDE_URL = `${DOCS_BASE}/user-guide.html`;
const GUEST_GUIDE_URL = `${DOCS_BASE}/user-guide.html#understanding-your-role`;
const MFA_HELP_URL = `${DOCS_BASE}/user-guide.html#your-account-settings`;
const SUPPORT_URL = "https://github.com/neckermann/missions-partner-tracker/issues";

// { label, url } pairs for the guides relevant to this role.
function guideLinks(role) {
  const links =
    role === "guest"
      ? [
          ["Guest guide", GUEST_GUIDE_URL],
          ["Support and help", SUPPORT_URL],
        ]
      : [
          ["User guide", USER_GUIDE_URL],
          ["Support and help", SUPPORT_URL],
        ];
  links.push(["Setting up two-factor authentication", MFA_HELP_URL]);
  return links.map(([label, url]) => ({ label, url }));
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
function buildWelcomeEmail({ user, setupUrl, expiresInHours, settings, requireMfa }) {
  const church = settings?.churchName || "the missions tracker";
  const isGuest = user.role === "guest";
  const intro = isGuest
    ? `You've been given guest access to ${church} so you can help with the trips and partners you've been assigned.`
    : `You've been given an account on ${church}'s missions tracker.`;
  const expiry = describeExpiry(expiresInHours);
  const guides = guideLinks(user.role);

  return renderEmail({
    settings,
    subject: `Set up your ${settings?.churchName ? `${settings.churchName} ` : ""}missions tracker account`,
    eyebrow: isGuest ? "Guest account" : "Account setup",
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
  // #386 Layer 2: with passwordless sign-in on there is no password to choose, so the new person
  // gets a sign-in link instead (and adds a passkey after it).
  const { isPasswordlessOn, sendSignInLinkEmail } = require("./passwordless");
  if (await isPasswordlessOn()) return sendSignInLinkEmail(user);
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

// Pure. The email for "I forgot my password": a one-hour link that lets the person choose a new
// one. Signing in afterwards still asks for their second factor, if they have one.
function buildPasswordResetEmail({ user, resetUrl, expiresInHours, settings }) {
  const church = settings?.churchName || "the missions tracker";
  return renderEmail({
    settings,
    subject: `Reset your ${settings?.churchName ? `${settings.churchName} ` : ""}missions tracker password`,
    eyebrow: "Password reset",
    greetingName: user.firstName,
    blocks: [
      blocks.paragraph(
        `Someone asked to reset the password for your account on ${church}'s missions tracker.`
      ),
      blocks.button(resetUrl, "Choose a new password"),
      blocks.note(
        `This link works once and expires in ${describeExpiry(expiresInHours)}. Other devices signed in to your account will be signed out when you choose a new password.`
      ),
    ],
    footerNote:
      "Didn't ask for this? You can safely ignore it -- your password has not changed and nobody can sign in with this email alone.",
  });
}

// Issues a one-hour reset link and emails it. Throws if email isn't configured or APP_BASE_URL is
// unset; the route that calls it swallows that so the reply never reveals whether an account exists.
async function sendPasswordResetEmail(user) {
  const prisma = require("../prismaClient");
  const { sendEmail } = require("./email");
  const { issueSetupToken } = require("./passwordSetup");
  if (!buildSetupUrl("probe")) {
    const err = new Error("APP_BASE_URL isn't set, so a reset link can't be built");
    err.status = 400;
    throw err;
  }
  const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  const { token } = await issueSetupToken(user, new Date(), { ttlHours: RESET_TTL_HOURS });
  const message = buildPasswordResetEmail({
    user,
    resetUrl: buildSetupUrl(token),
    expiresInHours: RESET_TTL_HOURS,
    settings,
  });
  await sendEmail({ to: user.email, ...message });
}

module.exports = {
  buildWelcomeEmail,
  buildPasswordResetEmail,
  guideLinks,
  sendWelcomeEmail,
  sendPasswordResetEmail,
};
