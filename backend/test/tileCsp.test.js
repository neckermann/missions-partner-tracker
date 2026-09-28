const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The public map's tile hosts are written in two places that have to
// agree: the TILE_SOURCES list in the frontend, and the CSP img-src
// allowlist the backend sends. Nothing connects them, and when they
// disagree the browser blocks those tiles with no server-side symptom at
// all -- no error, no failed request in the app's logs, just a blank map
// with the pins floating on it.
//
// That has now happened twice: once in be3edd6 ("fix CSP blocking the
// public map"), and again when the tile provider changed and this
// allowlist didn't. A missing entry is worse now that there is a fallback
// list, because it would silently disable the fallback that exists
// precisely for when the primary refuses someone -- and only for the
// visitors already having a bad time. Hence a test.
//
// Reading the files as text is deliberate. The frontend is ESM/JSX and the
// backend is CommonJS, so neither can import the other, and standing up an
// Express app here would need a database this suite doesn't have.

const repoRoot = path.join(__dirname, "..", "..");
const mapSource = fs.readFileSync(path.join(repoRoot, "frontend", "src", "pages", "PublicMap.jsx"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "backend", "src", "server.js"), "utf8");

// Comments in these files legitimately name hosts they warn about, so the
// "must not reference X" checks below look at code only.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const mapCode = stripComments(mapSource);

// Every url: "..." inside the TILE_SOURCES array literal.
function tileUrls() {
  const block = mapCode.match(/const TILE_SOURCES\s*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(block, "PublicMap.jsx should define a TILE_SOURCES array");
  return [...block[1].matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
}

// Entries of the CSP img-src array, with TILE_HOSTS spread in.
function allowedImgSources() {
  const directive = serverSource.match(/"img-src":\s*\[([^\]]*)\]/);
  assert.ok(directive, "server.js should set a CSP img-src directive");

  const hostsLiteral = serverSource.match(/const TILE_HOSTS\s*=\s*\[([^\]]*)\]/);
  const resolved = directive[1].replace(/\.\.\.TILE_HOSTS/g, hostsLiteral?.[1] ?? "");

  // Split on commas and unwrap quoting by hand: CSP entries are themselves
  // quoted -- "'self'" is a double-quoted string whose value includes the
  // single quotes -- and a naive /["']([^"']+)["']/ pairs one entry's
  // closing quote with the next entry's opening one.
  return resolved
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^["']|["']$/g, ""))
    .map((entry) => entry.replace(/^'|'$/g, ""));
}

function permits(entry, origin) {
  if (entry === origin) return true;
  if (entry.includes("*")) {
    return new RegExp(`^${entry.replace(/[.]/g, "\\.").replace(/\*/g, "[^.]+")}$`).test(origin);
  }
  return false;
}

describe("map tile hosts and CSP img-src", () => {
  test("the frontend declares a tile source and a fallback", () => {
    const urls = tileUrls();
    // The fallback is the whole point: OpenStreetMap blocks by network, so
    // a single source means some visitors get a map and others get nothing,
    // from the same build, with no code change able to fix it for both.
    assert.ok(
      urls.length >= 2,
      "TILE_SOURCES should keep at least one fallback -- a blocked visitor has nowhere to go otherwise"
    );
  });

  test("the CSP allows every host the map can request tiles from", () => {
    const allowed = allowedImgSources();

    for (const url of tileUrls()) {
      // Leaflet's {z}/{x}/{y} placeholders are fine to leave in; only the
      // origin matters to CSP.
      const origin = new URL(url).origin;
      assert.ok(
        allowed.some((entry) => permits(entry, origin)),
        `CSP img-src does not allow ${origin}, so the browser will block every tile from it.\n` +
          `  img-src: ${allowed.join(" ")}\n` +
          `  Fix: add it to TILE_HOSTS in backend/src/server.js.`
      );
    }
  });

  test("no tile URL uses rotating {s} subdomains", () => {
    // This is the part that actually breaks OpenStreetMap's tile usage
    // policy, and it is what this app used to do. The a/b/c subdomains are
    // deprecated, and they exist to open more parallel connections than a
    // single host allows -- which the policy names directly.
    //
    // The policy does not ban a site of this size from using OSM at all;
    // it bans heavy use of donated infrastructure. So the rule worth
    // enforcing is this one, not "never OSM".
    for (const url of tileUrls()) {
      assert.equal(
        /\{s\}/.test(url),
        false,
        `tile URLs must name one host, not an {s} subdomain pattern: ${url}`
      );
    }
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
});
