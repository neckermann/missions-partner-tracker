import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate, useLocation, Outlet } from "react-router-dom";
import { fetchTrip, fetchTripApplications, fetchTripsSettings } from "../../api/client.js";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import TripStatusBadge from "./TripStatusBadge.jsx";
import Breadcrumb from "../shared/Breadcrumb.jsx";
import LastEdited from "../shared/LastEdited.jsx";
import RecordUnavailable, { loadErrorStatus } from "../shared/RecordUnavailable.jsx";
import { useRecordRecentlyViewed } from "../../hooks/useRecentlyViewed.js";
import useCurrentUser from "../../hooks/useCurrentUser.js";
import TabBar from "../shared/TabBar.jsx";

// Owns the one fetch/reload for a trip and the header/subnav chrome; the team / meetings /
// requirements / budget / flights child routes get everything via useOutletContext().
export default function TripDetailLayout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const {
    canWrite: globalCanWrite,
    isAdmin,
    isGuest,
    canAccessTrip,
    loading: userLoading,
    user: currentUser,
  } = useCurrentUser();
  // Whether this site can send email. While it can't, the trip pages say what happens in its place (links to
  // pass on) and never promise an email. Unknown while loading is treated as able.
  const emailOff = currentUser ? !currentUser.emailReady : false;
  // A guest's global canWrite is false, but on a trip they hold a grant for they have
  // editor-equivalent write access (the backend's requireTripScope enforces it per route).
  const canWrite = globalCanWrite || canAccessTrip(id);
  const [trip, setTrip] = useState(null);
  const [applications, setApplications] = useState([]);
  const [questionLibrary, setQuestionLibrary] = useState([]);
  const [requirementLibrary, setRequirementLibrary] = useState([]);
  const [applicationTemplate, setApplicationTemplate] = useState([]);

  const [loadError, setLoadError] = useState(null); // 404/403 when the trip can't be shown

  const reload = useCallback(() => {
    setLoadError(null);
    fetchTrip(id)
      .then(setTrip)
      .catch((err) => {
        const status = loadErrorStatus(err);
        if (status) setLoadError(status);
        else console.error(err);
      });
    fetchTripApplications(id).then(setApplications).catch(console.error);
  }, [id]);

  // Trip settings (libraries, application template) are closed to a guest (403), and a guest
  // doesn't edit them, so only staff fetch them. Whether budgeting is on comes with the trip
  // itself (below), so the Financial tab shows for a guest too.
  // Wait for the user to load first: until it has, isGuest is false for everyone, and a guest
  // would fire (and be refused) the request before the page knows they are one.
  useEffect(() => {
    if (userLoading || isGuest) return;
    fetchTripsSettings()
      .then((s) => {
        setQuestionLibrary(s.tripQuestionLibrary || []);
        setRequirementLibrary(s.tripRequirementLibrary || []);
        setApplicationTemplate(s.tripApplicationTemplate || []);
      })
      .catch(console.error);
  }, [userLoading, isGuest]);

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

  if (loadError)
    return (
      <RecordUnavailable status={loadError} what="trip" backTo="/admin/trips" backLabel="Back to Trips" />
    );
  if (!trip) return <div className="admin-shell">Loading…</div>;

  const pendingCount = applications.filter((a) => a.status === "pending").length;
  const enableTripBudgeting = !!trip.enableTripBudgeting;
  const tabs = [
    { to: "", label: "Overview", end: true },
    { to: "team", label: pendingCount > 0 ? `Team (${pendingCount})` : "Team" },
    { to: "meetings", label: "Meetings" },
    { to: "requirements", label: "Requirements" },
    ...(enableTripBudgeting ? [{ to: "financial", label: "Financial" }] : []),
    { to: "flights", label: "Flights" },
  ];

  // A Trip Leader has no access to the Partners directory or the cross-trip Trips list (AdminLayout
  // redirects them away), so those breadcrumb segments are omitted. Their own Partner stays.
  const breadcrumbItems = isGuest
    ? [
        ...(trip.partner?.id
          ? [{ label: trip.partner.displayName || "Partner", to: `/admin/partners/${trip.partner.id}` }]
          : []),
        { label: trip.name || trip.type || "Trip" },
      ]
    : [
        { label: "Partners", to: "/admin/partners" },
        {
          label: trip.partner?.displayName || "Partner",
          to: `/admin/partners/${trip.partner?.id}`,
        },
        { label: "Trips", to: `/admin/trips?partnerId=${trip.partner?.id}` },
        { label: trip.name || trip.type || "Trip" },
      ];

  return (
    <div className="admin-shell">
      {location.state?.accessDenied && (
        <p className="field-warning" role="alert">
          You don't have access to that page -- here's your trip instead.
        </p>
      )}
      <Breadcrumb items={breadcrumbItems} />
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>{trip.name || trip.type || "Trip"}</h2>
        <TripStatusBadge status={trip.status} />
        {/* Finishing a trip is its own guided step; a finished one is edited from its debrief. */}
        {canWrite && trip.status !== "completed" && trip.status !== "planning" && (
          <Link className="btn small" to="wrap-up" style={{ marginLeft: "auto" }}>
            Wrap up trip
          </Link>
        )}
        {trip.partner?.isRestricted && (
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "var(--warn)",
              background: "var(--warn-soft)",
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            Restricted partner
          </span>
        )}
      </div>
      <p style={{ margin: "0.2rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
        {trip.partner ? (
          <Link to={`/admin/partners/${trip.partner.id}`}>
            {trip.partner.fieldDisplayName || trip.partner.displayName}
          </Link>
        ) : (
          "No partner linked"
        )}
      </p>
      {!isGuest && (
        <LastEdited
          name={trip.lastEditedByName}
          at={trip.lastEditedAt}
          createdAt={trip.createdAt}
          style={{ margin: "0.15rem 0 0" }}
        />
      )}

      <TabBar ariaLabel="Trip pages" tabs={tabs} />

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
            canWrite,
            isAdmin,
            emailOff,
          }}
        />
      </div>
      {confirmElement}
    </div>
  );
}
