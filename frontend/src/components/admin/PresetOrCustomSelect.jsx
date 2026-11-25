import React, { useRef, useState } from "react";

// A <select> of common presets with an "Other (specify)" option that swaps in a free-text input.
// isCustom is re-derived when `value` changes from outside (callers reuse one mounted instance
// across records, so a preset-to-custom switch would otherwise keep the previous control).
// selfInitiated marks changes this component made itself, which keep their own isCustom.
export default function PresetOrCustomSelect({ value, onChange, presets, placeholder }) {
  const [isCustom, setIsCustom] = useState(Boolean(value) && !presets.includes(value));
  const [prevValue, setPrevValue] = useState(value);
  const selfInitiated = useRef(false);

  if (value !== prevValue) {
    setPrevValue(value);
    if (selfInitiated.current) {
      selfInitiated.current = false;
    } else {
      setIsCustom(Boolean(value) && !presets.includes(value));
    }
  }

  function emit(newValue) {
    selfInitiated.current = true;
    onChange(newValue);
  }

  if (isCustom) {
    return (
      <>
        <input value={value || ""} onChange={(e) => emit(e.target.value)} placeholder={placeholder} />
        <button
          type="button"
          className="btn secondary small"
          style={{ marginTop: "0.4rem" }}
          onClick={() => {
            setIsCustom(false);
            emit("");
          }}
        >
          Choose from list instead
        </button>
      </>
    );
  }

  return (
    <select
      value={value || ""}
      onChange={(e) => {
        if (e.target.value === "__other__") {
          setIsCustom(true);
          emit("");
        } else {
          emit(e.target.value);
        }
      }}
    >
      <option value="">Not specified</option>
      {presets.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
      <option value="__other__">Other (specify)</option>
    </select>
  );
}
