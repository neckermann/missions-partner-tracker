import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchAssignedPartners, createContactLogEntry } from "../../api/client.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import Table from "../shared/Table.jsx";
import StatusPill from "./StatusPill.jsx";
import { formatDateLong } from "../../utils/format.js";
import { buildGreeting, greetingHref } from "../../utils/greeting.js";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import KeyDatesCopyList from "./KeyDatesCopyList.jsx";

// "My partners": the partners this login looks after (a care team seat, or the missions team for a partner with no team), longest-quiet first. The server
// computes everything (GET /api/contact-log/assigned), the same read model the "Partners to reach
// out to" notification counts, so the two never disagree about who is overdue.

// Mirrors the server's KEY_DATE_LEAD_DAYS (utils/keyDates.js).
const KEY_DATE_SOON_DAYS = 7;

const sinceLabel = (days) =>
  days === null ? "Never" : days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;

export default function AssignedPartnersTable() {
  const navigate = useNavigate();
  const { enabledFeatures, churchName, ownerGroupName } = useSettings();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [rows, setRows] = useState(null);
  const [message, setMessage] = useState("");
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
      render: (r) =>
        r.isLead ? (
          <StatusPill label="Lead" color="#2a5d3c" />
        ) : r.viaMissionsTeam ? (
          // No care team on this partner: it came to the church's missions team.
          <StatusPill label={ownerGroupName} color="#6b6f76" />
        ) : (
          "Member"
        ),
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
      stopRowClick: true,
      render: (r) =>
        r.nextKeyDate ? (
          <span>
            {`${r.nextKeyDate.occasion}${r.nextKeyDate.who ? ` (${r.nextKeyDate.who})` : ""} · ${formatDateLong(r.nextKeyDate.date)}`}
            {/* Inside the reminder window -- the same 7 days the bell and email use */}
            {enabledFeatures.keyDates && r.nextKeyDate.daysUntil <= KEY_DATE_SOON_DAYS && (
              <StatusPill label={r.nextKeyDate.daysUntil === 0 ? "Today" : "Soon"} color="#a6540f" />
            )}
            {r.greetingEmail && r.nextKeyDate.daysUntil <= KEY_DATE_SOON_DAYS && (
              <button
                type="button"
                className="btn secondary small"
                style={{ marginLeft: "0.5rem" }}
                onClick={() => greet(r)}
              >
                Send greeting
              </button>
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

  // Opens an email draft for a person to send themselves, then offers to log it. The app never
  // sends it, and logging it with the "Key date" topic is what clears the reminder.
  async function greet(r) {
    const greeting = buildGreeting({ occasion: r.nextKeyDate.occasion, who: r.nextKeyDate.who, churchName });
    window.location.href = greetingHref(r.greetingEmail, greeting);
    if (!enabledFeatures.contactLog) return;
    const sent = await confirmDialog({
      title: "Did you send it?",
      body: (
        <p>
          Log it as an email to {r.displayName} for their {r.nextKeyDate.occasion.toLowerCase()}, so it counts
          as a contact and clears the reminder.
        </p>
      ),
      confirmLabel: "Yes, log it",
      cancelLabel: "Not yet",
    });
    if (!sent) return;
    try {
      await createContactLogEntry({
        partnerId: r.partnerId,
        contactType: "email",
        direction: "outbound",
        topics: ["keydate"],
        notes: `Greeting for ${r.nextKeyDate.occasion}${r.nextKeyDate.who ? ` (${r.nextKeyDate.who})` : ""}`,
      });
      setMessage(`Logged a greeting to ${r.displayName}.`);
      setRows(await fetchAssignedPartners());
    } catch {
      setError("Couldn't log that. You can add it from the partner's page.");
    }
  }

  if (error) return <p role="alert">{error}</p>;
  return (
    <>
      {enabledFeatures?.keyDates && !enabledFeatures?.outboundEmail && <KeyDatesCopyList />}
      {message && (
        <p role="status" style={{ color: "var(--accent)" }}>
          {message}
        </p>
      )}
      <Table
        className="admin-table"
        style={{ marginTop: "0.75rem" }}
        rows={rows || []}
        rowKey={(r) => r.partnerId}
        onRowClick={(r) => navigate(`/admin/partners/${r.partnerId}`)}
        rowHref={(r) => `/admin/partners/${r.partnerId}`}
        emptyMessage={rows === null ? "Loading…" : "You aren't on any partner's care team yet."}
        columns={columns}
      />
      {confirmElement}
    </>
  );
}
