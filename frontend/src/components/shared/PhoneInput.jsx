import React, { useId, useState } from "react";
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js/min";
import { useSettings } from "../../context/SettingsContext.jsx";

// A phone box that helps while you type and tells you when a number can't be right. It is a drop-in
// for <input>: same `value` and `onChange(event)` (the event's `target.value` is the shaped number),
// and every other prop (required, maxLength, autoComplete, ...) goes straight to the input.
//
// - While you type at the end of the box the digits shape themselves: 5065550259 becomes
//   (506) 555-0259, and +442079460958 becomes +44 20 7946 0958. Typing in the middle, and deleting,
//   leave what you typed alone so the cursor never jumps.
// - When you leave the box, a short note appears if the number can't be one. It never blocks saving:
//   the server checks again (backend/src/utils/contactFormat.js), and a blank box is always fine.
// - A number with no "+" is read in the church's default country (settings), the United States until
//   a church sets another.
const DEFAULT_COUNTRY = "US";

// Plain words for what is wrong, or "" when the number can be one (or the box is empty).
export function phoneHint(value, country = DEFAULT_COUNTRY) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const parsed = !/[a-z]/i.test(text) ? parsePhoneNumberFromString(text, country) : null;
  if (parsed && parsed.isPossible()) return "";
  if (text.startsWith("+")) return "That doesn't look like a complete number for that country. Check it.";
  return "That doesn't look like a phone number. Include the area code, or start with + and the country code.";
}

export default function PhoneInput({ value, onChange, onBlur, country, ...rest }) {
  const settings = useSettings() || {};
  const where = country || settings.defaultPhoneCountry || DEFAULT_COUNTRY;
  const [touched, setTouched] = useState(false);
  const hintId = useId();
  const current = value ?? "";
  const hint = touched ? phoneHint(current, where) : "";

  function handleChange(e) {
    const el = e.target;
    const typed = el.value;
    const inputType = e.nativeEvent?.inputType || "insertText";
    const atEnd = el.selectionStart == null || el.selectionStart >= typed.length;
    // Shape only what is being added at the end; a delete or an edit in the middle is left as typed.
    const shaped =
      inputType.startsWith("insert") && atEnd && typed ? new AsYouType(where).input(typed) : typed;
    onChange?.({ target: { name: el.name, value: shaped } });
  }

  return (
    <>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        {...rest}
        value={current}
        onChange={handleChange}
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
