import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SurveyQuestions, {
  answersToPayload,
  answersFromSaved,
  describeSavedAnswer,
} from "./SurveyQuestions.jsx";

const questions = [
  { id: "q1", kind: "text", label: "How are you?", choices: [], allowOther: false, required: true },
  { id: "q2", kind: "yesno", label: "Home this year?", choices: [], allowOther: false, required: false },
  { id: "q3", kind: "single", label: "Best day", choices: ["Mon", "Tue"], allowOther: true, required: false },
  {
    id: "q4",
    kind: "multiple",
    label: "Needs",
    choices: ["Prayer", "Visit"],
    allowOther: false,
    required: false,
  },
];

function Harness({ onAnswers }) {
  const [answers, setAnswers] = useState({});
  onAnswers(answers);
  return (
    <SurveyQuestions
      questions={questions}
      answers={answers}
      onChange={(id, patch) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }))}
    />
  );
}

describe("SurveyQuestions", () => {
  it("collects an answer of every kind and turns them into the API payload", () => {
    let latest = {};
    render(<Harness onAnswers={(a) => (latest = a)} />);
    expect(screen.getByLabelText("required")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /How are you/ }), { target: { value: "Well" } });
    fireEvent.click(screen.getByLabelText("Yes"));
    fireEvent.click(screen.getByLabelText("Tue"));
    fireEvent.click(screen.getByLabelText("Prayer"));
    fireEvent.click(screen.getByLabelText("Visit"));
    fireEvent.click(screen.getByLabelText("Visit"));
    const payload = answersToPayload(questions, latest);
    expect(payload.find((p) => p.questionId === "q1").value).toBe("Well");
    expect(payload.find((p) => p.questionId === "q2").value).toBe("yes");
    expect(payload.find((p) => p.questionId === "q3").value).toBe("Tue");
    expect(payload.find((p) => p.questionId === "q4").values).toEqual(["Prayer"]);
  });

  it("typing something else clears the picked choice", () => {
    let latest = {};
    render(<Harness onAnswers={(a) => (latest = a)} />);
    fireEvent.click(screen.getByLabelText("Mon"));
    fireEvent.change(screen.getByLabelText("Something else for Best day"), { target: { value: "Sat" } });
    expect(latest.q3.value).toBe("");
    expect(latest.q3.other).toBe("Sat");
  });

  it("restores saved answers and describes them in a line", () => {
    const saved = [
      { questionId: "q2", kind: "yesno", value: "no", values: [], other: null },
      { questionId: null, kind: "text", value: "orphan", values: [], other: null },
      { questionId: "q4", kind: "multiple", value: null, values: ["Prayer"], other: "Meals" },
    ];
    const map = answersFromSaved(saved);
    expect(Object.keys(map)).toEqual(["q2", "q4"]);
    expect(describeSavedAnswer(saved[0])).toBe("No");
    expect(describeSavedAnswer(saved[2])).toBe("Prayer, Meals");
  });
});
