// Checks the running version against the latest tagged release on the public
// upstream repo, so a fork gets a dashboard heads-up (see UPGRADING.md).
//
// backend/package.json's version is the source of truth, not frontend/package.json:
// only backend/ ships in the deployed artifact. Every release bumps it, even for a
// frontend-only change, so this stays accurate.
const APP_VERSION = require("../../package.json").version;
const UPSTREAM_REPO = "neckermann/missions-partner-tracker";

// Release checks barely change and this is an unauthenticated GitHub API call
// (60 req/hr per IP); caching avoids burning that budget on every dashboard load.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cache = null; // { currentVersion, latestVersion, updateAvailable, releaseUrl, checkedAt }

// SemVer including pre-releases (0.1.0-beta.2): pre-1.0 work ships as betas, so
// the running version can be a beta of the release GitHub calls "latest". A
// pre-release sorts BELOW its final release; betas compare identifier by
// identifier, numbers numerically (beta.2 < beta.10). Build metadata (+abc) is ignored.
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

// Never throws: an unreachable check means no banner, not a broken dashboard.
// Returns the last good cached result (even stale) when GitHub is briefly unreachable.
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
