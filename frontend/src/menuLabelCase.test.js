import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Menu labels use Title Case: every word starts with a capital except small joining words ("Updates to Share",
// "Privacy and Safety"). This reads the labels out of the sidebar so a new entry that breaks the rule fails here
// (STYLE-GUIDE.md, copy tone).
const SMALL = new Set(["a", "an", "and", "the", "to", "of", "in", "on", "for", "with", "or"]);
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "components/admin/AdminSidebar.jsx");
const labels = [...fs.readFileSync(file, "utf8").matchAll(/label[:=]\s*"([^"]+)"/g)].map((m) => m[1]);

describe("menu label case", () => {
  it("finds the sidebar's labels", () => {
    expect(labels.length).toBeGreaterThan(15);
  });
  it("every word of every menu label is capitalised, except small joining words", () => {
    const bad = labels.filter((label) =>
      label.split(/\s+/).some((word, i) => /^[a-z]/.test(word) && !(i > 0 && SMALL.has(word)))
    );
    expect(bad).toEqual([]);
  });
});
