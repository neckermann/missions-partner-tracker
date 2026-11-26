#!/usr/bin/env node
// Checks that every internal link in the repo's markdown resolves (#380):
//   - a relative link to a file points at a file that exists;
//   - a `#anchor` (same file, or `OTHER.md#anchor`) matches a heading in that file;
//   - every `user-guide.html#...` / `admin-guide.html#...` link hard-coded in the app's source
// (see CONTRIBUTING.md "Hardcoded links into the docs site") matches a heading in the guide.
// No dependencies. Exits 1 with a list of problems. Run with `npm run check:docs`.
//
// Anchors use GitHub's heading-slug rule, which docs/assets/guide.js reimplements: lower-case,
// drop everything but letters, digits, spaces, hyphens and underscores, spaces become hyphens,
// and a repeated heading gets -1, -2 ...
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "public", "coverage", "test-results"]);

function listMarkdown(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function slug(text) {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // a link keeps its text
    .replace(/[`*_~]/g, (m) => (m === "_" ? "_" : "")) // inline markup is dropped
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .replace(/ /g, "-");
}

// The anchors a markdown file defines, and its links outside code.
const cache = new Map();
function parse(file) {
  if (cache.has(file)) return cache.get(file);
  const anchors = new Set();
  const seen = new Map();
  const links = [];
  let fenced = false;
  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return;
      }
      if (fenced) return;
      const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) {
        const base = slug(heading[1]);
        const n = seen.get(base) || 0;
        seen.set(base, n + 1);
        anchors.add(n === 0 ? base : `${base}-${n}`);
      }
      // Explicit anchors: <a id="x"> / <a name="x">
      for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(m[1]);
      const prose = line.replace(/`[^`]*`/g, ""); // a link inside inline code is an example
      for (const m of prose.matchAll(
        /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|!\[[^\]]*\]\(([^)\s]+)\)/g
      )) {
        links.push({ href: m[1] || m[2], line: i + 1 });
      }
    });
  const result = { anchors, links };
  cache.set(file, result);
  return result;
}

const problems = [];
const rel = (f) => path.relative(ROOT, f);

for (const file of listMarkdown(ROOT)) {
  for (const { href, line } of parse(file).links) {
    if (/^(https?:|mailto:|tel:|data:)/i.test(href)) continue;
    const [target, hash] = href.split("#");
    const targetFile = target ? path.resolve(path.dirname(file), decodeURI(target)) : file;
    if (!fs.existsSync(targetFile)) {
      problems.push(`${rel(file)}:${line}  ${href}  (no such file)`);
      continue;
    }
    if (hash && targetFile.endsWith(".md") && !parse(targetFile).anchors.has(decodeURIComponent(hash))) {
      problems.push(`${rel(file)}:${line}  ${href}  (no such heading)`);
    }
  }
}

// Links the app itself makes into the rendered guides.
const GUIDES = { "user-guide.html": "USER_GUIDE.md", "admin-guide.html": "ADMIN_GUIDE.md" };
function listSource(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSource(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}
for (const dir of ["backend/src", "frontend/src"]) {
  for (const file of listSource(path.join(ROOT, dir))) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/(user-guide|admin-guide)\.html#([A-Za-z0-9_-]+)/g)) {
      const guide = path.join(ROOT, GUIDES[`${m[1]}.html`]);
      if (!parse(guide).anchors.has(m[2])) {
        problems.push(`${rel(file)}  ${m[0]}  (no such heading in ${path.basename(guide)})`);
      }
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} broken documentation link${problems.length === 1 ? "" : "s"}:\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("Documentation links OK.");
