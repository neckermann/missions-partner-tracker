// #386 Layer 2: passwordless sign-in, a church-wide switch (ChurchSettings.requirePasswordless).
// Everything that decides "is it on", "can it be turned on", and the emailed sign-in link lives
// here; the routes are in routes/auth.js and routes/passkeys.js.
const prisma = require("../prismaClient");
const { isDemoDeployment } = require("./demoMode");
const { isFeatureEnabled } = require("./features");
const { appBaseUrl } = require("./dispatchBlurbs");
const { hashToken, generateToken } = require("./passwordSetup");

const LINK_TTL_MINUTES = 15;

// Never on a public demo (shared logins, no email), whatever a leftover value says.
async function isPasswordlessOn(db = prisma) {
  if (isDemoDeployment()) return false;
  const settings = await db.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { requirePasswordless: true },
  });
  return settings?.requirePasswordless === true;
}

// Whether this site can email a sign-in link at all: outbound email on, a sender configured, and
// an address to build the link from. The first sign-in and every recovery depends on it.
async function isEmailReady(db = prisma) {
  const settings = await db.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true, postmarkServerToken: true, emailFromAddress: true },
  });
  return Boolean(
    isFeatureEnabled(settings?.enabledFeatures, "outboundEmail") &&
    settings?.postmarkServerToken &&
    settings?.emailFromAddress &&
    appBaseUrl()
  );
}

// Why it can't be turned on right now, or null when it can. `actingUserId` is the admin turning it
// on: they need a passkey of their own, or the next sign-in locks them out.
async function passwordlessBlocker(actingUserId, db = prisma) {
  if (isDemoDeployment()) return "Passwordless sign-in can't be turned on for the public demo";
  if (!(await isEmailReady(db))) {
    return "Turn on outbound email and finish setting it up first (Settings → Email): people without a passkey sign in through an emailed link";
  }
  const mine = await db.userPasskey.count({ where: { userId: actingUserId } });
  if (mine === 0) {
    return "Add a passkey to your own account first (My account), so turning this on doesn't lock you out";
  }
  return null;
}

function buildSignInUrl(token) {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/login/link?token=${encodeURIComponent(token)}`;
}

// A fresh link for the user; deletes their older unused ones so at most one is live. The raw
// token exists only in this return value.
async function issueSignInLink(user, now = new Date()) {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + LINK_TTL_MINUTES * 60 * 1000);
  await prisma.$transaction([
    prisma.signInLinkToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.signInLinkToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } }),
  ]);
  return { token, expiresAt };
}

// Spends a link: returns the user if the token is real, unused and unexpired, else null. Marking it
// used is a single conditional update, so two people racing on one link can't both win.
async function redeemSignInLink(token, now = new Date()) {
  if (!token || typeof token !== "string") return null;
  const row = await prisma.signInLinkToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!row || row.usedAt || row.expiresAt <= now) return null;
  const claimed = await prisma.signInLinkToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return null;
  const user = row.user;
  if (!user || !user.active || user.authProvider !== "local") return null;
  return user;
}

// The emailed link itself.
async function sendSignInLinkEmail(user) {
  const { renderEmail, blocks } = require("./emailTemplate");
  const { sendEmail } = require("./email");
  const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  const { token } = await issueSignInLink(user);
  const url = buildSignInUrl(token);
  if (!url) throw new Error("APP_BASE_URL isn't set, so a sign-in link can't be built");
  const church = settings?.churchName || "the missions tracker";
  const message = renderEmail({
    settings,
    subject: `Your sign-in link for ${church}`,
    eyebrow: "Sign in",
    greetingName: user.firstName,
    blocks: [
      blocks.paragraph(`Use this button to sign in to ${church}'s missions tracker.`),
      blocks.button(url, "Sign in"),
      blocks.note(
        `This link works once and expires in ${LINK_TTL_MINUTES} minutes. After you sign in you'll be asked to add a passkey, so next time you can sign in with your fingerprint, face or screen lock.`
      ),
    ],
    footerNote: "Didn't ask for this? You can safely ignore it -- nobody can sign in without the link.",
  });
  await sendEmail({ to: user.email, ...message });
}

module.exports = {
  LINK_TTL_MINUTES,
  isPasswordlessOn,
  isEmailReady,
  passwordlessBlocker,
  buildSignInUrl,
  issueSignInLink,
  redeemSignInLink,
  sendSignInLinkEmail,
};
