import { describe, it, expect } from "vitest";
import { describeSupportAnswer, groupMenu, parseSupportAnswer, setSupportAnswer } from "./supportAnswer.js";

const menu = [
  { id: "a", group: "Visits", label: "A visit", kind: "offer", choices: [] },
  { id: "b", group: "Visits", label: "Best days", kind: "multiple", choices: ["Mon", "Tue"] },
  { id: "c", group: "Prayer", label: "Prayer focus", kind: "text", choices: [] },
];

describe("support preferences survey answer", () => {
  it("sets and clears one option at a time, dropping empty ones", () => {
    let v = setSupportAnswer({}, "a", { selected: true });
    expect(parseSupportAnswer(v)).toEqual({ a: { selected: true } });
    v = setSupportAnswer(parseSupportAnswer(v), "b", { choices: ["Mon", "Tue"] });
    expect(Object.keys(parseSupportAnswer(v))).toEqual(["a", "b"]);
    v = setSupportAnswer(parseSupportAnswer(v), "a", { selected: false });
    expect(Object.keys(parseSupportAnswer(v))).toEqual(["b"]);
    v = setSupportAnswer(parseSupportAnswer(v), "b", { choices: [] });
    expect(v).toBe("");
  });

  it("reads a broken value as no answer", () => {
    expect(parseSupportAnswer("nope")).toEqual({});
    expect(parseSupportAnswer("")).toEqual({});
  });

  it("describes an answer in words using the menu's labels", () => {
    const v = JSON.stringify({ a: { selected: true }, b: { choices: ["Mon", "Tue"] }, c: { text: "Visa" } });
    expect(describeSupportAnswer(v, menu)).toBe("A visit; Best days: Mon, Tue; Prayer focus: Visa");
    expect(describeSupportAnswer(JSON.stringify({ gone: { selected: true } }), menu)).toBe("");
  });

  it("groups the menu in order", () => {
    expect(groupMenu(menu).map(([g, o]) => [g, o.length])).toEqual([
      ["Visits", 2],
      ["Prayer", 1],
    ]);
  });
});
