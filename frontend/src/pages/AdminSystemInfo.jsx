import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { fetchSystemInfo, updateChurchSettings } from "../api/client.js";
import useChurchSettings from "../hooks/useChurchSettings.js";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", gap: "1rem" }}>
      <span style={{ color: "#555" }}>{label}</span>
      <span style={{ fontFamily: "monospace", textAlign: "right" }}>{value}</span>
    </div>
  );
}

function downloadBackup() {
  window.open("/api/backups/download", "_blank");
}

export default function AdminSystemInfo() {
  const [info, setInfo] = useState(null);
  const [infoError, setInfoError] = useState("");

  const [reminderDisabled, setReminderDisabled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [backupError, setBackupError] = useState("");

  const { settings, error: settingsError } = useChurchSettings();

  useEffect(() => {
    fetchSystemInfo()
      .then(setInfo)
      .catch((err) => setInfoError(err.response?.data?.error || "Couldn't load system info."));
  }, []);

  useEffect(() => {
    if (settings) {
      setReminderDisabled(Boolean(settings?.backupReminderDisabled));
      setChecked(Boolean(settings?.backupReminderDisabled));
    }
  }, [settings]);
  useEffect(() => {
    if (settingsError) setBackupError("Couldn't load backup settings.");
  }, [settingsError]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess("");
    setBackupError("");
    try {
      const updated = await updateChurchSettings({ backupReminderDisabled: checked });
      setReminderDisabled(Boolean(updated.backupReminderDisabled));
      setSuccess("Saved.");
    } catch (err) {
      setBackupError(err.response?.data?.error || "Couldn't save this setting.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell">
      <SettingsPageHeader title="About App" />
      <p style={{ color: "#555" }}>
        What's actually running on this instance, and how to back up its data.
      </p>

      {infoError ? (
        <p style={{ color: "#b91c1c" }} role="alert">
          {infoError}
        </p>
      ) : !info ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="admin-section">
            <h3>App</h3>
            <InfoRow label="Version" value={`v${info.app.version}`} />
            {info.app.updateAvailable ? (
              <InfoRow
                label="Update available"
                value={
                  <a href={info.app.releaseUrl} target="_blank" rel="noreferrer">
                    v{info.app.latestVersion}
                  </a>
                }
              />
            ) : (
              <InfoRow label="Update available" value="No -- you're on the latest release" />
            )}
          </div>

          <div className="admin-section" style={{ marginTop: "1.5rem" }}>
            <h3>Runtime</h3>
            <InfoRow label="Node.js" value={info.runtime.node} />
            <InfoRow label="React" value={React.version} />
            <InfoRow label="React DOM" value={ReactDOM.version} />
            <InfoRow label="Express" value={info.dependencies.express || "Unknown"} />
            <InfoRow label="Prisma" value={info.dependencies.prisma || "Unknown"} />
            <InfoRow label="@prisma/client" value={info.dependencies.prismaClient || "Unknown"} />
          </div>

          <div className="admin-section" style={{ marginTop: "1.5rem" }}>
            <h3>Database</h3>
            <InfoRow label="Postgres" value={info.database.version || "Unknown"} />
            <InfoRow label="Database size" value={formatBytes(info.database.sizeBytes)} />
          </div>

          <div className="admin-section" style={{ marginTop: "1.5rem" }}>
            <h3>Deployment</h3>
            {info.deployment.onRender ? (
              <>
                <InfoRow label="Platform" value="Render" />
                <InfoRow label="Service name" value={info.deployment.serviceName} />
                <InfoRow label="Git commit" value={info.deployment.gitCommit?.slice(0, 7) || "Unknown"} />
                {info.deployment.externalUrl && (
                  <InfoRow
                    label="External URL"
                    value={
                      <a href={info.deployment.externalUrl} target="_blank" rel="noreferrer">
                        {info.deployment.externalUrl}
                      </a>
                    }
                  />
                )}
              </>
            ) : (
              <InfoRow label="Platform" value="Not running on Render" />
            )}
          </div>
        </>
      )}

      <div className="admin-section" style={{ marginTop: "1.5rem" }}>
        <h3>Back up now</h3>
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
        {backupError && (
          <p style={{ color: "#b91c1c" }} role="alert">
            {backupError}
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
