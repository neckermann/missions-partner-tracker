// Every link in the admin nav and on the Home and Settings pages must land on a
// route that exists (#341: a renamed page kept its old route for a while, so the
// nav pointed at nothing and nothing failed). Reads the source rather than
// rendering the app: the route table in main.jsx is the single list of what
// exists, and the three files below are the places that link into it.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, rel), "utf8");
const main = read("main.jsx");

// /admin/settings/<x> routes are declared as relative paths inside the settings
// route block; everything else under /admin is declared the same way one level up.
const declared = new Set([...main.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));

const sources = {
  "components/admin/AdminSidebar.jsx": read("components/admin/AdminSidebar.jsx"),
  "pages/AdminSettingsHome.jsx": read("pages/AdminSettingsHome.jsx"),
  "pages/AdminHome.jsx": read("pages/AdminHome.jsx"),
};

describe("admin nav and tile links resolve to routes", () => {
  for (const [file, src] of Object.entries(sources)) {
    const targets = [...new Set([...src.matchAll(/to:\s*"(\/admin[^"?#]*)"/g)].map((m) => m[1]))];
    for (const target of targets) {
      it(`${file} -> ${target}`, () => {
        if (target === "/admin") return; // the index route
        const rel = target.replace(/^\/admin\/?/, "").replace(/^settings\/?/, "");
        const isSettingsChild = target.startsWith("/admin/settings/");
        // A settings child is a relative "<x>" route; a top-level admin page is "<x>" or "<x>/..." too.
        const ok =
          rel === "" || declared.has(rel) || [...declared].some((d) => d === rel || d.startsWith(`${rel}/`));
        expect(
          ok,
          `${target} has no route in main.jsx (looked for "${rel}"${isSettingsChild ? " under settings" : ""})`
        ).toBe(true);
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
