import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
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

describe("SurveyQuestions photo question", () => {
  const photoQ = [
    { id: "q9", kind: "photo", label: "A recent photo", choices: [], allowOther: false, required: false },
  ];

  it("offers a file picker to a partner, and explains where staff add one", () => {
    const onPhoto = vi.fn();
    const { rerender } = render(
      <SurveyQuestions
        questions={photoQ}
        answers={{}}
        onChange={() => {}}
        onPhoto={onPhoto}
        photos={["q9"]}
      />
    );
    const file = new File(["x"], "me.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("A recent photo"), { target: { files: [file] } });
    expect(onPhoto).toHaveBeenCalledWith("q9", file);
    expect(screen.getByText(/Photo received/)).toBeInTheDocument();
    rerender(<SurveyQuestions questions={photoQ} answers={{}} onChange={() => {}} />);
    expect(screen.getByText(/Photo History/)).toBeInTheDocument();
  });
});

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

describe("SurveyQuestions linked fields (#548)", () => {
  const base = { choices: [], allowOther: false, required: false, maxLength: null, labels: null };
  const linked = [
    { ...base, id: "p", kind: "text", label: "Best phone", inputType: "tel" },
    { ...base, id: "e", kind: "text", label: "Best email", inputType: "email" },
    { ...base, id: "n", kind: "text", label: "Contact name", inputType: "line", maxLength: 120 },
    { ...base, id: "x", kind: "text", label: "Anything else", inputType: null },
  ];

  it("gives a phone, an email and a short line a single-line box of the right type, and anything else a text area", () => {
    render(<SurveyQuestions questions={linked} answers={{}} onChange={() => {}} />);
    const phone = screen.getByLabelText("Best phone");
    expect(phone.tagName).toBe("INPUT");
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("inputmode", "tel");
    expect(phone).toHaveAttribute("autocomplete", "tel");
    const email = screen.getByLabelText("Best email");
    expect(email.tagName).toBe("INPUT");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    const name = screen.getByLabelText("Contact name");
    expect(name.tagName).toBe("INPUT");
    expect(name).toHaveAttribute("type", "text");
    expect(name).toHaveAttribute("maxlength", "120");
    expect(screen.getByLabelText("Anything else").tagName).toBe("TEXTAREA");
  });

  it("sends what is typed in the phone box", () => {
    const onChange = vi.fn();
    render(<SurveyQuestions questions={linked} answers={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Best phone"), { target: { value: "(506) 555-0259" } });
    expect(onChange).toHaveBeenCalledWith("p", { value: "(506) 555-0259" });
  });

  it("shows a contact method's choices in words and answers with the stored value", () => {
    const method = {
      ...base,
      id: "m",
      kind: "single",
      label: "How do you prefer to be contacted?",
      choices: ["call", "text", "whatsapp"],
      labels: { call: "Phone call", text: "Text message", whatsapp: "WhatsApp" },
      inputType: "contactMethod",
    };
    const onChange = vi.fn();
    render(<SurveyQuestions questions={[method]} answers={{}} onChange={onChange} />);
    expect(screen.getByLabelText("Phone call")).toBeInTheDocument();
    expect(screen.getByLabelText("Text message")).toBeInTheDocument();
    expect(screen.queryByText("call")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Text message"));
    expect(onChange).toHaveBeenCalledWith("m", { value: "text", other: "" });
  });

  it("describes a saved phone the usual way and a saved contact method in words", () => {
    const phone = { ...linked[0], questionId: "p" };
    expect(describeSavedAnswer({ kind: "text", value: "+15065550259" }, [], phone)).toBe("(506) 555-0259");
    const method = { inputType: "contactMethod", labels: { text: "Text message" } };
    expect(describeSavedAnswer({ kind: "single", value: "text" }, [], method)).toBe("Text message");
    expect(describeSavedAnswer({ kind: "text", value: "hello" }, [], null)).toBe("hello");
  });
});
