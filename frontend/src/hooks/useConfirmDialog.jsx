import React, { useCallback, useRef, useState } from "react";
import Modal from "../components/Modal.jsx";

// A styled, accessible stand-in for window.confirm()/prompt() -- built on
// the app's existing Modal.jsx (focus trap, Escape, labelled dialog)
// rather than the native browser dialogs, which have no styling hook at
// all and read as a plain OS alert regardless of what this app looks
// like. This is the app's one confirmation pattern -- see CONTRIBUTING.md
// § Code style for the standing rule: no new window.confirm()/confirm()/
// prompt() for anything a user sees, use this hook instead.
//
// Same call shape as window.confirm: `await confirm({...})` resolves to
// true/false, so a caller already written as
// `if (!(await confirmSomething())) return;` only needs its confirm
// function's *body* replaced, not its surrounding control flow. `body` is
// JSX, not a string -- the caller can lay out a recipient list, a quoted
// block of text, or a warning callout properly instead of folding
// everything into one window.confirm string with literal "\n\n"s.
//
// `typedConfirmation: { word, label }` is the window.confirm()-has-no-
// equivalent case: a stricter gate for the rare, genuinely irreversible
// action (permanently deleting a partner, not just archiving one) where
// a single click is too easy to make by accident. The Confirm button
// stays disabled until the typed value matches `word`, case/whitespace
// -insensitive, same leniency the old prompt()-based check already had.
export default function useConfirmDialog() {
  const [dialog, setDialog] = useState(null);
  const [typedValue, setTypedValue] = useState("");
  const resolverRef = useRef(null);

  const confirm = useCallback(
    ({
      title,
      body,
      confirmLabel = "Confirm",
      cancelLabel = "Cancel",
      danger = false,
      maxWidth,
      typedConfirmation,
    }) =>
      new Promise((resolve) => {
        resolverRef.current = resolve;
        setTypedValue("");
        setDialog({ title, body, confirmLabel, cancelLabel, danger, maxWidth, typedConfirmation });
      }),
    []
  );

  function settle(result) {
    setDialog(null);
    resolverRef.current?.(result);
    resolverRef.current = null;
  }

  const typedConfirmation = dialog?.typedConfirmation;
  const typedMismatch =
    typedConfirmation && typedValue.trim().toLowerCase() !== typedConfirmation.word.toLowerCase();

  const confirmElement = dialog ? (
    <Modal title={dialog.title} onClose={() => settle(false)} maxWidth={dialog.maxWidth}>
      {dialog.body}
      {typedConfirmation && (
        <label style={{ display: "block", marginTop: "1rem" }}>
          {typedConfirmation.label}
          <input
            type="text"
            value={typedValue}
            onChange={(e) => setTypedValue(e.target.value)}
            autoFocus
            style={{ display: "block", marginTop: "0.35rem", width: "100%" }}
          />
        </label>
      )}
      <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          className={`btn small${dialog.danger ? " danger" : ""}`}
          onClick={() => settle(true)}
          disabled={typedMismatch}
        >
          {dialog.confirmLabel}
        </button>
        <button type="button" className="btn secondary small" onClick={() => settle(false)}>
          {dialog.cancelLabel}
        </button>
      </div>
    </Modal>
  ) : null;

  return { confirm, confirmElement };
}
