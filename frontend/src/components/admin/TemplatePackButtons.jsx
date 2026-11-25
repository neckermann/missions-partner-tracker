import React, { useState } from "react";
import { previewTemplatePack, importTemplatePack, templatePackExportUrl } from "../../api/client.js";
import Modal from "../Modal.jsx";

// Where example packs live, for anyone who wants a starting point.
export const EXAMPLE_PACKS_URL =
  "https://github.com/neckermann/missions-partner-tracker/tree/main/examples/template-packs";

// Import (and optionally Export) buttons for one kind of template pack. Import takes a .json file
// or pasted text, shows what it would do, and only adds on confirm. `onImported` reloads the page's
// data. `exportParams` adds query parameters (a survey's id); leave `exportKind` out for none.
export default function TemplatePackButtons({
  importLabel = "Import…",
  exportKind,
  exportParams,
  onImported,
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setText("");
    setPreview(null);
    setError("");
    setDone("");
  }
  function close() {
    setOpen(false);
    reset();
  }

  async function readFile(file) {
    if (!file) return;
    setError("");
    setPreview(null);
    setText(await file.text());
  }

  async function check() {
    setBusy(true);
    setError("");
    try {
      setPreview(await previewTemplatePack(text));
    } catch (err) {
      setPreview(null);
      setError(err.response?.data?.error || "Couldn't read that pack");
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setBusy(true);
    setError("");
    try {
      const r = await importTemplatePack(text);
      setDone(r.message);
      await onImported?.(r);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't import that pack");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn secondary" onClick={() => setOpen(true)}>
        {importLabel}
      </button>
      {exportKind && (
        <a className="btn secondary" href={templatePackExportUrl(exportKind, exportParams)} download>
          Export
        </a>
      )}
      {open && (
        <Modal title="Import a template pack" onClose={close} maxWidth="640px">
          {done ? (
            <>
              <p role="status" style={{ color: "var(--accent)" }}>
                {done}
              </p>
              <button type="button" className="btn" onClick={close}>
                Done
              </button>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0, color: "var(--muted)" }}>
                A template pack is a small JSON file. Importing only adds to what you have; nothing is
                deleted. Not sure where to start? There are{" "}
                <a href={EXAMPLE_PACKS_URL} target="_blank" rel="noopener noreferrer">
                  example packs
                </a>{" "}
                you can download.
              </p>
              <label>
                Choose a .json file
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => readFile(e.target.files?.[0])}
                />
              </label>
              <label>
                …or paste it here
                <textarea
                  rows={6}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {preview && (
                <div className="admin-section" style={{ marginTop: "0.75rem" }}>
                  <strong>
                    {preview.kindLabel}: {preview.title}
                  </strong>
                  {preview.description && (
                    <p style={{ color: "var(--muted)", margin: "0.25rem 0" }}>{preview.description}</p>
                  )}
                  <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                    {preview.summary.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                {!preview ? (
                  <button type="button" className="btn" disabled={busy || !text.trim()} onClick={check}>
                    Check this pack
                  </button>
                ) : (
                  <button type="button" className="btn" disabled={busy} onClick={doImport}>
                    Import
                  </button>
                )}
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
