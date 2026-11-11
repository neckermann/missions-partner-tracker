import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import { fetchPublicTrips } from "../api/client.js";
import { formatDate } from "../utils/format.js";

// New (#252), §3a -- the new home for the "Opportunities" name. Status-
// based cards/teasers; a trip linked to a restricted partner is excluded
// entirely by the backend query, not masked. Gated under publicTripDiscovery
// (see main.jsx) -- a church recruiting entirely by private link never has
// this page reachable at all.
export default function PublicTripOpportunities() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPublicTrips()
      .then(setTrips)
      .catch(() => setTrips([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PublicSiteHeader title="Trip Opportunities" />
      <DemoBanner />
      <div className="admin-shell">
        <p style={{ color: "#555" }}>
          Short-term mission trips currently open for applications, plus a look ahead at what's coming.
        </p>

        {loading ? (
          <p>Loading…</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
            {trips.map((t) => (
              <div key={t.id} className="admin-section">
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    color: t.status === "accepting_applications" ? "#1f6b4f" : "#a6540f",
                    background: t.status === "accepting_applications" ? "#e7f3ee" : "#fbeee0",
                  }}
                >
                  {t.status === "accepting_applications" ? "Accepting applications" : "Coming soon"}
                </span>
                <h3 style={{ margin: "0.5rem 0 0.25rem" }}>{t.name || t.type || "Trip"}</h3>
                <p style={{ margin: 0, color: "#6b6f76", fontSize: "0.85rem" }}>
                  {t.fieldDisplayName || "Field location to be announced"}
                  {t.startDate ? ` · ${formatDate(t.startDate)}` : ""}
                </p>
                {t.description && <p style={{ fontSize: "0.9rem" }}>{t.description}</p>}
                {t.status === "accepting_applications" && (
                  <Link className="btn" to={`/apply/${t.id}`}>
                    Apply now
                  </Link>
                )}
              </div>
            ))}
            {trips.length === 0 && <p style={{ color: "#888" }}>No open trips right now — check back soon.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
