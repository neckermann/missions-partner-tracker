import React, { useState } from "react";

// A <select> of common presets with a "Other (specify)" option that swaps
// in a free-text input. Same pattern as the Preferred Contact Method field.
export default function PresetOrCustomSelect({ value, onChange, presets, placeholder }) {
  const [isCustom, setIsCustom] = useState(Boolean(value) && !presets.includes(value));

  if (isCustom) {
    return (
      <>
        <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        <button
          type="button"
          className="btn secondary small"
          style={{ marginTop: "0.4rem" }}
          onClick={() => {
            setIsCustom(false);
            onChange("");
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
          onChange("");
        } else {
          onChange(e.target.value);
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
