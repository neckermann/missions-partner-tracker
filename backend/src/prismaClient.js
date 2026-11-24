const { PrismaClient, Prisma } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { parseDatabaseUrl } = require("./utils/databaseUrl");

// Prisma 7 requires a driver adapter for every database, not just some --
// see prisma.config.js's comment for why the connection string itself
// lives in an env var read here directly, not in schema.prisma anymore.
//
// Passing { connectionString } straight through hits a real bug in this
// pg/@prisma/adapter-pg combination: the pool's SASL/SCRAM handshake fails
// with "client password must be a string" even with correct credentials --
// confirmed by connecting with the exact same URL via a bare `pg.Client`
// (works) vs this adapter given the raw string (fails every time). Passing
// the same credentials as discrete fields instead sidesteps whatever is
// going wrong in the adapter's own connectionString parsing, and is the
// one difference between a failing and a working connection here.
const adapter = new PrismaPg(parseDatabaseUrl(process.env.DATABASE_URL));

// "Last edited by" (#341): every write to a tracked model (any model with a
// lastEditedById column -- see schema.prisma) made while a person's request is
// running is stamped with who they are and when, here in one place, so no
// route has to remember to and a new model gets it by declaring the three
// columns. The actor comes from utils/actorContext.js, set by requireAuth.
// With no actor (the seed, the worker's jobs, a public submission) nothing is
// stamped and the existing value is left alone.
//
// Only the row written directly is stamped: a nested create inside a partner
// update stamps the partner, not each child row it touched.
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

// Single shared Prisma instance (avoids exhausting DB connections in dev
// with hot-reload).
const prisma = global.__prisma || stampLastEdited(new PrismaClient({ adapter }));
if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

module.exports = prisma;
