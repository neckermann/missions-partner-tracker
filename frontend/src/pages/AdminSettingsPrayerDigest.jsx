import React, { useEffect, useState } from "react";
import { fetchScopedDigestSummary } from "../api/client.js";

// Read-only visibility into who's subscribed to the scoped prayer digest
// (#202), across both audiences -- admin (Account Settings) and public
// (the prayer wall / per-partner "follow" forms). No email addresses in
// this v1 -- just counts; see routes/adminScopedDigest.js's own comment.
// Same single-fetch-on-mount shape as AdminSettingsEmail.jsx, but with
// nothing to save -- this page only reports.
export default function AdminSettingsPrayerDigest() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchScopedDigestSummary()
      .then(setSummary)
      .catch((err) => setError(err.response?.data?.error || "Couldn't load subscriber counts."));
  }, []);

  return (
    <div className="admin-shell">
      <h2>Prayer Digest Subscribers</h2>
      <p style={{ color: "#555" }}>
        Who's subscribed to the scoped prayer-request digest -- admins via Account Settings, and the public
        via the Subscribe page or a partner's own public page. Each chooses their own cadence and partner
        scope; this page is counts only, no email addresses.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!summary && !error ? (
        <p>Loading…</p>
      ) : summary ? (
        <div className="admin-card-grid">
          <div className="admin-card" style={{ cursor: "default" }}>
            <h3>{summary.adminSubscribedCount}</h3>
            <p>Admin account(s) subscribed to the email digest.</p>
          </div>
          <div className="admin-card" style={{ cursor: "default" }}>
            <h3>{summary.publicConfirmedCount}</h3>
            <p>Confirmed public subscribers.</p>
          </div>
          <div className="admin-card" style={{ cursor: "default" }}>
            <h3>{summary.publicUnconfirmedCount}</h3>
            <p>Public subscribers awaiting confirmation (haven't clicked the link in their email yet).</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
