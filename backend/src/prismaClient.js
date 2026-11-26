const { PrismaClient, Prisma } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { parseDatabaseUrl } = require("./utils/databaseUrl");

// Prisma 7 requires a driver adapter for every database; the connection string
// lives in an env var read here (see prisma.config.js).
//
// Passing { connectionString } straight through hits a bug in this pg/
// @prisma/adapter-pg combination: the SASL/SCRAM handshake fails with "client
// password must be a string" even with correct credentials. Passing the same
// credentials as discrete fields avoids it.
const adapter = new PrismaPg(parseDatabaseUrl(process.env.DATABASE_URL));

// "Last edited by": every write to a tracked model (any model with a
// lastEditedById column; see schema.prisma) made during a person's request is
// stamped with who and when, here in one place, so no route has to remember. The
// actor comes from utils/actorContext.js, set by requireAuth. With no actor (the
// seed, scheduled jobs, public submissions) nothing is stamped.
//
// Only the row written directly is stamped, not children touched by a nested write.
const { currentActor } = require("./utils/actorContext");
const TRACKED_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "lastEditedById"))
    .map((m) => m.name)
);
const withStamp = (data, stamp) =>
  Array.isArray(data) ? data.map((d) => ({ ...d, ...stamp })) : { ...data, ...stamp };

function stampLastEdited(base) {
  return base.$extends({
    name: "lastEditedBy",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const actor = currentActor();
          if (!actor || !TRACKED_MODELS.has(model)) return query(args);
          const stamp = { lastEditedById: actor.id, lastEditedByName: actor.name, lastEditedAt: new Date() };
          switch (operation) {
            case "create":
            case "createMany":
            case "createManyAndReturn":
            case "update":
            case "updateMany":
            case "updateManyAndReturn":
              return query({ ...args, data: withStamp(args.data, stamp) });
            case "upsert":
              return query({
                ...args,
                create: withStamp(args.create, stamp),
                update: withStamp(args.update, stamp),
              });
            default:
              return query(args);
          }
        },
      },
    },
  });
}

// Single shared Prisma instance (avoids exhausting DB connections in dev with hot-reload).
const prisma = global.__prisma || stampLastEdited(new PrismaClient({ adapter }));
if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

module.exports = prisma;
