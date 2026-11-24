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

// SemVer, including pre-releases (0.1.0-beta.2): the pre-1.0 work ships as betas toward each
// release (see CONTRIBUTING.md § Versioning), so the running version can be a beta of the very
// release GitHub calls "latest". A pre-release sorts BELOW its own final release
// (0.1.0-beta.2 < 0.1.0), and betas sort among themselves identifier by identifier, numbers
// numerically (beta.2 < beta.10). Build metadata (+abc) is ignored, as SemVer says.
function parseVersion(v) {
  const [core, ...rest] = String(v).trim().replace(/^v/, "").replace(/\+.*$/, "").split("-");
  const numbers = core.split(".").map((n) => parseInt(n, 10) || 0);
  const pre = rest.length ? rest.join("-").split(".") : [];
  return { numbers, pre };
}

function comparePreIdentifier(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Math.sign(Number(a) - Number(b));
  if (aNum) return -1; // a numeric identifier is lower than an alphanumeric one
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// -1, 0 or 1: how version a orders against version b.
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const diff = (x.numbers[i] || 0) - (y.numbers[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1; // a final release is above any of its pre-releases
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === undefined) return -1; // fewer identifiers is lower
    if (y.pre[i] === undefined) return 1;
    const c = comparePreIdentifier(x.pre[i], y.pre[i]);
    if (c !== 0) return c;
  }
  return 0;
}

function isNewer(latest, current) {
  return compareVersions(latest, current) > 0;
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

module.exports = { checkForUpdate, isNewer, compareVersions, APP_VERSION };
