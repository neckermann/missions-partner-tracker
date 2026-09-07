import React, { useEffect, useState } from "react";
import { fetchVersionCheck } from "../../api/client.js";

const DISMISSED_KEY = "missions-tracker-update-dismissed-version";

// A heads-up banner across the top of the admin dashboard when this
// instance is running behind the latest tagged release upstream — see
// backend/src/utils/versionCheck.js. Non-admin roles get a 403 from
// /api/version-check (admin-only), which this treats the same as "no
// update to show" rather than surfacing an error -- this banner is a
// courtesy, never something that should make the dashboard look broken.
//
// Dismissal is remembered per-version (localStorage), not permanently --
// dismissing today's update notice shouldn't silently suppress next
// month's too.
export default function UpdateBanner() {
  const [info, setInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetchVersionCheck()
      .then((data) => {
        if (data?.updateAvailable) {
          setInfo(data);
          setDismissed(localStorage.getItem(DISMISSED_KEY) === data.latestVersion);
        }
      })
      .catch(() => {
        // Not an admin, or the check failed/GitHub unreachable -- either
        // way, no banner. Never surface this as a dashboard error.
      });
  }, []);

  if (!info || dismissed) return null;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, info.latestVersion);
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
        background: "#eef6ff",
        borderBottom: "1px solid #bcdcff",
        fontSize: "0.9rem",
      }}
    >
      <span>
        A new version is available (<strong>v{info.latestVersion}</strong>, you're on v
        {info.currentVersion}) — see{" "}
        <a href={info.releaseUrl} target="_blank" rel="noreferrer">
          what's new
        </a>
        , then use GitHub's <strong>Sync fork</strong> button on your fork's page to pull it in
        (see UPGRADING.md if you're not sure where that is).
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss update notice"
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
