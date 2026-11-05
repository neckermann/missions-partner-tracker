import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { fetchSystemInfo } from "../api/client.js";

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

// "What's actually running" for an admin debugging something, or a fork
// maintainer checking what they're on before filing a bug -- see #195.
// React/react-dom's versions come straight from the already-loaded
// modules at runtime (React.version/ReactDOM.version), not from the
// backend: a deployed instance never ships frontend/package.json (see
// backend/src/utils/versionCheck.js's own comment), so this is the only
// accurate source for those two. Everything else comes from GET
// /api/system-info.
export default function AdminSystemInfo() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSystemInfo()
      .then(setInfo)
      .catch((err) => setError(err.response?.data?.error || "Couldn't load system info."));
  }, []);

  if (error) {
    return (
      <div className="admin-shell">
        <h2>System Info</h2>
        <p style={{ color: "#b91c1c" }} role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (!info) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell">
      <h2>System Info</h2>
      <p style={{ color: "#555" }}>
        What's actually running on this instance -- useful when debugging something, or checking what you're
        on before filing a bug.
      </p>

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
    </div>
  );
}
