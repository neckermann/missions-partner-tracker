import React, { useEffect, useState } from "react";
import { fetchBackupCheck } from "../../api/client.js";
import useNotifications from "../../hooks/useNotifications.js";

const PROVIDER_MESSAGES = {
  neon: "You're on Neon — confirm your plan includes point-in-time recovery (Neon console → your project → Backup/Restore).",
  supabase:
    "You're on Supabase — confirm your plan's backup retention window covers how much data loss your church would tolerate.",
  rds: "You're on Amazon RDS — confirm automated backups and your retention window are enabled (RDS console → your instance → Maintenance & backups).",
  other:
    "This app doesn't manage database backups itself — confirm your Postgres provider's backup/retention settings.",
};

// A periodic reminder that nothing in this app backs up the database (ADMIN_GUIDE.md § Database
// backups). Whether it is due, and dismissal, live in the notification registry
// (backend/src/notifications/categories.js timeToCheckBackups, via useNotifications()) as a
// per-user NotificationSeen row, so dismissing on one device holds on another. The registry also
// checks the permanent server-side backupReminderDisabled opt-out. /api/backup-check is fetched
// here only for provider detection (cosmetic message content).
export default function BackupReminder() {
  const [provider, setProvider] = useState(null);
  const { categories, markSeen } = useNotifications();
  const category = categories.find((c) => c.key === "timeToCheckBackups");

  useEffect(() => {
    fetchBackupCheck()
      .then((data) => setProvider(data?.provider || "other"))
      .catch(() => {
        // Not an admin, or the check failed: no reminder, never an error.
      });
  }, []);

  if (!provider || !category || category.count === 0) return null;

  function dismiss() {
    markSeen("timeToCheckBackups");
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
        background: "var(--warn-soft)",
        borderBottom: "1px solid var(--warn)",
        color: "var(--text)",
        fontSize: "0.9rem",
      }}
    >
      <span>
        {PROVIDER_MESSAGES[provider]} Want a backup right now, or already covered another way?{" "}
        <a href="/admin/settings/system-info">Download a backup, or turn this off for good</a>, or{" "}
        <a
          href="https://missionspartnertracker.com/admin-guide.html#database-backups"
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
          color: "var(--text)",
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
