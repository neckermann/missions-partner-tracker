import React, { useEffect, useState } from "react";
import { listReports } from "../api/client.js";
import CardGrid from "../components/admin/CardGrid.jsx";

// The Reports hub. Organized by the question a person is trying to answer
// ("Who is still missing a requirement?"), not by table name, and built
// from the same page shell as Admin Home: admin-shell + admin-section +
// CardGrid. Everything shown comes from the server's report catalog
// (backend/src/reporting/registry.js), so adding a report never means
// editing this file. Reports are read-only; the resource pages still do
// the editing.
export default function AdminReports() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listReports()
      .then((data) => !cancelled && setCatalog(data))
      .catch(() => !cancelled && setError("Couldn't load the reports. Try refreshing."));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="admin-shell">
      <h2>Reports</h2>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Pick the question you are trying to answer. Every report can be downloaded as a spreadsheet (CSV) or
        printed or saved as a PDF from your browser.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!catalog && !error && <p>Loading…</p>}

      {catalog &&
        catalog.groups.map((group) => (
          <div className="admin-section" key={group.key}>
            <h3 style={{ marginTop: 0 }}>{group.label}</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>{group.description}</p>
            <CardGrid
              sections={catalog.reports
                .filter((r) => r.group === group.key)
                .map((r) => ({
                  to: `/admin/reports/${r.id}`,
                  title: r.label,
                  icon: group.icon,
                  description: r.question,
                }))}
            />
          </div>
        ))}
    </div>
  );
}
