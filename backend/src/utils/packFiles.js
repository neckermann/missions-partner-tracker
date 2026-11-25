// Reads the example template packs shipped in examples/template-packs/. Used by the demo seed and
// tests; a real church imports them through Settings (or writes its own). Nothing here is applied
// unless a caller asks for it by name.
const fs = require("fs");
const path = require("path");
const { parsePack } = require("./templatePacks");

const DIR = path.join(__dirname, "..", "..", "..", "examples", "template-packs");

const listPackFiles = () =>
  fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

function readPackFile(name) {
  const file = name.endsWith(".json") ? name : `${name}.json`;
  return JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
}

// Applies one example pack as the given user. Throws with the reason if it can't be applied.
async function importPackFile(name, { userId = null } = {}) {
  const parsed = parsePack(readPackFile(name));
  if (parsed.error) throw new Error(`${name}: ${parsed.error}`);
  const result = await parsed.handler.apply(parsed.pack.data, { userId });
  if (result.error) throw new Error(`${name}: ${result.error}`);
  return result;
}

module.exports = { DIR, listPackFiles, readPackFile, importPackFile };
