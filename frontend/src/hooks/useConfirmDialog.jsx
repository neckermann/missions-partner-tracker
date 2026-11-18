import React, { useCallback, useRef, useState } from "react";
import Modal from "../components/Modal.jsx";

// A styled, accessible stand-in for window.confirm()/prompt(), built on
// Modal.jsx -- the app's one confirmation pattern (CONTRIBUTING.md §
// Code style bans new window.confirm()/prompt() calls). `await
// confirm({...})` resolves to true/false like window.confirm, so callers
// keep their control flow; `body` is JSX instead of a string so it can
// lay out more than one flat line of text.
//
// `typedConfirmation: { word, label }` adds a stricter gate for a
// genuinely irreversible action (e.g. permanently deleting a partner) --
// Confirm stays disabled until the typed value matches `word`,
// case/whitespace-insensitive.
//
// `textInput: { label, placeholder?, rows? }` collects free text alongside
// the confirmation (e.g. a reason for declining something) -- rendered
// and owned by this hook itself, not by the caller's `body`, for the same
// reason `typedConfirmation`'s own input is: a controlled input whose
// value/onChange live inside the caller's `body` JSX would freeze at
// whatever it was when `confirm()` was called, since `dialog.body` is a
// snapshot stored once in this hook's own state, never recreated on every
// keystroke. Opt-in and additive -- a call that doesn't pass `textInput`
// gets back a plain boolean exactly as before; one that does gets back
// `{ confirmed, text }` instead, since the caller asking for text already
// expects a different shape.
export default function useConfirmDialog() {
  const [dialog, setDialog] = useState(null);
  const [typedValue, setTypedValue] = useState("");
  const [textInputValue, setTextInputValue] = useState("");
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
      textInput,
    }) =>
      new Promise((resolve) => {
        resolverRef.current = resolve;
        setTypedValue("");
        setTextInputValue("");
        setDialog({ title, body, confirmLabel, cancelLabel, danger, maxWidth, typedConfirmation, textInput });
      }),
    []
  );

  function settle(confirmed) {
    const hadTextInput = !!dialog?.textInput;
    const text = textInputValue.trim();
    setDialog(null);
    resolverRef.current?.(hadTextInput ? { confirmed, text: confirmed ? text : "" } : confirmed);
    resolverRef.current = null;
  }

  const typedConfirmation = dialog?.typedConfirmation;
  const typedMismatch =
    typedConfirmation && typedValue.trim().toLowerCase() !== typedConfirmation.word.toLowerCase();
  const textInput = dialog?.textInput;

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
      {textInput && (
        <label style={{ display: "block", marginTop: "1rem" }}>
          {textInput.label}
          <textarea
            rows={textInput.rows || 2}
            placeholder={textInput.placeholder}
            value={textInputValue}
            onChange={(e) => setTextInputValue(e.target.value)}
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
