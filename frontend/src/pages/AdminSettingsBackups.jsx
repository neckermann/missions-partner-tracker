import React, { useEffect, useState } from "react";
import { updateChurchSettings } from "../api/client.js";
import useChurchSettings from "../hooks/useChurchSettings.js";

// A full database export, streamed straight from GET /api/backups/download
// as a file download -- nothing is persisted server-side (see
// backend/src/utils/backup.js), so there's no history list here to show.
// Opening it in a new tab/window is enough to trigger the browser's normal
// download flow for a Content-Disposition: attachment response; it isn't
// actually navigating anywhere.
function downloadBackup() {
  window.open("/api/backups/download", "_blank");
}

export default function AdminSettingsBackups() {
  const [reminderDisabled, setReminderDisabled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const { settings, loading, error: settingsError } = useChurchSettings();
  useEffect(() => {
    if (settings) {
      setReminderDisabled(Boolean(settings?.backupReminderDisabled));
      setChecked(Boolean(settings?.backupReminderDisabled));
    }
  }, [settings]);
  useEffect(() => {
    if (settingsError) setError("Couldn't load backup settings.");
  }, [settingsError]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateChurchSettings({ backupReminderDisabled: checked });
      setReminderDisabled(Boolean(updated.backupReminderDisabled));
      setSuccess("Saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save this setting.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell">
      <h2>Backups</h2>
      <p style={{ color: "#555" }}>
        A full export of everything in the database — every partner, user, and uploaded file — as a single
        file you download and keep somewhere safe. See{" "}
        <a
          href="https://github.com/neckermann/missions-partner-tracker/blob/main/ADMIN_GUIDE.md#database-backups"
          target="_blank"
          rel="noreferrer"
        >
          ADMIN_GUIDE.md § Database backups
        </a>{" "}
        for how to restore one if you ever need to.
      </p>

      <div className="admin-section">
        <h3>Back up now</h3>
        <p className="field-warning" style={{ marginBottom: "1rem" }}>
          This file contains everything, unmasked — every restricted partner's real name and exact location,
          and every admin user's password hash and encrypted two-factor secret. Treat it like the most
          sensitive file this app can produce: store it somewhere only trusted people can reach, and if one is
          ever exposed, rotate <code>SESSION_SECRET</code> (see ADMIN_GUIDE.md).
        </p>
        <button type="button" className="btn" onClick={downloadBackup}>
          Download Backup
        </button>
      </div>

      <div className="admin-section" style={{ marginTop: "1.5rem" }}>
        <h3>Already backed up another way?</h3>
        <p style={{ color: "#555" }}>
          If your database provider's own backups (or another process) are tested and working, you can turn
          off the periodic reminder banner for good.
        </p>
        {error && (
          <p style={{ color: "#b91c1c" }} role="alert">
            {error}
          </p>
        )}
        {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}
        <form onSubmit={handleSave}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>We have backups covered through another method — stop reminding us</span>
          </div>
          <p className="field-warning" style={{ marginTop: "0.75rem" }}>
            Don't check this unless you're sure. If backups stop happening somewhere else and nobody notices,
            there's no way to get that data back.
          </p>
          <button
            type="submit"
            className="btn secondary"
            disabled={saving || checked === reminderDisabled}
            style={{ marginTop: "0.5rem" }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}
