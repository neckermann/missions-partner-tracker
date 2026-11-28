import React, { useState } from "react";
import Modal from "../Modal.jsx";
import { downloadBackup } from "../../api/client.js";

export const MIN_PASSPHRASE_LENGTH = 8;

// The backup holds everything, unmasked, so the download asks for the admin's password again, and offers to
// lock the file with a passphrase. The passphrase is never stored: forgetting it means nobody can open the file.
export default function BackupDownloadModal({ onClose }) {
  const [password, setPassword] = useState("");
  const [lock, setLock] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAs, setSavedAs] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!password) return setError("Enter your password to download a backup.");
    if (lock) {
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        return setError(`The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      }
      if (passphrase !== again) return setError("The two passphrases don't match.");
    }
    setBusy(true);
    try {
      setSavedAs(await downloadBackup({ password, passphrase: lock ? passphrase : "" }));
      setPassword("");
      setPassphrase("");
      setAgain("");
    } catch (err) {
      setError(err.message || "Couldn't download the backup.");
    } finally {
      setBusy(false);
    }
  }

  if (savedAs) {
    return (
      <Modal title="Backup downloaded" onClose={onClose}>
        <p>
          Saved as <strong>{savedAs}</strong>. Keep it somewhere only trusted people can reach.
        </p>
        {lock && (
          <p className="field-warning">
            This file is locked with your passphrase. Keep the passphrase somewhere separate from the file: if
            it is lost, nobody can open the backup, including us.
          </p>
        )}
        <div className="table-actions" style={{ marginTop: "1rem" }}>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Download a backup" onClose={onClose}>
      <form onSubmit={submit}>
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
        <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={lock}
              onChange={(e) => setLock(e.target.checked)}
              disabled={busy}
            />
            Lock the file with a passphrase (recommended)
          </label>
        </div>
        {lock && (
          <>
            <label style={{ marginTop: "0.75rem" }}>
              Passphrase
              <input
                type="password"
                autoComplete="new-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                disabled={busy}
              />
            </label>
            <label style={{ marginTop: "0.75rem" }}>
              Passphrase again
              <input
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                disabled={busy}
              />
            </label>
            <p className="field-warning" style={{ marginTop: "0.75rem" }}>
              If you lose this passphrase, nobody can open the backup, including us: it cannot be recovered or
              reset. Write it down somewhere safe, separate from the file.
            </p>
          </>
        )}
        {!lock && (
          <p style={{ color: "var(--muted)", marginTop: "0.75rem", fontSize: "0.9rem" }}>
            Without a passphrase, anyone who gets the file can read everything in it.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert" style={{ marginTop: "0.75rem" }}>
            {error}
          </p>
        )}
        <div className="table-actions" style={{ marginTop: "1rem" }}>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Preparing…" : "Download"}
          </button>
          <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
