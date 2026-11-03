import React, { useRef, useState } from "react";

// A <select> of common presets with a "Other (specify)" option that swaps
// in a free-text input. Same pattern as the Preferred Contact Method field.
//
// isCustom re-derives itself whenever `value` changes for a reason other
// than this component's own onChange call -- several callers (the Trip
// Add/Edit form in PartnerTripSection.jsx/AdminTripHistory.jsx, Preferred
// Contact Method in AdminPartnerDetail.jsx) reuse the same mounted
// instance across different records rather than remounting it, so without
// this, switching to a record whose value is a custom string right after
// viewing one whose value was a preset (or vice versa) would keep
// whichever control the previous record happened to need. selfInitiated
// distinguishes "I just told the parent to change value" (keep whatever
// isCustom this component's own handlers already decided) from "the
// parent changed value out from under me" (re-derive from the new value).
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
