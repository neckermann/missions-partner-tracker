import React, { useEffect, useRef, useState } from "react";

// Copies `text` to the clipboard from a small icon button, then shows a check and "Copied" for a
// moment. Used wherever the app shows a link, code or password someone has to send or type
// elsewhere. Falls back to selecting a hidden field when the clipboard API is blocked (an insecure
// page, a denied permission). `label` is what the button is called for assistive tech and the
// tooltip ("Copy link"); the visible text is just the icon unless `showText` is set.
async function writeToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(field);
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" strokeWidth="1.4" />
      <path
        d="M10.5 3.5v-.2A1.3 1.3 0 0 0 9.2 2H3.8A1.8 1.8 0 0 0 2 3.8v5.4A1.3 1.3 0 0 0 3.3 10.5h.2"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor">
      <path d="M3 8.5l3.2 3.2L13 4.8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied!",
  showText = false,
  className = "btn secondary small",
}) {
  const [state, setState] = useState("idle"); // "idle" | "copied" | "failed"
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    const ok = await writeToClipboard(text);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  const name =
    state === "copied" ? copiedLabel : state === "failed" ? "Couldn't copy, select it by hand" : label;
  return (
    <button
      type="button"
      className={className}
      onClick={copy}
      aria-label={name}
      title={name}
      style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", flexShrink: 0 }}
    >
      {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      {showText && <span>{state === "copied" ? "Copied!" : "Copy"}</span>}
    </button>
  );
}
