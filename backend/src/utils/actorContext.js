// Who is making the current request, available to code that has no `req` -- in
// particular the Prisma client extension (prismaClient.js) that stamps "last
// edited by" on a record (#341). requireAuth runs the rest of the request
// inside `actorStore.run(...)`, so every query it triggers sees the same actor.
// Outside a request (the seed, the worker's schedulers, a script) there is no
// actor and nothing is stamped -- a background job editing a row doesn't
// pretend a person did.
const { AsyncLocalStorage } = require("node:async_hooks");

const actorStore = new AsyncLocalStorage();

const displayName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || u?.email || null;

function currentActor() {
  return actorStore.getStore() || null;
}

module.exports = { actorStore, currentActor, displayName };
