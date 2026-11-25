import React, { useEffect, useRef } from "react";

// An accessible dialog: announces itself labelled by its heading (`title`, via aria-labelledby),
// moves focus in and restores it on close, traps Tab, and closes on Escape or an outside click.
export default function Modal({ title, onClose, children, maxWidth = "40rem" }) {
  const panelRef = useRef(null);
  const headingId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);
  const previouslyFocused = useRef(null);
  // Read by the keydown listener instead of listing onClose in the effect deps: callers rarely
  // memoize it, so deps would re-run the effect (and its focus call) on every parent render and
  // steal focus from the input being typed in.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    previouslyFocused.current = document.activeElement;

    // Focus the panel, not the first control, so a screen reader announces the title first.
    panelRef.current?.focus();

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
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

      // Wrap at both ends, and catch focus that has escaped the panel.
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
      // Return focus to whatever opened this.
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      // role="presentation" is accurate, not a lint dodge: the backdrop is not a control, and Escape is
      // the keyboard equivalent of clicking it.
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
