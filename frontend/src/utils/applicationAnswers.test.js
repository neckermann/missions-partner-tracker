import { describe, test, expect } from "vitest";
import { applicationAnswerList } from "./applicationAnswers.js";

const questions = [
  { id: "a", label: "Passport?" },
  { id: "b", label: "Skills" },
  { id: "c", label: "Diet" },
];

describe("applicationAnswerList", () => {
  test("lists each current question with its answer, a list joined, and (no answer) when blank", () => {
    const list = applicationAnswerList(questions, [
      { questionId: "a", label: "Passport?", value: "Yes", values: [] },
      { questionId: "b", label: "Skills", value: null, values: ["Cooking", "Music"] },
    ]);
    expect(list.map((x) => x.answer)).toEqual(["Yes", "Cooking, Music", "(no answer)"]);
  });

  test("keeps an answer to a removed question, under the wording it was asked with", () => {
    const list = applicationAnswerList(questions.slice(0, 1), [
      { questionId: null, label: "Old question", value: "Kept", values: [] },
    ]);
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ label: "Old question", answer: "Kept", removed: true });
  });

  test("copes with no answers at all", () => {
    expect(applicationAnswerList(questions, undefined)).toHaveLength(3);
  });
});
