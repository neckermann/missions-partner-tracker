import React, { useId, useState } from "react";
import { webAddressHint } from "../../utils/webAddress.js";

// A web address box: the URL keyboard on a phone and, when you leave it, a short note if what you typed isn't a
// web address. A drop-in for <input>: same `value` and `onChange(event)`, every other prop goes to the input. It
// never blocks saving (the server checks again and saves "example.org" as "https://example.org"), and a blank box
// is always fine.
export default function WebAddressInput({ value, onBlur, ...rest }) {
  const [touched, setTouched] = useState(false);
  const hintId = useId();
  const current = value ?? "";
  const hint = touched ? webAddressHint(current) : "";
  return (
    <>
      <input
        type="text"
        inputMode="url"
        autoComplete="url"
        autoCapitalize="none"
        spellCheck={false}
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
