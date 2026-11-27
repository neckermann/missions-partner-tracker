import React, { useEffect, useId, useRef, useState } from "react";
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js/min";
import { useSettings } from "../../context/SettingsContext.jsx";
import { PHONE_COUNTRIES } from "../../utils/phoneCountries.js";

// A phone box with a country picker, that helps while you type and tells you when a number can't be
// right. Use it through <PhoneField> (components/shared/PhoneField.jsx), which adds the label.
//
// - The picker beside the box says which country the number is in; it starts on the church's country
//   (settings), or on the number's own country when it already has one. Type the number the way people
//   there write it ("0712 345678" in Kenya) and the value passed on is the full international number
//   (+254712345678), so it never depends on any default. Typing a number that starts with + switches the
//   picker to that number's country.
// - Digits shape themselves as you type at the end of the box: 5065550259 becomes (506) 555-0259.
//   Deleting, or typing in the middle of a number, leaves it exactly as typed so the cursor never jumps.
// - When you leave the box, a short note appears if the number can't be one. It never blocks saving: the
//   server checks again (backend/src/utils/contactFormat.js), and a blank box is always fine.
//
// `value` and `onChange(event)` work like an <input>'s, except the event's target.value is the international
// number as soon as it is a complete one (and the shaped text before that). Every other prop (required,
// maxLength, id, name, ...) goes to the input.
const DEFAULT_COUNTRY = "US";

const callingCode = (country) => {
  try {
    return getCountryCallingCode(country);
  } catch {
    return null;
  }
};

// Plain words for what is wrong, or "" when the number can be one (or the box is empty).
export function phoneHint(value, country = DEFAULT_COUNTRY) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const parsed = !/[a-z]/i.test(text) ? parsePhoneNumberFromString(text, country) : null;
  if (parsed && parsed.isPossible()) return "";
  if (text.startsWith("+")) return "That doesn't look like a complete number for that country. Check it.";
  return "That doesn't look like a phone number. Include the area code, or start with + and the country code.";
}

// The country a number belongs in: its own when it starts with + (kept as `fallback` when they share a
// calling code, so a +1 number stays on the church's North American country), else `fallback`.
function countryFor(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text.startsWith("+")) return fallback;
  const parsed = parsePhoneNumberFromString(text);
  if (!parsed) return fallback;
  if (parsed.countryCallingCode === callingCode(fallback)) return fallback;
  return (
    parsed.country || getCountries().find((c) => callingCode(c) === parsed.countryCallingCode) || fallback
  );
}

// A saved or typed number as it is written in `country`: (AAA) EEE-NNNN for North America, the country's own
// style elsewhere, and with its + when it belongs to a different country. What isn't a number is left alone.
function localText(value, country) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const parsed = parsePhoneNumberFromString(text, country);
  if (!parsed || !parsed.isPossible()) return text;
  if (parsed.countryCallingCode !== callingCode(country)) return parsed.formatInternational();
  if (parsed.countryCallingCode === "1" && parsed.nationalNumber.length === 10) {
    const n = parsed.nationalNumber;
    return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  return parsed.formatNational();
}

// What to pass on for the text in the box: the international number once it is a complete one, else the text.
function valueFor(text, country) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const parsed = trimmed.startsWith("+")
    ? parsePhoneNumberFromString(trimmed)
    : parsePhoneNumberFromString(trimmed, country);
  return parsed && parsed.isPossible() ? parsed.number : text;
}

export default function PhoneInput({ value, onChange, onBlur, country: countryProp, disabled, ...rest }) {
  const settings = useSettings() || {};
  const where = countryProp || settings.defaultPhoneCountry || DEFAULT_COUNTRY;
  const current = value ?? "";
  const [country, setCountry] = useState(() => countryFor(current, where));
  const [text, setText] = useState(() => localText(current, countryFor(current, where)));
  const [touched, setTouched] = useState(false);
  const lastPassedOn = useRef(current);
  const choseCountry = useRef(false);
  const hintId = useId();

  // A value that changed from outside (a form reset, a record loaded) replaces what is in the box.
  useEffect(() => {
    if (current === lastPassedOn.current) return;
    lastPassedOn.current = current;
    const c = countryFor(current, choseCountry.current ? country : where);
    setCountry(c);
    setText(localText(current, c));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new `value` should reset the box
  }, [current]);

  // The church's country arrives after the page loads; an empty box that nobody has touched follows it.
  useEffect(() => {
    if (!choseCountry.current && !current) setCountry(where);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the church's country only
  }, [where]);

  function pass(nextText, nextCountry, name) {
    const out = valueFor(nextText, nextCountry);
    lastPassedOn.current = out;
    onChange?.({ target: { name, value: out } });
  }

  function handleChange(e) {
    const el = e.target;
    const typed = el.value;
    const inputType = e.nativeEvent?.inputType || "insertText";
    const atEnd = el.selectionStart == null || el.selectionStart >= typed.length;
    // Shape only what is being added at the end; a delete or an edit in the middle is left as typed.
    const shaped =
      inputType.startsWith("insert") && atEnd && typed ? new AsYouType(country).input(typed) : typed;
    const nextCountry = countryFor(shaped, country);
    if (nextCountry !== country) setCountry(nextCountry);
    setText(shaped);
    pass(shaped, nextCountry, el.name);
  }

  function handleCountry(e) {
    const next = e.target.value;
    choseCountry.current = true;
    // Changing the country keeps the number's own digits and changes only the country they are read in: from
    // the complete number passed on, else from a typed + number, else from the digits typed so far.
    const passed = String(lastPassedOn.current || "").trim();
    const known = passed.startsWith("+")
      ? parsePhoneNumberFromString(passed)
      : text.trim().startsWith("+")
        ? parsePhoneNumberFromString(text.trim())
        : null;
    const digits = known ? known.nationalNumber : text.replace(/\D/g, "");
    const nextText = digits ? new AsYouType(next).input(digits) : "";
    setCountry(next);
    setText(nextText);
    pass(nextText, next, rest.name);
  }

  const hint = touched ? phoneHint(text, country) : "";
  const code = callingCode(country);

  return (
    <span className="phone-input">
      <span className="phone-country">
        <span className="phone-country-shown" aria-hidden="true">
          {country} +{code} <span className="phone-country-caret">▾</span>
        </span>
        <select
          aria-label="Country for this phone number"
          value={country}
          onChange={handleCountry}
          disabled={disabled}
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </span>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        {...rest}
        disabled={disabled}
        value={text}
        onChange={handleChange}
        onBlur={(e) => {
          setTouched(true);
          onBlur?.(e);
        }}
        aria-invalid={hint ? "true" : undefined}
        aria-describedby={hint ? hintId : rest["aria-describedby"]}
      />
      {hint && (
        <span id={hintId} role="status" className="phone-hint">
          {hint}
        </span>
      )}
    </span>
  );
}
