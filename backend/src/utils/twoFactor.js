// The church-wide two-factor requirement (#385): ChurchSettings.requireTwoFactor. One switch for
// every account, whatever its role; read fresh each time (a single-row lookup, like the user
// lookup requireAuth already does per request) so turning it on or off takes effect at once.
const prisma = require("../prismaClient");

async function isTwoFactorRequired(db = prisma) {
  const settings = await db.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { requireTwoFactor: true },
  });
  return settings?.requireTwoFactor === true;
}

module.exports = { isTwoFactorRequired };
