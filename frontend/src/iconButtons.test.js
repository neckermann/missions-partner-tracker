import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// A button that is only a symbol (✕, ▲, ▼, ✉...) doesn't say what it does. Row-level actions (remove, move up,
// move down, delete) must carry a word; a small dismiss or clear symbol is allowed only when it has BOTH an
// accessible name and a hover title that say what it acts on. This scans the source so a new bare ✕ can't slip in.
const SRC = path.join(__dirname);
const BUTTON = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".jsx") && !entry.name.includes(".test.") ? [full] : [];
  });
}

// What a person can read on the button: its text with tags and {expressions} that hold no real word removed.
function visibleWords(inner) {
  return inner
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^{}]*\}/g, (m) => (/["'`][^"'`]*[A-Za-z]{3}/.test(m) ? m : " "))
    .trim();
}

describe("icon-only buttons", () => {
  const offenders = { rowAction: [], unnamed: [] };
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(BUTTON)) {
      const [, attrs, inner] = m;
      const words = visibleWords(inner);
      // Only buttons that really are a symbol: some symbol character, and no word.
      if (/[A-Za-z]{3,}/.test(words) || !/[✕✖×▲▼✉⟨⟩☰⋯✎🗑+−]/.test(words)) continue;
      const where = `${path.relative(SRC, file)}:${text.slice(0, m.index).split("\n").length}`;
      if (/className="btn-remove"/.test(attrs)) offenders.rowAction.push(`${where} (${words})`);
      if (!/aria-label/.test(attrs) || !/title=/.test(attrs)) offenders.unnamed.push(`${where} (${words})`);
    }
  }

  it("remove / move buttons always carry a word, not just a symbol", () => {
    expect(offenders.rowAction).toEqual([]);
  });

  it("any other symbol-only button has both an accessible name and a hover title", () => {
    expect(offenders.unnamed).toEqual([]);
  });
});
