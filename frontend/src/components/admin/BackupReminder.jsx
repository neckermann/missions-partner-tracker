import React, { useEffect, useState } from "react";
import { fetchBackupCheck } from "../../api/client.js";

const DISMISSED_KEY = "missions-tracker-backup-reminder-dismissed-at";
const REMIND_AGAIN_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

const PROVIDER_MESSAGES = {
  neon: "You're on Neon — confirm your plan includes point-in-time recovery (Neon console → your project → Backup/Restore).",
  supabase:
    "You're on Supabase — confirm your plan's backup retention window covers how much data loss your church would tolerate.",
  rds: "You're on Amazon RDS — confirm automated backups and your retention window are enabled (RDS console → your instance → Maintenance & backups).",
  other:
    "This app doesn't manage database backups itself — confirm your Postgres provider's backup/retention settings.",
};

// A periodic (not one-time-forever) reminder that nothing in this app
// backs up the database itself -- see ADMIN_GUIDE.md § Database backups.
// Aimed at churches without a technical volunteer who might otherwise
// never think to check their provider's own backup settings. Re-shows
// itself ~30 days after being dismissed, since "did we ever actually
// check this" is worth revisiting periodically, not just once.
//
// That per-browser dismiss is separate from backupReminderDisabled, a
// server-side, permanent opt-out set on the Backups settings page
// (AdminSettingsBackups.jsx) for a church that's confirmed its backups are
// genuinely handled another way -- when that's on, this never renders at
// all, regardless of the dismiss timer.
export default function BackupReminder() {
  const [provider, setProvider] = useState(null);
  const [reminderDisabled, setReminderDisabled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetchBackupCheck()
      .then((data) => {
        setProvider(data?.provider || "other");
        setReminderDisabled(Boolean(data?.backupReminderDisabled));
        const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) || 0);
        setDismissed(Date.now() - dismissedAt < REMIND_AGAIN_AFTER_MS);
      })
      .catch(() => {
        // Not an admin, or the check failed -- no reminder, never an error.
      });
  }, []);

  if (!provider || reminderDisabled || dismissed) return null;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setDismissed(true);
  }

  return (
    <div
      className="no-print"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.6rem 1rem",
        background: "#fff8e6",
        borderBottom: "1px solid #f0d999",
        fontSize: "0.9rem",
      }}
    >
      <span>
        {PROVIDER_MESSAGES[provider]} Want a backup right now, or already covered another way?{" "}
        <a href="/admin/settings/backups">Download a backup, or turn this off for good</a>, or{" "}
        <a
          href="https://github.com/neckermann/missions-partner-tracker/blob/main/ADMIN_GUIDE.md#database-backups"
          target="_blank"
          rel="noreferrer"
        >
          learn more
        </a>
        .
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss backup reminder"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "1rem",
          lineHeight: 1,
          color: "#555",
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
