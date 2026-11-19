import React, { useState } from "react";

// Generic multi-step form shell -- zero resource-specific logic, so a
// "New Partner" or "New Trip" flow (Phase 6 of the UX-rebuild plan)
// wires its own step content in without this component knowing what a
// Partner or a Trip is.
//
// `steps` is `[{ key, label, render({ values, setValue }), validate?(values)
// => string|null, optional? }]`, rendered one at a time. `validate`
// returning a non-empty string blocks Next and shows that string as the
// step's error; returning null/undefined (or omitting `validate`) means
// the step always passes. `optional: true` adds a Skip control alongside
// Next, for a step that's genuinely not required to finish the wizard
// (e.g. an advanced/rarely-filled-in section).
//
// Fully controlled on completion: nothing here calls an API. `onFinish
// (values)` fires after Next on the last step passes validation; the
// caller decides what "finishing" means. Pass `finishing: true` while
// that call is in flight to disable the last step's button and prevent
// a double-submit -- this component has no idea whether `onFinish` is
// sync or async, so it can't infer that state on its own.
export default function Wizard({ steps, initialValues = {}, onFinish, onCancel, finishing = false }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState(null);

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  function setValue(name, value) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  function goNext() {
    const validationError = step.validate ? step.validate(values) : null;
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    if (isLast) {
      onFinish?.(values);
      return;
    }
    setStepIndex((i) => i + 1);
  }

  function goBack() {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  function skip() {
    setError(null);
    if (isLast) {
      onFinish?.(values);
      return;
    }
    setStepIndex((i) => i + 1);
  }

  return (
    <div className="wizard">
      {/* Purely decorative step-dot bar, matching the design-reference
          artifact's .wizard-progress -- not shown for a 1-step wizard
          (e.g. New User), the same call that artifact's own "New User"
          example makes: a progress bar isn't worth showing when there's
          only one step to begin with. */}
      {steps.length > 1 && (
        <div className="wizard-progress">
          {steps.map((s, i) => (
            <div key={s.key} className={i <= stepIndex ? "done" : undefined} />
          ))}
        </div>
      )}
      <div className="wizard-steps" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {steps.map((s, i) => (
          <span
            key={s.key}
            className={i === stepIndex ? "wizard-step-label active" : "wizard-step-label"}
            style={{
              fontSize: "0.8rem",
              fontWeight: i === stepIndex ? 700 : 400,
              color: i === stepIndex ? undefined : "#888",
            }}
          >
            {i + 1}. {s.label}
          </span>
        ))}
      </div>

      <div className="wizard-step-body" style={{ marginTop: "1rem" }}>
        {step.render({ values, setValue })}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="form-save-bar" style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        {stepIndex > 0 && (
          <button type="button" className="btn secondary" onClick={goBack}>
            Back
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        {step.optional && (
          <button type="button" className="btn secondary" onClick={skip}>
            Skip
          </button>
        )}
        <button type="button" className="btn" onClick={goNext} disabled={isLast && finishing}>
          {isLast ? (finishing ? "Submitting..." : "Finish") : "Next"}
        </button>
      </div>
    </div>
  );
}
