import React, { useId, useRef, useState } from "react";

// A text field that suggests values as you type but still accepts anything. Used instead of a
// <datalist>, whose suggestions are missing or unreliable in many mobile browsers (a tap on the
// field shows nothing, or a picker that can't be scrolled). Suggestions appear on focus and as you
// type; tapping or pressing Enter on one fills the field. `value`/`onChange(string)` as a plain input.
export default function SuggestInput({ value, onChange, options, placeholder, id, required, ...rest }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const blurTimer = useRef(null);

  const q = String(value || "")
    .trim()
    .toLowerCase();
  const matches = options
    .filter((o) => !q || o.toLowerCase().includes(q))
    .sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)))
    .slice(0, 8)
    .filter((o) => o.toLowerCase() !== q);

  function pick(option) {
    onChange(option);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e) {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <span style={{ position: "relative", display: "block" }}>
      <input
        {...rest}
        id={id}
        required={required}
        value={value || ""}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          clearTimeout(blurTimer.current);
          setOpen(true);
        }}
        // Delay closing so a tap on a suggestion registers before the list goes away.
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="suggest-list">
          {matches.map((o, i) => (
            <li key={o} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? "suggest-option active" : "suggest-option"}
                // pointerdown (not click) so it fires before the input loses focus.
                onPointerDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
