import React, { useState } from "react";

// Generic multi-step form shell with no resource-specific logic.
// `steps`: [{ key, label, render({ values, setValue }), validate?(values) => string|null,
// optional?, show?(values) => boolean }], shown one at a time. `show` false leaves a step out
// entirely; a non-empty `validate` string blocks Next and is shown as the error; `optional` adds
// Skip. Nothing here calls an API: `onFinish(values)` fires after the last step validates, and
// `finishing: true` (set by the caller while its call is in flight) disables the last button.
export default function Wizard({
  steps: allSteps,
  initialValues = {},
  onFinish,
  onCancel,
  finishing = false,
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState(null);
  const steps = allSteps.filter((s) => !s.show || s.show(values));

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
      {/* Decorative step-dot bar; omitted for a one-step wizard. */}
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
              color: i === stepIndex ? undefined : "var(--muted)",
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
