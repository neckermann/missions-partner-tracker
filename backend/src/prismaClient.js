const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

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
function parseDatabaseUrl(connectionString) {
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    // Neon/Azure etc. require TLS (sslmode=require in the URL); a bare
    // local Postgres has no sslmode param at all, so this stays undefined
    // (no TLS) rather than defaulting one way for every environment.
    ssl: url.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : undefined,
  };
}

const adapter = new PrismaPg(parseDatabaseUrl(process.env.DATABASE_URL));

// Single shared Prisma instance (avoids exhausting DB connections in dev
// with hot-reload).
const prisma = global.__prisma || new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

module.exports = prisma;
