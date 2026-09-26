const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The public map's tile host is written in two places that have to agree:
// the TileLayer URL in the frontend, and the CSP img-src allowlist the
// backend sends. Nothing connects them, and when they disagree the browser
// blocks every tile with no server-side symptom at all -- no error, no
// failed request in the app's logs, just a blank map with the pins floating
// on it. That is exactly what shipped when the tile provider changed and
// this allowlist didn't -- twice in one afternoon -- so the coupling gets
// a test.
//
// Reading the files as text is deliberate. The frontend is ESM/JSX and the
// backend is CommonJS, so neither can import the other, and standing up an
// Express app here would need a database this suite doesn't have.

const repoRoot = path.join(__dirname, "..", "..");
const mapSource = fs.readFileSync(path.join(repoRoot, "frontend", "src", "pages", "PublicMap.jsx"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "backend", "src", "server.js"), "utf8");

// Comments in these files legitimately name the hosts they warn about, so
// the "must not reference X" checks below look at code only.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const mapCode = stripComments(mapSource);

// Splits a JS array literal's body into its entries and unwraps the
// quoting. Written by hand rather than as one regex because CSP entries are
// themselves quoted -- "'self'" is a double-quoted string whose value
// includes the single quotes -- and a naive /["']([^"']+)["']/ pairs one
// entry's closing quote with the next entry's opening one.
function arrayEntries(body) {
  return body
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^["']|["']$/g, ""))
    .map((entry) => entry.replace(/^'|'$/g, ""));
}

function matchesSource(entry, origin) {
  if (entry === origin) return true;
  // A wildcard host such as https://*.example.com.
  if (entry.includes("*")) {
    return new RegExp(`^${entry.replace(/[.]/g, "\\.").replace(/\*/g, "[^.]+")}$`).test(origin);
  }
  return false;
}

describe("map tile host and CSP img-src", () => {
  const tileUrlMatch = mapSource.match(/const TILE_URL\s*=\s*["']([^"']+)["']/);

  test("the frontend declares a TILE_URL", () => {
    assert.ok(
      tileUrlMatch,
      'PublicMap.jsx should define `const TILE_URL = "..."` -- if it was renamed, update this test too'
    );
  });

  test("the CSP allows the host the map actually requests tiles from", () => {
    // Leaflet's {z}/{x}/{y} placeholders are fine to leave in; only the
    // origin matters to CSP.
    const tileOrigin = new URL(tileUrlMatch[1]).origin;

    const imgSrcMatch = serverSource.match(/"img-src":\s*\[([^\]]*)\]/);
    assert.ok(imgSrcMatch, "server.js should set a CSP img-src directive");

    // The directive is built from string literals plus a TILE_HOST
    // constant -- resolve that before comparing.
    const tileHostMatch = serverSource.match(/const TILE_HOST\s*=\s*["']([^"']+)["']/);
    const resolved = imgSrcMatch[1].replace(/TILE_HOST/g, `"${tileHostMatch?.[1] ?? ""}"`);
    const allowed = arrayEntries(resolved);

    assert.ok(
      allowed.some((entry) => matchesSource(entry, tileOrigin)),
      `CSP img-src does not allow ${tileOrigin}, so the browser will block every map tile.\n` +
        `  img-src: ${allowed.join(" ")}\n` +
        `  Fix: make TILE_HOST in backend/src/server.js match TILE_URL in frontend/src/pages/PublicMap.jsx.`
    );
  });

  test("marker icons are bundled, not fetched from a CDN", () => {
    // They were loaded from unpkg, which put the pins -- the actual data on
    // the page -- behind a third party's availability, and needed its own
    // CSP entry. Vite inlines them as data: URIs now.
    const hit = mapCode.match(/unpkg\.com|cdn\.jsdelivr\.net/);
    assert.equal(
      hit,
      null,
      `PublicMap.jsx should import marker images from the leaflet package, not ${hit?.[0]}`
    );
  });

  test("the tile URL does not use rotating {s} subdomains", () => {
    // This is the part that actually breaks OpenStreetMap's tile usage
    // policy, and it is what this app used to do. The a/b/c subdomains are
    // deprecated, and they exist to open more parallel connections than a
    // single host allows -- which the policy names directly. Serving a
    // whole viewport of tiles through them is how an instance gets a 403
    // with their hazard-tape image in it.
    //
    // The policy does not ban a site of this size from using OSM at all;
    // it bans heavy use of donated infrastructure. So the rule worth
    // enforcing is this one, not "never OSM".
    assert.equal(
      /\{s\}/.test(tileUrlMatch?.[1] ?? ""),
      false,
      `TILE_URL must name one host, not a {s} subdomain pattern: ${tileUrlMatch?.[1]}`
    );
  });
});
