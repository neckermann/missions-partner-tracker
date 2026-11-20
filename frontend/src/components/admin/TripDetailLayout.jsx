import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate, NavLink, Outlet } from "react-router-dom";
import { fetchTrip, fetchTripApplications, fetchTripsSettings } from "../../api/client.js";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import TripStatusBadge from "./TripStatusBadge.jsx";
import Breadcrumb from "../shared/Breadcrumb.jsx";
import { useRecordRecentlyViewed } from "../../hooks/useRecentlyViewed.js";

// Phase 3 (UX rebuild) split of the former single 2,100-line
// AdminTripDetail.jsx into real sub-pages -- team / meetings /
// requirements / budget / flights, boundary names coordinated with
// issue #271's own planned trips.js split (tripMeetings,
// tripRequirements, tripParticipants/applications) even though the
// backend file itself isn't split here (that's #271's own track; the
// frontend calls the same URL paths regardless of which backend file
// serves them). This layout owns the one fetch/reload cycle and the
// header/subnav chrome; each child route gets everything via
// useOutletContext() instead of re-fetching.
export default function TripDetailLayout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [trip, setTrip] = useState(null);
  const [applications, setApplications] = useState([]);
  const [questionLibrary, setQuestionLibrary] = useState([]);
  const [requirementLibrary, setRequirementLibrary] = useState([]);
  const [applicationTemplate, setApplicationTemplate] = useState([]);
  const [enableTripBudgeting, setEnableTripBudgeting] = useState(false);

  const reload = useCallback(() => {
    fetchTrip(id).then(setTrip).catch(console.error);
    fetchTripApplications(id).then(setApplications).catch(console.error);
  }, [id]);

  useEffect(() => {
    fetchTripsSettings()
      .then((s) => {
        setQuestionLibrary(s.tripQuestionLibrary || []);
        setRequirementLibrary(s.tripRequirementLibrary || []);
        setApplicationTemplate(s.tripApplicationTemplate || []);
        setEnableTripBudgeting(!!s.enableTripBudgeting);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useRecordRecentlyViewed(
    trip && {
      to: `/admin/trips/${trip.id}`,
      label: trip.partner?.fieldDisplayName || trip.partner?.displayName || "Trip",
      kind: "Trip",
    }
  );

  if (!trip) return <div className="admin-shell">Loading…</div>;

  const pendingCount = applications.filter((a) => a.status === "pending").length;
  const tabs = [
    { to: "", label: "Overview", end: true },
    { to: "team", label: pendingCount > 0 ? `Team (${pendingCount})` : "Team" },
    { to: "meetings", label: "Meetings" },
    { to: "requirements", label: "Requirements" },
    ...(enableTripBudgeting ? [{ to: "budget", label: "Budget" }] : []),
    { to: "flights", label: "Flights" },
  ];

  return (
    <div className="admin-shell">
      <Breadcrumb
        items={[
          { label: "Partners", to: "/admin/partners" },
          {
            label: trip.partner?.displayName || "Partner",
            to: `/admin/partners/${trip.partner?.id}`,
          },
          { label: "Trips", to: `/admin/trips?partnerId=${trip.partner?.id}` },
          { label: trip.name || trip.type || "Trip" },
        ]}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>{trip.name || trip.type || "Trip"}</h2>
        <TripStatusBadge status={trip.status} />
        {trip.partner?.isRestricted && (
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "#a6540f",
              background: "#fbeee033",
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            Restricted partner
          </span>
        )}
      </div>
      <p style={{ margin: "0.2rem 0 0", color: "#6b6f76", fontSize: "0.85rem" }}>
        {trip.partner ? (
          <Link to={`/admin/partners/${trip.partner.id}`}>
            {trip.partner.fieldDisplayName || trip.partner.displayName}
          </Link>
        ) : (
          "No partner linked"
        )}
      </p>

      <div
        style={{
          display: "flex",
          gap: "0.3rem",
          marginTop: "0.9rem",
          borderBottom: "1px solid #e1dfdb",
          flexWrap: "wrap",
        }}
        role="tablist"
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to || "overview"}
            to={t.to}
            end={t.end}
            style={({ isActive }) => ({
              padding: "0.5rem 0.8rem",
              fontSize: "0.85rem",
              fontWeight: isActive ? 700 : 400,
              color: isActive ? "#1f2a37" : "#555",
              borderBottom: isActive ? "2px solid #1f2a37" : "2px solid transparent",
              textDecoration: "none",
            })}
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <div style={{ marginTop: "1rem" }}>
        <Outlet
          context={{
            trip,
            setTrip,
            applications,
            reload,
            questionLibrary,
            requirementLibrary,
            applicationTemplate,
            enableTripBudgeting,
            confirmDialog,
            navigate,
            id,
          }}
        />
      </div>
      {confirmElement}
    </div>
  );
}
