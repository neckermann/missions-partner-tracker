import React from "react";

// The note under a field ("That doesn't look like an email address."). It is drawn invisibly (it keeps its place
// on the page) as soon as the value would earn the note, and shown when the person leaves the box. That way
// leaving the box never moves what is below it: if it did, a tap on the Save button just underneath would only
// blur the box, the hint would push the button away, and the tap would be lost. A value that needs no note
// reserves nothing, so a valid field has no blank gap.
//
// `text` is the note the current value would get ("" for none); `show` is whether the box has been left.
// Pass `id` to the field's aria-describedby only while `show` is true.
export default function FieldHint({ id, text, show, className, color = "var(--danger)", style }) {
  if (!text) return null;
  return (
    <span
      id={id}
      className={className}
      role={show ? "status" : undefined}
      aria-hidden={show ? undefined : true}
      style={{
        display: "block",
        color,
        fontSize: "0.85rem",
        visibility: show ? "visible" : "hidden",
        ...style,
      }}
    >
      {text}
    </span>
  );
}
