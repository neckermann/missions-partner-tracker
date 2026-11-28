import React, { useState } from "react";
import {
  describeSupportAnswer,
  groupMenu,
  parseSupportAnswer,
  setSupportAnswer,
} from "../utils/supportAnswer.js";
import { streetHint } from "../utils/webAddress.js";
import { ADDRESS_PARTS, addressToValue, parseAddressValue, formatAddressValue } from "../utils/address.js";
import { formatPhone } from "../utils/phone.js";
import PhoneField from "./shared/PhoneField.jsx";
import EmailInput from "./shared/EmailInput.jsx";

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

// The box for a question linked to a field of the record (the server says which in `inputType`).
// A phone and an email use the shared boxes (they shape the number as you type and say so when you leave
// the box if it can't be one); a short line is a plain one-line input.
const LINE = { type: "text", autoComplete: "off", inputMode: "text" };

// The questions of a survey as a form, used on the partner's own page and when staff fill one in
// for them. `answers` is { [questionId]: { value, values, other } }; `onChange(questionId, patch)`.
// One box of the survey's mailing address. The first line (the street) gets a short note, when you leave it, if it
// is neither a street address nor a PO box; only a hint, it never blocks the answer.
function AddressPartInput({ streetLine, ...rest }) {
  const [touched, setTouched] = useState(false);
  const hint = streetLine && touched ? streetHint(rest.value) : "";
  return (
    <>
      <input type="text" {...rest} onBlur={() => setTouched(true)} aria-invalid={hint ? "true" : undefined} />
      {hint && (
        <span role="status" style={{ display: "block", color: "var(--danger)", fontSize: "0.85rem" }}>
          {hint}
        </span>
      )}
    </>
  );
}

export default function SurveyQuestions({
  questions,
  answers,
  onChange,
  disabled = false,
  onPhoto = null,
  photos = [],
  supportMenu = [],
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
        if (q.kind === "support") {
          const map = parseSupportAnswer(a.value);
          const set = (optionId, patch) => onChange(q.id, { value: setSupportAnswer(map, optionId, patch) });
          return (
            <fieldset key={q.id} style={{ border: "none", padding: 0, margin: "0 0 1rem" }}>
              <legend style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{label}</legend>
              {supportMenu.length === 0 && (
                <p style={{ color: "var(--muted)", margin: 0 }}>There is nothing to choose from yet.</p>
              )}
              {groupMenu(supportMenu).map(([group, options]) => (
                <div key={group} style={{ marginBottom: "0.75rem" }}>
                  <div style={{ fontWeight: 600, color: "var(--muted)" }}>{group}</div>
                  {options.map((o) => {
                    const mine = map[o.id] || {};
                    if (o.kind === "offer") {
                      return (
                        <label key={o.id} style={choiceRowStyle}>
                          <input
                            style={choiceInputStyle}
                            type="checkbox"
                            disabled={disabled}
                            checked={Boolean(mine.selected)}
                            onChange={(e) => set(o.id, { selected: e.target.checked })}
                          />
                          <span>{o.label}</span>
                        </label>
                      );
                    }
                    if (o.kind === "text") {
                      return (
                        <label key={o.id} style={{ display: "block", fontWeight: "normal" }}>
                          {o.label}
                          <textarea
                            rows={2}
                            disabled={disabled}
                            value={mine.text || ""}
                            onChange={(e) => set(o.id, { text: e.target.value })}
                          />
                        </label>
                      );
                    }
                    const multiple = o.kind === "multiple";
                    return (
                      <fieldset key={o.id} style={{ border: "none", padding: 0, margin: "0.25rem 0" }}>
                        <legend style={{ fontWeight: "normal" }}>{o.label}</legend>
                        {o.choices.map((c) => (
                          <label key={c} style={choiceRowStyle}>
                            <input
                              style={choiceInputStyle}
                              type={multiple ? "checkbox" : "radio"}
                              name={`s-${q.id}-${o.id}`}
                              disabled={disabled}
                              checked={multiple ? (mine.choices || []).includes(c) : mine.choice === c}
                              onChange={(e) =>
                                multiple
                                  ? set(o.id, {
                                      choices: e.target.checked
                                        ? [...(mine.choices || []), c]
                                        : (mine.choices || []).filter((x) => x !== c),
                                    })
                                  : set(o.id, { choice: c, other: "" })
                              }
                            />
                            <span>{c}</span>
                          </label>
                        ))}
                        {o.allowOther && (
                          <input
                            type="text"
                            aria-label={`Something else for ${o.label}`}
                            placeholder="Something else"
                            disabled={disabled}
                            value={mine.other || ""}
                            onChange={(e) =>
                              set(
                                o.id,
                                multiple ? { other: e.target.value } : { other: e.target.value, choice: "" }
                              )
                            }
                          />
                        )}
                      </fieldset>
                    );
                  })}
                </div>
              ))}
            </fieldset>
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
                  <AddressPartInput
                    streetLine={part.key === "line1"}
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
          // A question linked to a phone, an email or a short line of the record gets the box that
          // fits it (a phone keypad, an email keyboard, one line); anything else is a free text area.
          const box = {
            value: a.value || "",
            disabled,
            onChange: (e) => onChange(q.id, { value: e.target.value }),
          };
          if (q.inputType === "tel") {
            // A phone question owns its label (the picker and the box are separate controls).
            return (
              <PhoneField
                key={q.id}
                label={label}
                style={{ marginBottom: "1rem" }}
                {...box}
                maxLength={q.maxLength || 40}
              />
            );
          }
          return (
            <label key={q.id} style={{ display: "block", marginBottom: "1rem" }}>
              {label}
              {q.inputType === "email" ? (
                <EmailInput {...box} maxLength={q.maxLength || 200} />
              ) : q.inputType === "line" ? (
                <input
                  type={LINE.type}
                  autoComplete={LINE.autoComplete}
                  inputMode={LINE.inputMode}
                  maxLength={q.maxLength || 200}
                  {...box}
                />
              ) : (
                <textarea
                  rows={3}
                  value={a.value || ""}
                  disabled={disabled}
                  onChange={(e) => onChange(q.id, { value: e.target.value })}
                />
              )}
            </label>
          );
        }
        const choices = q.kind === "yesno" ? ["yes", "no"] : q.choices;
        const shown = (c) => (q.kind === "yesno" ? (c === "yes" ? "Yes" : "No") : q.labels?.[c] || c);
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

// One saved answer as a line of text. `question` (optional) is the survey question it answers: a
// phone is shown the way it is usually written, and a contact method in words.
export function describeSavedAnswer(a, supportMenu = [], question = null) {
  if (a.kind === "support") return describeSupportAnswer(a.value, supportMenu);
  if (a.kind === "address") return formatAddressValue(a.value);
  const word = (v) => (question?.inputType === "tel" ? formatPhone(v) : question?.labels?.[v] || v);
  const parts = [
    a.value && (a.kind === "yesno" ? (a.value === "yes" ? "Yes" : "No") : word(a.value)),
    ...(a.values || []),
    a.other,
  ];
  return parts.filter(Boolean).join(", ");
}
