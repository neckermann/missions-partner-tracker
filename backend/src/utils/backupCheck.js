// Recognizes a handful of known Postgres providers by DATABASE_URL's
// hostname, purely to tailor the admin-dashboard backup reminder's
// message (see routes/backupCheck.js and BackupReminder.jsx) -- never
// exposes the actual URL, just this coarse guess.
function detectProvider() {
  const url = process.env.DATABASE_URL || "";
  if (/neon\.tech/i.test(url)) return "neon";
  if (/supabase\.co/i.test(url)) return "supabase";
  if (/rds\.amazonaws\.com/i.test(url)) return "rds";
  return "other";
}

module.exports = { detectProvider };
