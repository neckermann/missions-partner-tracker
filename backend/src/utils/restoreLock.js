// While an in-app restore runs, the site must not accept any other change: a save that lands halfway through
// would be wiped or collide with the rows being put back. One restore at a time, and every other write is
// answered "try again in a minute" until it finishes (see server.js's refuseWritesDuringRestore).
let running = false;

// Returns true when this caller now holds the lock, false when a restore is already running.
function beginRestore() {
  if (running) return false;
  running = true;
  return true;
}

function endRestore() {
  running = false;
}

function isRestoreRunning() {
  return running;
}

// Express middleware: reads are fine; any other method on the API waits, except the restore call itself
// (which holds the lock and must not refuse itself).
function refuseWritesDuringRestore(req, res, next) {
  if (!running) return next();
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.originalUrl.startsWith("/api/backups/restore")) return next();
  res.set("Retry-After", "60");
  return res.status(503).json({
    error:
      "The site is being restored from a backup and can't save changes right now. Try again in a minute.",
  });
}

module.exports = { beginRestore, endRestore, isRestoreRunning, refuseWritesDuringRestore };
