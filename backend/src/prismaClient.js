const { PrismaClient } = require("@prisma/client");
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

// Single shared Prisma instance (avoids exhausting DB connections in dev
// with hot-reload).
const prisma = global.__prisma || new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

module.exports = prisma;
