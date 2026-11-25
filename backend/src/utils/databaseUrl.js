// Turns DATABASE_URL into discrete pg connection fields. Shared with
// whatsappClient.js's advisory-lock connection.
//
// Passing { connectionString } straight through hits a bug in this pg/
// @prisma/adapter-pg combination: the SASL/SCRAM handshake fails with "client
// password must be a string" even with correct credentials (a bare `pg.Client`
// with the same URL works). Discrete fields avoid it.
function parseDatabaseUrl(connectionString) {
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    // Neon/Azure etc. require TLS (sslmode=require); a bare local Postgres has no
    // sslmode, so this stays undefined (no TLS) rather than defaulting one way.
    ssl: url.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : undefined,
  };
}

module.exports = { parseDatabaseUrl };
