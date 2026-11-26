import React, { useState } from "react";
import Modal from "../Modal.jsx";
import { restoreBackup } from "../../api/client.js";

export const MIN_PASSPHRASE_LENGTH = 8;
export const RESTORE_WORD = "RESTORE";

// Restoring REPLACES everything on the site with the file's contents. So: the admin's password again, the word
// RESTORE typed exactly, the file's passphrase if it is locked, and a plain list of what will happen. A copy of
// what is there now downloads automatically when it finishes, so the restore can be undone.
export default function RestoreBackupModal({ onClose }) {
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [lockSafety, setLockSafety] = useState(false);
  const [safetyPassphrase, setSafetyPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // { safetyFile }

  const looksLocked = Boolean(file && /\.locked$/i.test(file.name));
  const ready = file && password && confirmation === RESTORE_WORD && (!looksLocked || passphrase);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!file) return setError("Choose the backup file to restore.");
    if (!password) return setError("Enter your password to restore a backup.");
    if (confirmation !== RESTORE_WORD) return setError(`Type ${RESTORE_WORD} exactly to confirm.`);
    if (lockSafety && safetyPassphrase.length < MIN_PASSPHRASE_LENGTH) {
      return setError(
        `The passphrase for the safety copy must be at least ${MIN_PASSPHRASE_LENGTH} characters.`
      );
    }
    setBusy(true);
    try {
      const safetyFile = await restoreBackup({
        file,
        password,
        confirmation,
        passphrase: looksLocked ? passphrase : "",
        safetyPassphrase: lockSafety ? safetyPassphrase : "",
      });
      setPassword("");
      setPassphrase("");
      setSafetyPassphrase("");
      setDone({ safetyFile });
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
          The site now has the contents of that backup. A copy of what was here just before downloaded as{" "}
          <strong>{done.safetyFile}</strong> — keep it until you are sure the restore is what you wanted. You
          can put it back with this same Restore button.
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
          <li>A copy of the current data downloads automatically when it finishes, so you can undo this.</li>
          <li>The site can't save other changes for a minute or two while it runs.</li>
          <li>You will be signed out afterwards. WhatsApp, if linked, needs linking again.</li>
          <li>Very large backups can't be restored here; use the restore command in the Admin Guide.</li>
        </ul>
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
              disabled={busy}
            />
            Lock the safety copy with a passphrase
          </label>
        </div>
        {lockSafety && (
          <label style={{ marginTop: "0.5rem" }}>
            Passphrase for the safety copy
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
