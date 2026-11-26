// A person added to the missions team starts on the church's default email digest tier (if it has one and the
// tier is offered), covering the partners they look after. Only people with no digest yet are touched, so it
// never changes someone's own choice, and a guest is never subscribed automatically.

const prisma = require("../prismaClient");

const TIER_FLAG = {
  biweekly: "cadenceBiweeklyEnabled",
  monthly: "cadenceMonthlyEnabled",
  quarterly: "cadenceQuarterlyEnabled",
};

async function subscribeToDefaultDigest(userIds) {
  if (!userIds || userIds.length === 0) return 0;
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      defaultDigestCadence: true,
      cadenceBiweeklyEnabled: true,
      cadenceMonthlyEnabled: true,
      cadenceQuarterlyEnabled: true,
    },
  });
  const tier = settings?.defaultDigestCadence;
  if (!tier || !TIER_FLAG[tier] || !settings[TIER_FLAG[tier]]) return 0;
  const result = await prisma.user.updateMany({
    where: { id: { in: userIds }, cadence: null, active: true, role: { not: "guest" } },
    data: { cadence: tier, digestScope: "owned" },
  });
  return result.count;
}

module.exports = { subscribeToDefaultDigest };
