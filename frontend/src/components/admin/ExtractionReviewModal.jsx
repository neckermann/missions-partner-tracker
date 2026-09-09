import React, { useEffect, useState } from "react";
import { createPrayerRequest, createSupportNeed } from "../../api/client.js";
import { useSettings } from "../../context/SettingsContext.jsx";

// Shared by NewsletterSection and DocumentSection's "Scan for requests"
// button. `scan` is the extractFromNewsletter/extractFromDocument call
// (passed in rather than an id + type, so this component doesn't need to
// know which kind of file it's reviewing) -- runs once on mount. Nothing is
// written until the admin explicitly clicks Add on a given card; closing
// the modal without adding just discards the rest of the suggestions
// (re-runnable any time from the same button).
export default function ExtractionReviewModal({ scan, missionaryId, organizationId, defaultDate, onClose }) {
  const { enabledFeatures } = useSettings();
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [prayerRequests, setPrayerRequests] = useState([]);
  const [oneTimeNeeds, setOneTimeNeeds] = useState([]);

  useEffect(() => {
    scan()
      .then((result) => {
        // Suggestions for a feature this church has turned off don't make
        // sense to offer -- the Add button would just 404 (see
        // requireFeature("prayerRequests"/"oneTimeNeeds") on the backend).
        setPrayerRequests(
          enabledFeatures.prayerRequests ? (result.prayerRequests || []).map((r) => ({ ...r, state: "pending" })) : []
        );
        setOneTimeNeeds(
          enabledFeatures.oneTimeNeeds ? (result.oneTimeNeeds || []).map((n) => ({ ...n, state: "pending" })) : []
        );
        setStatus("ready");
      })
      .catch((err) => {
        setError(err.response?.data?.error || "Failed to scan this file");
        setStatus("error");
      });
  }, []);

  function updatePrayerRequest(i, field, value) {
    setPrayerRequests((list) => list.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  function updateNeed(i, field, value) {
    setOneTimeNeeds((list) => list.map((n, idx) => (idx === i ? { ...n, [field]: value } : n)));
  }

  async function addPrayerRequest(i) {
    const r = prayerRequests[i];
    setPrayerRequests((list) => list.map((x, idx) => (idx === i ? { ...x, state: "saving" } : x)));
    try {
      await createPrayerRequest({
        missionaryId,
        organizationId,
        category: r.category,
        requestText: r.requestText,
        dateReceived: defaultDate,
      });
      setPrayerRequests((list) => list.map((x, idx) => (idx === i ? { ...x, state: "added" } : x)));
    } catch (err) {
      setPrayerRequests((list) => list.map((x, idx) => (idx === i ? { ...x, state: "pending" } : x)));
      alert(err.response?.data?.error || "Failed to add this prayer request");
    }
  }

  async function addNeed(i) {
    const n = oneTimeNeeds[i];
    if (!n.requestedAmount) {
      alert("Enter a dollar amount before adding");
      return;
    }
    setOneTimeNeeds((list) => list.map((x, idx) => (idx === i ? { ...x, state: "saving" } : x)));
    try {
      await createSupportNeed({
        missionaryId,
        organizationId,
        description: n.description,
        requestedAmount: n.requestedAmount,
        requestDate: defaultDate,
      });
      setOneTimeNeeds((list) => list.map((x, idx) => (idx === i ? { ...x, state: "added" } : x)));
    } catch (err) {
      setOneTimeNeeds((list) => list.map((x, idx) => (idx === i ? { ...x, state: "pending" } : x)));
      alert(err.response?.data?.error || "Failed to add this one-time need");
    }
  }

  const nothingFound = status === "ready" && prayerRequests.length === 0 && oneTimeNeeds.length === 0;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="admin-section"
        style={{ background: "#fff", maxWidth: "40rem", width: "90%", maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ marginBottom: 0 }}>Scan results</h3>
          <button type="button" className="btn secondary small" onClick={onClose}>
            Close
          </button>
        </div>

        {status === "loading" && <p style={{ color: "#555" }}>Reading the file with Claude — this can take up to a minute...</p>}
        {status === "error" && <p style={{ color: "#b91c1c" }}>{error}</p>}
        {nothingFound && <p style={{ color: "#888" }}>No prayer requests or one-time needs found in this file.</p>}

        {prayerRequests.length > 0 && (
          <div style={{ marginTop: "1rem" }}>
            <h4>Prayer requests</h4>
            {prayerRequests.map((r, i) => (
              <div key={i} className="repeatable-row">
                <select
                  value={r.category}
                  disabled={r.state !== "pending"}
                  onChange={(e) => updatePrayerRequest(i, "category", e.target.value)}
                  style={{ marginBottom: "0.5rem" }}
                >
                  <option value="short_term">Short-term</option>
                  <option value="long_term">Long-term</option>
                </select>
                <textarea
                  value={r.requestText}
                  disabled={r.state !== "pending"}
                  onChange={(e) => updatePrayerRequest(i, "requestText", e.target.value)}
                  rows={2}
                  style={{ width: "100%" }}
                />
                <div className="table-actions" style={{ marginTop: "0.5rem" }}>
                  {r.state === "added" ? (
                    <span style={{ color: "#2a5d3c" }}>Added ✓</span>
                  ) : (
                    <button type="button" className="btn small" disabled={r.state === "saving"} onClick={() => addPrayerRequest(i)}>
                      {r.state === "saving" ? "Adding..." : "+ Add prayer request"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {oneTimeNeeds.length > 0 && (
          <div style={{ marginTop: "1rem" }}>
            <h4>One-time needs</h4>
            {oneTimeNeeds.map((n, i) => (
              <div key={i} className="repeatable-row">
                <textarea
                  value={n.description}
                  disabled={n.state !== "pending"}
                  onChange={(e) => updateNeed(i, "description", e.target.value)}
                  rows={2}
                  style={{ width: "100%" }}
                />
                <label style={{ display: "block", marginTop: "0.5rem", fontWeight: "normal" }}>
                  Amount ($)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={n.requestedAmount ?? ""}
                    disabled={n.state !== "pending"}
                    onChange={(e) => updateNeed(i, "requestedAmount", e.target.value ? Number(e.target.value) : null)}
                    style={{ width: "8rem", marginLeft: "0.5rem" }}
                  />
                </label>
                <div className="table-actions" style={{ marginTop: "0.5rem" }}>
                  {n.state === "added" ? (
                    <span style={{ color: "#2a5d3c" }}>Added ✓</span>
                  ) : (
                    <button type="button" className="btn small" disabled={n.state === "saving"} onClick={() => addNeed(i)}>
                      {n.state === "saving" ? "Adding..." : "+ Add one-time need"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
