import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchAssignedPartners } from "../../api/client.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import Table from "../shared/Table.jsx";
import StatusPill from "./StatusPill.jsx";
import { formatDateLong } from "../../utils/format.js";

// "Assigned to me" (#288): the partners this login holds a care team seat on,
// longest-quiet first, with what a person looking after them wants at a
// glance. The server computes everything (GET /api/contact-log/assigned), the
// same read model the "Partners to reach out to" notification counts, so the
// two never disagree about who is overdue.

// Mirrors the server's KEY_DATE_LEAD_DAYS (utils/keyDates.js).
const KEY_DATE_SOON_DAYS = 7;

const sinceLabel = (days) =>
  days === null ? "Never" : days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;

export default function AssignedPartnersTable() {
  const navigate = useNavigate();
  const { enabledFeatures } = useSettings();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAssignedPartners()
      .then(setRows)
      .catch(() => setError("Couldn't load your partners."));
  }, []);

  const columns = [
    { key: "displayName", label: "Partner", sortable: true, render: (r) => r.displayName },
    {
      key: "isLead",
      label: "You are",
      render: (r) => (r.isLead ? <StatusPill label="Lead" color="#2a5d3c" /> : "Member"),
    },
    {
      key: "daysSinceContact",
      label: "Last contact",
      sortable: true,
      sortBy: (r) => r.daysSinceContact ?? Number.MAX_SAFE_INTEGER,
      render: (r) => (
        <span>
          {sinceLabel(r.daysSinceContact)}
          {r.quiet && <StatusPill label="Quiet" color="#a6540f" />}
        </span>
      ),
    },
    {
      key: "followUpDate",
      label: "Follow up",
      render: (r) =>
        r.followUpDate ? (
          <span>
            {formatDateLong(r.followUpDate)}
            {r.followUpDue && <StatusPill label="Due" color="#a6540f" />}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "nextKeyDate",
      label: "Next key date",
      render: (r) =>
        r.nextKeyDate ? (
          <span>
            {`${r.nextKeyDate.occasion}${r.nextKeyDate.who ? ` (${r.nextKeyDate.who})` : ""} · ${formatDateLong(r.nextKeyDate.date)}`}
            {/* #291: inside the reminder window -- the same 7 days the bell and email use */}
            {enabledFeatures.keyDates && r.nextKeyDate.daysUntil <= KEY_DATE_SOON_DAYS && (
              <StatusPill label={r.nextKeyDate.daysUntil === 0 ? "Today" : "Soon"} color="#a6540f" />
            )}
          </span>
        ) : (
          "—"
        ),
    },
    ...(enabledFeatures.prayerRequests
      ? [{ key: "openPrayers", label: "Open prayers", sortable: true, render: (r) => r.openPrayers }]
      : []),
    ...(enabledFeatures.oneTimeNeeds
      ? [{ key: "openNeeds", label: "Open needs", sortable: true, render: (r) => r.openNeeds }]
      : []),
  ];

  if (error) return <p role="alert">{error}</p>;
  return (
    <Table
      className="admin-table"
      style={{ marginTop: "0.75rem" }}
      rows={rows || []}
      rowKey={(r) => r.partnerId}
      onRowClick={(r) => navigate(`/admin/partners/${r.partnerId}`)}
      emptyMessage={rows === null ? "Loading…" : "You aren't on any partner's care team yet."}
      columns={columns}
    />
  );
}
