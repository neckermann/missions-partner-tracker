// The rules around support preferences' answers.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeResponse, describeAnswer, KIND_VALUES } = require("../src/utils/supportOptions");

const single = { kind: "single", label: "Gifts", choices: ["A", "B"], allowOther: true };
const multiple = { kind: "multiple", label: "Contact", choices: ["Letters", "Video"], allowOther: false };

describe("normalizeResponse", () => {
  test("an offer is just selected or not", () => {
    const opt = { kind: "offer", label: "Pick-up" };
    assert.deepEqual(normalizeResponse(opt, { selected: true }), {
      selected: true,
      choice: null,
      choices: [],
      other: null,
      text: null,
      note: null,
    });
    assert.deepEqual(normalizeResponse(opt, { selected: false }), { empty: true });
  });

  test("a note alone keeps a response, so a decline can be explained", () => {
    const r = normalizeResponse({ kind: "offer", label: "x" }, { selected: false, note: "Not this time" });
    assert.equal(r.selected, false);
    assert.equal(r.note, "Not this time");
  });

  test("a single choice must be one of the choices, or an other when allowed, not both", () => {
    assert.equal(normalizeResponse(single, { choice: "A" }).choice, "A");
    assert.ok(normalizeResponse(single, { choice: "Z" }).error);
    assert.equal(normalizeResponse(single, { other: "Mine" }).other, "Mine");
    assert.ok(normalizeResponse(single, { choice: "A", other: "Mine" }).error);
  });

  test("an other is refused where the option has no other box", () => {
    assert.ok(normalizeResponse(multiple, { other: "x" }).error);
  });

  test("multiple choices collapse duplicates and must all be real", () => {
    assert.deepEqual(normalizeResponse(multiple, { choices: ["Letters", "Letters", "Video"] }).choices, [
      "Letters",
      "Video",
    ]);
    assert.ok(normalizeResponse(multiple, { choices: ["Letters", "Pigeon"] }).error);
    assert.deepEqual(normalizeResponse(multiple, { choices: [] }), { empty: true });
  });

  test("text is trimmed, and blank text is empty", () => {
    assert.equal(normalizeResponse({ kind: "text", label: "x" }, { text: "  hi  " }).text, "hi");
    assert.deepEqual(normalizeResponse({ kind: "text", label: "x" }, { text: "   " }), { empty: true });
  });
});

describe("describeAnswer", () => {
  test("reads each kind as one line", () => {
    assert.equal(describeAnswer({ kind: "offer" }, { selected: true }), "Yes");
    assert.equal(describeAnswer({ kind: "offer" }, { selected: false }), "");
    assert.equal(describeAnswer(single, { choice: "A" }), "A");
    assert.equal(describeAnswer(single, { other: "Mine" }), "Mine");
    assert.equal(describeAnswer(multiple, { choices: ["Letters", "Video"], other: null }), "Letters, Video");
    assert.equal(describeAnswer({ kind: "text" }, { text: "hello" }), "hello");
    assert.equal(describeAnswer(single, null), "");
  });
});
