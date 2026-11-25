// Recognizes known Postgres providers by DATABASE_URL's hostname, only to tailor the
// backup reminder's message; never exposes the URL.
function detectProvider() {
  const url = process.env.DATABASE_URL || "";
  if (/neon\.tech/i.test(url)) return "neon";
  if (/supabase\.co/i.test(url)) return "supabase";
  if (/rds\.amazonaws\.com/i.test(url)) return "rds";
  return "other";
}

module.exports = { detectProvider };
