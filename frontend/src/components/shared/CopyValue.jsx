import React from "react";
import CopyButton from "./CopyButton.jsx";
import { copyablePhone, formatPhone } from "../../utils/phone.js";

// A value people paste elsewhere (a phone number or an email address) with a small copy button beside it.
//
// Many of the places it sits are clickable: an editable section opens its edit form when you click it, and a table
// row opens its record. So the click and the key presses on this stay here and never reach the section or the row.
// The button is a real button named for what it copies ("Copy Pat's phone number"), and what is copied is the
// saved form: a phone as "+15065550259" (it dials from anywhere), an email as saved. A blank value shows nothing.
//
// Never use it for a value that is withheld (a partner not to be contacted directly, a restricted record): the
// caller shows nothing there, so there is nothing to copy.
export default function CopyValue({ kind, value, whose, children }) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const isPhone = kind === "phone";
  const text = isPhone ? copyablePhone(raw) : raw;
  const noun = isPhone ? "phone number" : "email address";
  const label = whose ? `Copy ${whose}'s ${noun}` : `Copy ${noun}`;
  const stop = (e) => e.stopPropagation();
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <span className="copy-value" onClick={stop} onKeyDown={stop}>
      {/* The text may wrap anywhere (a long email address must not push the page wider than a phone screen);
          the button follows it and may drop to the next line rather than overflow. */}
      <span style={{ overflowWrap: "anywhere" }}>{children ?? (isPhone ? formatPhone(raw) : raw)}</span>{" "}
      <CopyButton
        text={text}
        label={label}
        copiedLabel={`Copied ${text}`}
        className="btn secondary small copy-value-btn"
      />
    </span>
  );
}
