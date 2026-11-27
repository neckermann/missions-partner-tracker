import React, { useId, useState } from "react";

// An email box that shows the email keyboard and, when you leave it, a short note if what you
// typed can't be an address. A drop-in for <input>: same `value` and `onChange(event)`, and every
// other prop goes straight to the input. It never blocks saving: the server checks again
// (backend/src/utils/contactFormat.js), and a blank box is always fine. Nothing is reshaped while
// you type; the server saves the address in lower case.
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Plain words for what is wrong, or "" when it can be an address (or the box is empty).
export function emailHint(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return SHAPE.test(text) && text.length <= 200 ? "" : "That doesn't look like an email address.";
}

export default function EmailInput({ value, onBlur, ...rest }) {
  const [touched, setTouched] = useState(false);
  const hintId = useId();
  const current = value ?? "";
  const hint = touched ? emailHint(current) : "";
  return (
    <>
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        {...rest}
        value={current}
        onBlur={(e) => {
          setTouched(true);
          onBlur?.(e);
        }}
        aria-invalid={hint ? "true" : undefined}
        aria-describedby={hint ? hintId : rest["aria-describedby"]}
      />
      {hint && (
        <span
          id={hintId}
          role="status"
          style={{ display: "block", color: "var(--danger)", fontSize: "0.85rem" }}
        >
          {hint}
        </span>
      )}
    </>
  );
}
