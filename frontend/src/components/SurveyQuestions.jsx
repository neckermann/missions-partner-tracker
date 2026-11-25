import React from "react";
import { ADDRESS_PARTS, addressToValue, parseAddressValue, formatAddressValue } from "../utils/address.js";

// A checkbox or radio next to its label. Inline: the global label and input rules would otherwise
// stack and centre it.
export const choiceRowStyle = {
  display: "flex",
  flexDirection: "row",
  gap: "0.6rem",
  alignItems: "center",
  padding: "0.2rem 0",
  fontWeight: "normal",
  textAlign: "left",
};
export const choiceInputStyle = { width: "auto", flexShrink: 0 };

// The questions of a survey as a form, used on the partner's own page and when staff fill one in
// for them. `answers` is { [questionId]: { value, values, other } }; `onChange(questionId, patch)`.
export default function SurveyQuestions({
  questions,
  answers,
  onChange,
  disabled = false,
  onPhoto = null,
  photos = [],
}) {
  return (
    <div>
      {questions.map((q) => {
        const a = answers[q.id] || {};
        const label = (
          <>
            {q.label}
            {q.required && <span aria-label="required"> *</span>}
          </>
        );
        if (q.kind === "photo") {
          return (
            <div key={q.id} style={{ marginBottom: "1rem" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{label}</div>
              {onPhoto ? (
                <>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    aria-label={q.label}
                    disabled={disabled}
                    onChange={(e) => e.target.files?.[0] && onPhoto(q.id, e.target.files[0])}
                  />
                  {photos.includes(q.id) && (
                    <p role="status" style={{ color: "var(--accent)", margin: "0.25rem 0 0" }}>
                      Photo received. Choose another to replace it.
                    </p>
                  )}
                </>
              ) : (
                <p style={{ color: "var(--muted)", margin: 0 }}>
                  A partner sends their photo through their own link. To add one yourself, use Photo History
                  on their page.
                </p>
              )}
            </div>
          );
        }
        if (q.kind === "address") {
          const parts = parseAddressValue(a.value);
          return (
            <fieldset key={q.id} style={{ border: "none", padding: 0, margin: "0 0 1rem" }}>
              <legend style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{label}</legend>
              {ADDRESS_PARTS.map((part) => (
                <label key={part.key} style={{ display: "block", fontWeight: "normal" }}>
                  {part.label}
                  <input
                    type="text"
                    autoComplete={part.autoComplete}
                    disabled={disabled}
                    value={parts[part.key] || ""}
                    onChange={(e) =>
                      onChange(q.id, { value: addressToValue({ ...parts, [part.key]: e.target.value }) })
                    }
                  />
                </label>
              ))}
            </fieldset>
          );
        }
        if (q.kind === "text") {
          return (
            <label key={q.id} style={{ display: "block", marginBottom: "1rem" }}>
              {label}
              <textarea
                rows={3}
                value={a.value || ""}
                disabled={disabled}
                onChange={(e) => onChange(q.id, { value: e.target.value })}
              />
            </label>
          );
        }
        const choices = q.kind === "yesno" ? ["yes", "no"] : q.choices;
        const shown = (c) => (q.kind === "yesno" ? (c === "yes" ? "Yes" : "No") : c);
        return (
          <fieldset key={q.id} style={{ border: "none", padding: 0, margin: "0 0 1rem" }}>
            <legend style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{label}</legend>
            {choices.map((c) => (
              <label key={c} style={choiceRowStyle}>
                <input
                  style={choiceInputStyle}
                  type={q.kind === "multiple" ? "checkbox" : "radio"}
                  name={`q-${q.id}`}
                  disabled={disabled}
                  checked={q.kind === "multiple" ? (a.values || []).includes(c) : a.value === c}
                  onChange={(e) =>
                    q.kind === "multiple"
                      ? onChange(q.id, {
                          values: e.target.checked
                            ? [...(a.values || []), c]
                            : (a.values || []).filter((x) => x !== c),
                        })
                      : onChange(q.id, { value: c, other: "" })
                  }
                />
                <span>{shown(c)}</span>
              </label>
            ))}
            {q.allowOther && (
              <input
                type="text"
                aria-label={`Something else for ${q.label}`}
                placeholder="Something else"
                disabled={disabled}
                value={a.other || ""}
                onChange={(e) =>
                  onChange(
                    q.id,
                    q.kind === "single" ? { other: e.target.value, value: "" } : { other: e.target.value }
                  )
                }
              />
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

// [{ questionId, value, values, other }] for the API, from the form's answer map.
export function answersToPayload(questions, answers) {
  return questions.map((q) => ({
    questionId: q.id,
    value: answers[q.id]?.value || null,
    values: answers[q.id]?.values || [],
    other: answers[q.id]?.other || null,
  }));
}

// The form's answer map from saved answers.
export function answersFromSaved(saved = []) {
  return Object.fromEntries(
    saved
      .filter((a) => a.questionId)
      .map((a) => [a.questionId, { value: a.value || "", values: a.values || [], other: a.other || "" }])
  );
}

// One saved answer as a line of text.
export function describeSavedAnswer(a) {
  if (a.kind === "address") return formatAddressValue(a.value);
  const parts = [
    a.value && (a.kind === "yesno" ? (a.value === "yes" ? "Yes" : "No") : a.value),
    ...(a.values || []),
    a.other,
  ];
  return parts.filter(Boolean).join(", ");
}
