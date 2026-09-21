import React, { useEffect, useRef } from "react";

// An accessible dialog, done once.
//
// The app's only modal previously did none of this: no role, no
// aria-modal, no label, no Escape handler, no focus management. The
// background stayed fully interactive behind the overlay, and the only way
// out was clicking -- so a keyboard or screen-reader user could neither
// tell a dialog had opened nor leave it.
//
// What this handles:
//   - announces itself as a dialog, labelled by its own heading
//   - moves focus in on open and restores it to the trigger on close
//   - traps Tab inside, so the background can't be reached while it's open
//   - closes on Escape, and on a click outside the panel
//
// `title` is rendered as the heading and referenced by aria-labelledby, so
// the two can't drift apart.
export default function Modal({ title, onClose, children, maxWidth = "40rem" }) {
  const panelRef = useRef(null);
  const headingId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;

    // Focus the panel itself rather than the first control: a screen reader
    // then announces the dialog and its title before its contents.
    panelRef.current?.focus();

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Wrap at both ends, and catch the case where focus has somehow
      // escaped the panel entirely.
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Return focus to whatever opened this, so the user doesn't get
      // dumped back at the top of the document.
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      // role="presentation" is accurate, not a lint dodge: the backdrop
      // carries no content and is not a control. Clicking it to dismiss is a
      // mouse convenience layered on top, and Escape above is the keyboard
      // equivalent -- so there is nothing here a keyboard user is missing.
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="admin-section modal-panel"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId.current}
        tabIndex={-1}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 id={headingId.current} style={{ marginBottom: 0 }}>
            {title}
          </h3>
          <button type="button" className="btn secondary small" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
