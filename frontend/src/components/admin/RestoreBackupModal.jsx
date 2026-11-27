import React, { useState } from "react";
import Modal from "../Modal.jsx";
import { downloadBackup, restoreBackup } from "../../api/client.js";

export const MIN_PASSPHRASE_LENGTH = 8;
export const RESTORE_WORD = "RESTORE";

// Restoring REPLACES everything on the site with the file's contents. So: the admin's password again, the word
// RESTORE typed exactly, the file's passphrase if it is locked, and a plain list of what will happen. Step 1
// downloads a copy of what is there now (the server refuses a restore without one made in the last 15 minutes),
// so the restore can be undone; step 2 restores.
export default function RestoreBackupModal({ onClose }) {
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [lockSafety, setLockSafety] = useState(false);
  const [safetyPassphrase, setSafetyPassphrase] = useState("");
  const [safetyFile, setSafetyFile] = useState(""); // the copy saved in step 1
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const looksLocked = Boolean(file && /\.locked$/i.test(file.name));
  const ready =
    safetyFile && file && password && confirmation === RESTORE_WORD && (!looksLocked || passphrase);

  async function saveCopy() {
    setError("");
    if (!password) return setError("Enter your password to download the copy.");
    if (lockSafety && safetyPassphrase.length < MIN_PASSPHRASE_LENGTH) {
      return setError(`The passphrase for the copy must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    }
    setBusy(true);
    try {
      setSafetyFile(await downloadBackup({ password, passphrase: lockSafety ? safetyPassphrase : "" }));
    } catch (err) {
      setError(err.message || "The copy couldn't be downloaded.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!safetyFile) return setError("Download a copy of the current data first (step 1).");
    if (!file) return setError("Choose the backup file to restore.");
    if (!password) return setError("Enter your password to restore a backup.");
    if (confirmation !== RESTORE_WORD) return setError(`Type ${RESTORE_WORD} exactly to confirm.`);
    setBusy(true);
    try {
      await restoreBackup({
        file,
        password,
        confirmation,
        passphrase: looksLocked ? passphrase : "",
      });
      setPassword("");
      setPassphrase("");
      setSafetyPassphrase("");
      setDone(true);
    } catch (err) {
      setError(err.message || "The restore didn't go through. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Backup restored" onClose={() => window.location.assign("/login")}>
        <p>
          The site now has the contents of that backup. The copy of what was here just before is{" "}
          <strong>{safetyFile}</strong> — keep it until you are sure the restore is what you wanted. You can
          put it back with this same Restore button.
        </p>
        <p>You will be asked to sign in again.</p>
        <div className="table-actions" style={{ marginTop: "1rem" }}>
          <button type="button" className="btn" onClick={() => window.location.assign("/login")}>
            Sign in
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Restore from a backup" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="field-warning">
          This <strong>replaces everything</strong> on the site — partners, users, files, settings — with what
          is in the backup. Anything added since the backup was made is lost. Nothing is changed if the file
          fails its checks or anything goes wrong partway.
        </p>
        <ul style={{ margin: "0.5rem 0 1rem 1.25rem", color: "var(--muted)", fontSize: "0.9rem" }}>
          <li>Step 1 downloads a copy of the current data first, so you can undo this.</li>
          <li>
            The site can't save other changes, and scheduled emails wait, while it runs (a few minutes).
          </li>
          <li>You will be signed out afterwards. WhatsApp, if linked, needs linking again.</li>
          <li>A backup over 1 GB can't be uploaded here; use the restore command in the Admin Guide.</li>
        </ul>
        <h4 style={{ margin: "0.5rem 0 0.25rem" }}>Step 1: save a copy of what is here now</h4>
        <label>
          Your password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        <div className="admin-checkbox-row" style={{ marginTop: "0.75rem" }}>
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={lockSafety}
              onChange={(e) => setLockSafety(e.target.checked)}
              disabled={busy || Boolean(safetyFile)}
            />
            Lock the copy with a passphrase
          </label>
        </div>
        {lockSafety && !safetyFile && (
          <label style={{ marginTop: "0.5rem" }}>
            Passphrase for the copy
            <input
              type="password"
              autoComplete="new-password"
              value={safetyPassphrase}
              onChange={(e) => setSafetyPassphrase(e.target.value)}
              disabled={busy}
            />
            <span style={{ display: "block", color: "var(--muted)", fontSize: "0.85rem" }}>
              If you lose it, nobody can open that copy, including us.
            </span>
          </label>
        )}
        <div className="table-actions" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="btn secondary"
            onClick={saveCopy}
            disabled={busy || Boolean(safetyFile)}
          >
            {safetyFile ? "Copy saved" : "Download a copy"}
          </button>
          {safetyFile && <span style={{ color: "var(--muted)" }}>Saved as {safetyFile}</span>}
        </div>
        <h4 style={{ margin: "1.25rem 0 0.25rem" }}>Step 2: restore</h4>
        <label>
          Backup file
          <input
            type="file"
            accept=".gz,.locked,application/gzip,application/octet-stream"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={busy}
          />
        </label>
        {looksLocked && (
          <label style={{ marginTop: "0.75rem" }}>
            This backup is locked. Its passphrase
            <input
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        <label style={{ marginTop: "0.75rem" }}>
          Type {RESTORE_WORD} to confirm
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </label>
        {error && (
          <p className="form-error" role="alert" style={{ marginTop: "0.75rem" }}>
            {error}
          </p>
        )}
        <div className="table-actions" style={{ marginTop: "1rem" }}>
          <button type="submit" className="btn danger" disabled={busy || !ready}>
            {busy ? "Restoring… please wait" : "Restore and replace everything"}
          </button>
          <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
