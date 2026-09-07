// Checks this instance's running version against the latest tagged release
// on the public upstream repo, so a church running their own fork gets a
// heads-up in the admin dashboard instead of needing to know to check
// GitHub for new releases themselves (see UPGRADING.md).
//
// backend/package.json's version is the source of truth for "what's
// running" -- not frontend/package.json, since only backend/ ships in the
// deployed artifact (the build workflow zips backend/ after copying the
// built frontend into backend/public; frontend/package.json itself never
// reaches the deployed instance). Every release bumps backend/package.json
// to the release's version number from here on, even for a frontend-only
// change, specifically so this stays accurate.
const APP_VERSION = require("../../package.json").version;
const UPSTREAM_REPO = "neckermann/missions-partner-tracker";

// Release checks barely change day to day, and this is a public,
// unauthenticated GitHub API call (60 req/hr per IP) -- caching avoids
// burning through that budget on every admin dashboard load.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cache = null; // { currentVersion, latestVersion, updateAvailable, releaseUrl, checkedAt }

function parseVersion(v) {
  return String(v)
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

function isNewer(latest, current) {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) !== (c[i] || 0)) return (l[i] || 0) > (c[i] || 0);
  }
  return false;
}

// Never throws -- a failed/unreachable check should just mean no banner,
// not a broken admin dashboard. Returns the last good cached result (even
// if stale) rather than a scary "no data" state when GitHub is briefly
// unreachable.
async function checkForUpdate() {
  if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) return cache;

  try {
    const res = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "missions-partner-tracker" },
    });
    if (!res.ok) return cache;

    const data = await res.json();
    if (!data.tag_name) return cache;

    cache = {
      currentVersion: APP_VERSION,
      latestVersion: data.tag_name.replace(/^v/, ""),
      updateAvailable: isNewer(data.tag_name, APP_VERSION),
      releaseUrl: data.html_url || `https://github.com/${UPSTREAM_REPO}/releases`,
      checkedAt: Date.now(),
    };
    return cache;
  } catch (err) {
    console.error("Version check failed:", err);
    return cache;
  }
}

module.exports = { checkForUpdate, isNewer, APP_VERSION };
