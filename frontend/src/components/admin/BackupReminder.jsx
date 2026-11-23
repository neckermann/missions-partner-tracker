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

// A periodic (not one-time-forever) reminder that nothing in this app
// backs up the database itself -- see ADMIN_GUIDE.md § Database backups.
// Aimed at churches without a technical volunteer who might otherwise
// never think to check their provider's own backup settings. Re-shows
// itself ~30 days after being dismissed, since "did we ever actually
// check this" is worth revisiting periodically, not just once.
//
// The "due for a nudge" / dismiss-tracking logic lives in the shared
// notification registry now (backend/src/notifications/categories.js's
// timeToCheckBackups, via useNotifications()) -- a per-user, DB-backed
// NotificationSeen row, not this component's own per-browser localStorage
// timer as before, so dismissing on one device doesn't leave it nagging
// again on another. Still fetches /api/backup-check directly for the
// provider detection (Neon/Supabase/RDS/other) -- that's cosmetic message
// content, not state the registry needs to track.
//
// Separate from backupReminderDisabled, a server-side, permanent opt-out
// set on the About App settings page (AdminSystemInfo.jsx) for a church
// that's confirmed its backups are genuinely handled another way -- the
// registry's own category already checks that flag, so this component
// doesn't need to duplicate it.
export default function BackupReminder() {
  const [provider, setProvider] = useState(null);
  const { categories, markSeen } = useNotifications();
  const category = categories.find((c) => c.key === "timeToCheckBackups");

  useEffect(() => {
    fetchBackupCheck()
      .then((data) => setProvider(data?.provider || "other"))
      .catch(() => {
        // Not an admin, or the check failed -- no reminder, never an error.
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
        background: "#fff8e6",
        borderBottom: "1px solid #f0d999",
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
          color: "#555",
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
