// Every link in the admin nav and on the Home and Settings pages must land on a route that
// exists (a renamed page once kept its old route while the nav pointed at nothing and nothing
// failed). Reads the source rather than rendering the app: the route table in main.jsx is the
// single list of what exists, and the three files below are the places that link into it.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, rel), "utf8");
const main = read("main.jsx");

// The route table as the router sees it: every <Route path="..."> with its nesting resolved into an absolute path,
// so "settings" inside "/admin" is "/admin/settings/...", and a settings page is only satisfied by a route that is
// really under settings (not by any route that happens to share a name or a prefix). Read from the source because
// main.jsx is the single list of what exists.
function routeTable(src) {
  const paths = new Set();
  const stack = []; // the absolute path of each open <Route>, innermost last
  const join = (base, rel) => (rel.startsWith("/") ? rel : `${base.replace(/\/$/, "")}/${rel}`);
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("<Route", i);
    const close = src.indexOf("</Route>", i);
    if (open === -1 && close === -1) break;
    if (close !== -1 && (open === -1 || close < open)) {
      stack.pop();
      i = close + "</Route>".length;
      continue;
    }
    if (!/[\s>/]/.test(src[open + "<Route".length])) {
      i = open + 1; // <Routes>, not a <Route>
      continue;
    }
    // Scan to the end of the tag: the first ">" outside braces and quotes (an element={<X />} holds ">" itself).
    let depth = 0;
    let quote = null;
    let j = open + "<Route".length;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const tag = src.slice(open, j + 1);
    const selfClosing = src[j - 1] === "/";
    const rel = tag.match(/^<Route[^]*?\spath="([^"]+)"/)?.[1];
    const base = stack.length ? stack[stack.length - 1] : "";
    const here = rel === undefined ? base : join(base || "/", rel);
    if (rel !== undefined) paths.add(here);
    // An index route is its parent's own path.
    if (/\sindex[\s/>]/.test(tag)) paths.add(base || "/");
    if (!selfClosing) stack.push(here);
    i = j + 1;
  }
  return paths;
}

const routes = routeTable(main);
const matchesRoute = (target) =>
  [...routes].some((route) => {
    const pattern = new RegExp(
      `^${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z]+/g, "[^/]+")}$`
    );
    return pattern.test(target);
  });

const sources = {
  "components/admin/AdminSidebar.jsx": read("components/admin/AdminSidebar.jsx"),
  "pages/AdminSettingsHome.jsx": read("pages/AdminSettingsHome.jsx"),
  "pages/AdminHome.jsx": read("pages/AdminHome.jsx"),
};
const linksIn = (src) => [...new Set([...src.matchAll(/to:\s*"(\/admin[^"?#]*)"/g)].map((m) => m[1]))];

describe("the route table can be read", () => {
  it("finds the admin area and its settings pages (so the checks below cannot pass by finding nothing)", () => {
    expect(routes.size).toBeGreaterThan(40);
    expect(routes.has("/admin")).toBe(true);
    expect(routes.has("/admin/partners/:id")).toBe(true);
    expect([...routes].filter((r) => r.startsWith("/admin/settings/")).length).toBeGreaterThan(10);
  });
});

describe("admin nav and tile links resolve to routes", () => {
  for (const [file, src] of Object.entries(sources)) {
    const targets = linksIn(src);
    it(`${file} has links to check`, () => {
      expect(
        targets.length,
        `no links found in ${file}: the pattern may have stopped matching`
      ).toBeGreaterThan(0);
    });
    for (const target of targets) {
      it(`${file} -> ${target}`, () => {
        // Exactly a route that exists at that path: /admin itself is the admin index, and a settings page must be
        // under settings, not any route that shares its name or starts the same way.
        expect(matchesRoute(target), `${target} has no route in main.jsx`).toBe(true);
      });
    }
  }
});

describe("Settings: the sidebar and the Settings home tiles list the same pages in the same order", () => {
  const settingsTargets = (src) => [...src.matchAll(/(\/admin\/settings\/[a-z-]+)/g)].map((m) => m[1]);
  const unique = (list) => list.filter((x, i) => list.indexOf(x) === i);

  it("matches, so a page added to one is not missing from the other", () => {
    const sidebar = sources["components/admin/AdminSidebar.jsx"];
    // Only the Settings group: from the site-admin links builder to the end of that function.
    const block = sidebar.slice(sidebar.indexOf("function buildSiteAdminLinks"));
    const fromSidebar = unique(settingsTargets(block.slice(0, block.indexOf("].filter(Boolean)"))));
    const fromHome = unique(settingsTargets(sources["pages/AdminSettingsHome.jsx"]));
    expect(fromHome).toEqual(fromSidebar);
  });

  it("puts About App (version, system info, backups) last, after the per-feature settings", () => {
    const fromHome = unique(settingsTargets(sources["pages/AdminSettingsHome.jsx"]));
    expect(fromHome[fromHome.length - 1]).toBe("/admin/settings/system-info");
    expect(fromHome.indexOf("/admin/settings/features")).toBeLessThan(
      fromHome.indexOf("/admin/settings/trips")
    );
  });
});
