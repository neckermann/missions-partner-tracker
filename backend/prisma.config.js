// Prisma 7 moved the database connection URL out of schema.prisma's
// datasource block (see the comment there) and into this file instead --
// this is what `prisma migrate`/`studio`/etc. read for DATABASE_URL now.
// Prisma 7 also stopped auto-loading .env, hence the explicit dotenv
// require below (application code still gets .env loaded independently,
// via server.js's own `require("dotenv").config()`).
require("dotenv").config({ quiet: true });
const { defineConfig, env } = require("prisma/config");

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
