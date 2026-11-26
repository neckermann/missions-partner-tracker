// Who is making the current request, for code with no `req` (the Prisma extension
// in prismaClient.js that stamps "last edited by"). requireAuth runs the request
// inside `actorStore.run(...)`. Outside a request (seed, scheduled jobs, scripts) there is
// no actor and nothing is stamped.
const { AsyncLocalStorage } = require("node:async_hooks");

const actorStore = new AsyncLocalStorage();

const displayName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || u?.email || null;

function currentActor() {
  return actorStore.getStore() || null;
}

module.exports = { actorStore, currentActor, displayName };
