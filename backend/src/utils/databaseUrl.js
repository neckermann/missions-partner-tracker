// Turns DATABASE_URL into discrete pg connection fields. Lives here (not
// inline in prismaClient.js) because whatsappClient.js needs the exact same
// parsing for its dedicated advisory-lock connection -- see the long
// comment below for why the raw connection string isn't passed straight
// through.
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

module.exports = { parseDatabaseUrl };
