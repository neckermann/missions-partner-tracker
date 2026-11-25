// The church-wide two-factor requirement (ChurchSettings.requireTwoFactor): one
// switch for every account, read fresh each time so changes take effect at once.
const prisma = require("../prismaClient");
const { isDemoDeployment } = require("./demoMode");

// Never on a public demo: its accounts are shared and have no authenticator, and the settings
// route refuses to turn it on there; this also covers a value left over from before.
//
// Passwordless sign-in implies it: with no password, a passkey is the factor.
async function isTwoFactorRequired(db = prisma) {
  if (isDemoDeployment()) return false;
  const settings = await db.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { requireTwoFactor: true, requirePasswordless: true },
  });
  return settings?.requireTwoFactor === true || settings?.requirePasswordless === true;
}

module.exports = { isTwoFactorRequired };
