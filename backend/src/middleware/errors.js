// The one place an error becomes an HTTP response.
//
// Two invariants hold for every response this produces:
//
//   1. `error` is ALWAYS a string. Never an array, never an object. The
//      frontend renders it straight into JSX, so anything else throws
//      "Objects are not valid as a React child" and unmounts the page. That
//      is exactly what used to happen: routes returned Zod's `err.issues`
//      array, and every form that hit a validation error white-screened.
//
//   2. Only deliberate, controlled errors say anything specific. An
//      unexpected exception collapses to "Server error", because a raw
//      Prisma or JS message can leak schema and column names to any caller,
//      including unauthenticated ones on the public API.
//
// Routes should not catch errors just to translate them. Express 5 forwards
// a rejected promise from an async handler here automatically, so a route
// that lets Zod or Prisma throw gets the right status for free. Catch only
// when you have something to add.

const multer = require("multer");

// Zod reports every problem it found; a form can only usefully show a couple.
const MAX_ISSUES_SHOWN = 3;

// "displayName: Required; addresses.physical.gpsLat: Expected number"
//
// Naming the field is the whole point -- it's what makes a validation error
// actionable. An earlier convention used only `issues[0].message`, which
// produced a bare "Required" with no indication of what was required.
function formatZodIssues(issues = []) {
  if (!issues.length) return "That doesn't look right — please check the form.";

  const shown = issues.slice(0, MAX_ISSUES_SHOWN).map((issue) => {
    const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  const remaining = issues.length - shown.length;
  return shown.join("; ") + (remaining > 0 ? ` (+${remaining} more)` : "");
}

// Prisma's P2002 reports which column(s) collided.
function uniqueTargetLabel(err) {
  const target = err?.meta?.target;
  if (Array.isArray(target) && target.length) return target.join(", ");
  if (typeof target === "string" && target) return target;
  return "value";
}

// Maps a thrown error to { status, message }. Pure and exported so the shape
// can be unit-tested without standing up a request.
function classify(err, req = {}) {
  // A status the route set on purpose wins over everything below -- that's
  // the route saying it already knows what this is (utils/extraction.js sets
  // 400 and 422 this way, as do the multer fileFilters).
  if (err?.status && err.status < 500) {
    return { status: err.status, message: err.message || "Bad request" };
  }

  if (err?.name === "ZodError") {
    return { status: 400, message: formatZodIssues(err.issues) };
  }

  // express.json() rejecting a malformed body.
  if (err?.type === "entity.parse.failed") {
    return { status: 400, message: "Malformed JSON body" };
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return { status: 413, message: "That file is too large" };
    }
    return { status: 400, message: err.message };
  }

  switch (err?.code) {
    // Update/delete against a row that isn't there.
    case "P2025":
      return { status: 404, message: "Not found" };
    case "P2002":
      return { status: 409, message: `That ${uniqueTargetLabel(err)} is already in use` };
    case "P2003":
      // On a delete this means something still points at the row; on a write
      // it means the body referenced a parent that doesn't exist. Same Prisma
      // code, opposite explanations.
      return req.method === "DELETE"
        ? { status: 409, message: "Can't delete this — something else still references it" }
        : { status: 400, message: "References a record that doesn't exist" };
    case "P2000":
      return { status: 400, message: "A value is too long for its field" };
    default:
      break;
  }

  if (err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError") {
    return { status: 401, message: "Invalid or expired session" };
  }

  return { status: 500, message: "Server error" };
}

function errorHandler(err, req, res, next) {
  // Blob routes (photos, newsletter/document downloads, the church logo)
  // stream their response, so a mid-send failure arrives here with headers
  // already flushed. Calling res.status() then would throw inside the error
  // handler itself; hand it to Express's default, which destroys the socket.
  if (res.headersSent) return next(err);

  const { status, message } = classify(err, req);

  // Only genuine server faults are worth a log line. Logging every 400 buries
  // the 500s that actually need attention.
  if (status >= 500) console.error(err);

  res.status(status).json({ error: message });
}

module.exports = { errorHandler, classify, formatZodIssues };
