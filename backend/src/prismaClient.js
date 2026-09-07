const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

// Prisma 7 requires a driver adapter for every database, not just some --
// see prisma.config.js's comment for why the connection string itself
// lives in an env var read here directly, not in schema.prisma anymore.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Single shared Prisma instance (avoids exhausting DB connections in dev
// with hot-reload).
const prisma = global.__prisma || new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

module.exports = prisma;
