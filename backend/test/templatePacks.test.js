// Template packs: every example pack shipped in examples/template-packs/ must be valid, the
// envelope and each kind reject malformed input, and the examples carry no one church's name.
const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePack, KIND_KEYS, FORMAT } = require("../src/utils/templatePacks");
const { listPackFiles, readPackFile } = require("../src/utils/packFiles");
const { fieldFitsKind } = require("../src/utils/surveyFields");

test("every shipped example pack is valid, and every kind has an example", () => {
  const files = listPackFiles();
  assert.ok(files.length >= 7);
  const kinds = new Set();
  for (const f of files) {
    const parsed = parsePack(readPackFile(f));
    assert.ok(!parsed.error, `${f}: ${parsed.error}`);
    kinds.add(parsed.pack.kind);
    assert.ok(parsed.pack.title && parsed.pack.description, `${f} needs a title and description`);
  }
  assert.deepEqual([...kinds].sort(), [...KIND_KEYS].sort());
});

test("example survey questions link only fields that fit their kind, and carry no church's name", () => {
  for (const f of listPackFiles().filter((n) => n.startsWith("survey-"))) {
    const pack = readPackFile(f);
    for (const q of pack.data.survey.questions) {
      if (q.field) assert.ok(fieldFitsKind(q.field, q.kind), `${f}: ${q.label}`);
    }
  }
  for (const f of listPackFiles()) {
    assert.ok(!JSON.stringify(readPackFile(f)).match(/Hillside|Edgewood/i), `${f} names a church`);
  }
});

test("rejects things that aren't packs, with a reason", () => {
  assert.match(parsePack("not json").error, /valid JSON/);
  assert.match(parsePack({ hello: "world" }).error, /template pack/);
  assert.match(
    parsePack({ format: FORMAT, version: 1, kind: "nope", title: "x", data: {} }).error,
    /doesn't know the pack kind/
  );
  assert.match(
    parsePack({ format: FORMAT, version: 2, kind: "survey", title: "x", data: {} }).error,
    /template pack/
  );
  const bad = parsePack({
    format: FORMAT,
    version: 1,
    kind: "survey",
    title: "x",
    data: { survey: { title: "t", questions: [{ kind: "teleport", label: "?" }] } },
  });
  assert.match(bad.error, /contents aren't valid/);
  const tooMany = parsePack({
    format: FORMAT,
    version: 1,
    kind: "supportMenu",
    title: "x",
    data: { options: [] },
  });
  assert.ok(tooMany.error, "an empty menu is not a pack");
  const mcq = parsePack({
    format: FORMAT,
    version: 1,
    kind: "applicationQuestions",
    title: "x",
    data: { tripApplicationTemplate: [{ label: "Pick", type: "select" }] },
  });
  assert.match(mcq.error, /at least one option/);
});
