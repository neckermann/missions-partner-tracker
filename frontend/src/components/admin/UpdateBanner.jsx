import React, { useEffect, useState } from "react";
import { fetchVersionCheck } from "../../api/client.js";
import useCurrentUser from "../../hooks/useCurrentUser.js";

const DISMISSED_KEY = "missions-tracker-update-dismissed-version";

// A banner on the admin dashboard when this instance is behind the latest upstream release
// (backend/src/utils/versionCheck.js). Only admins can see it, so it is only asked for for an admin (anyone else
// would get a 403 on every page). The banner is a courtesy and must never make the dashboard look broken. Dismissal
// is remembered per version in localStorage, so it doesn't suppress the next release's notice.
export default function UpdateBanner() {
  const [info, setInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const { isAdmin, loading } = useCurrentUser();

  useEffect(() => {
    if (loading || !isAdmin) return;
    fetchVersionCheck()
      .then((data) => {
        if (data?.updateAvailable) {
          setInfo(data);
          setDismissed(localStorage.getItem(DISMISSED_KEY) === data.latestVersion);
        }
      })
      .catch(() => {
        // The check failed or GitHub is unreachable: no banner, never a dashboard error.
      });
  }, [isAdmin, loading]);

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
        background: "color-mix(in srgb, #cfe6ff 40%, var(--surface))",
        borderBottom: "1px solid color-mix(in srgb, #7fb8f5 55%, var(--surface))",
        color: "var(--text)",
        fontSize: "0.9rem",
      }}
    >
      <span>
        A new version is available (<strong>v{info.latestVersion}</strong>, you're on v{info.currentVersion})
        — see{" "}
        <a href={info.releaseUrl} target="_blank" rel="noreferrer">
          what's new
        </a>
        , then use GitHub's <strong>Sync fork</strong> button on your fork's page to pull it in (see
        UPGRADING.md if you're not sure where that is).
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss update notice"
        title="Dismiss this notice"
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
