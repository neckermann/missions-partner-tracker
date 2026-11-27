import React, { useId } from "react";
import PhoneInput from "./PhoneInput.jsx";

// A labelled phone field: the label, the country picker, the box and the hint, in one piece. The label
// belongs to the box through htmlFor (not by wrapping it), so a screen reader reads "Phone" and the picker is
// named separately. Every other prop goes to <PhoneInput>. `style` and `className` are for the wrapper.
export default function PhoneField({ label, id, className, style, ...rest }) {
  const auto = useId();
  const inputId = id || auto;
  return (
    <div className={["phone-field", className].filter(Boolean).join(" ")} style={style}>
      <label htmlFor={inputId}>{label}</label>
      <PhoneInput id={inputId} {...rest} />
    </div>
  );
}
