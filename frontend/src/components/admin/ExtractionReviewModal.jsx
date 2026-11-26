import React, { useEffect, useState } from "react";
import Modal from "../Modal.jsx";
import { createPrayerRequest, createSupportNeed } from "../../api/client.js";
import { useSettings } from "../../context/SettingsContext.jsx";

// `scan` is the extractFromPartnerFile call (passed in so this component knows nothing about the
// file); it runs once on mount. Nothing is written until the admin clicks Add on a card.
// sourceFileId rides along on save so the created row links back to the file. `onChange` fires
// after each Add so the partner page's already-mounted sections pick up the new row.

// Seeds a card's single textarea as the background followed by the verbatim request/need, so the
// admin edits one block. Only the result is saved (as requestText/description); background itself
// is never persisted.
function joinBackground(background, verbatim) {
  const b = (background || "").trim();
  const v = (verbatim || "").trim();
  return b ? `${b} ${v}` : v;
}

export default function ExtractionReviewModal({
  scan,
  partnerId,
  defaultDate,
  sourceFileId,
  onChange,
  onClose,
}) {
  const { enabledFeatures } = useSettings();
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [prayerRequests, setPrayerRequests] = useState([]);
  const [oneTimeNeeds, setOneTimeNeeds] = useState([]);
  // How many rows this file already produced on an earlier scan. Informational; never blocks Add.
  const [alreadyScannedCount, setAlreadyScannedCount] = useState(0);

  // Runs the scan once, when the modal opens. It is a paid AI call, so it must not re-run if
  // `scan` or the feature flags change identity while the modal is open.
  useEffect(() => {
    scan()
      .then((result) => {
        setAlreadyScannedCount(result.alreadyScannedCount || 0);
        // Don't offer suggestions for a feature the church turned off: Add would 404.
        setPrayerRequests(
          enabledFeatures.prayerRequests
            ? (result.prayerRequests || []).map((r) => ({
                ...r,
                requestText: joinBackground(r.background, r.requestText),
                state: "pending",
              }))
            : []
        );
        setOneTimeNeeds(
          enabledFeatures.oneTimeNeeds
            ? (result.oneTimeNeeds || []).map((n) => ({
                ...n,
                description: joinBackground(n.background, n.description),
                state: "pending",
              }))
            : []
        );
        setStatus("ready");
      })
      .catch((err) => {
        setError(err.response?.data?.error || "Failed to scan this file");
        setStatus("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updatePrayerRequest(i, field, value) {
    setPrayerRequests((list) => list.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  function updateNeed(i, field, value) {
    setOneTimeNeeds((list) => list.map((n, idx) => (idx === i ? { ...n, [field]: value } : n)));
  }

  async function addPrayerRequest(i) {
    const r = prayerRequests[i];
    setPrayerRequests((list) =>
      list.map((x, idx) => (idx === i ? { ...x, state: "saving", cardError: "" } : x))
    );
    try {
      await createPrayerRequest({
        partnerId,
        category: r.category,
        requestText: r.requestText,
        dateReceived: defaultDate,
        sourceFileId,
      });
      setPrayerRequests((list) => list.map((x, idx) => (idx === i ? { ...x, state: "added" } : x)));
      onChange?.();
    } catch (err) {
      setPrayerRequests((list) =>
        list.map((x, idx) =>
          idx === i
            ? {
                ...x,
                state: "pending",
                cardError: err.response?.data?.error || "Failed to add this prayer request",
              }
            : x
        )
      );
    }
  }

  async function addNeed(i) {
    const n = oneTimeNeeds[i];
    setOneTimeNeeds((list) =>
      list.map((x, idx) => (idx === i ? { ...x, state: "saving", cardError: "" } : x))
    );
    try {
      await createSupportNeed({
        partnerId,
        description: n.description,
        // A letter that names no figure adds a need with no amount (saved as 0, shown as "No amount").
        requestedAmount: n.requestedAmount ?? 0,
        requestDate: defaultDate,
        sourceFileId,
      });
      setOneTimeNeeds((list) => list.map((x, idx) => (idx === i ? { ...x, state: "added" } : x)));
      onChange?.();
    } catch (err) {
      setOneTimeNeeds((list) =>
        list.map((x, idx) =>
          idx === i
            ? {
                ...x,
                state: "pending",
                cardError: err.response?.data?.error || "Failed to add this one-time need",
              }
            : x
        )
      );
    }
  }

  const nothingFound = status === "ready" && prayerRequests.length === 0 && oneTimeNeeds.length === 0;

  return (
    <Modal title="Scan results" onClose={onClose}>
      {/* role="status" so a screen reader announces the result of a scan that can take a minute. */}
      {status === "loading" && (
        <p style={{ color: "var(--muted)" }} role="status">
          Reading the file with Claude — this can take up to a minute...
        </p>
      )}
      {status === "error" && (
        <p style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      )}
      {status === "ready" && alreadyScannedCount > 0 && (
        <p
          role="status"
          style={{
            background: "var(--warn-soft)",
            border: "1px solid var(--warn)",
            borderRadius: "4px",
            padding: "0.5rem 0.75rem",
          }}
        >
          This file was already scanned — {alreadyScannedCount} request(s)/need(s) were already added from it.
        </p>
      )}
      {nothingFound && (
        <p style={{ color: "var(--muted)" }}>No prayer requests or one-time needs found in this file.</p>
      )}

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
                <option value="strategic">Ministry</option>
                <option value="situational">Everyday</option>
              </select>
              <textarea
                value={r.requestText}
                disabled={r.state !== "pending"}
                onChange={(e) => updatePrayerRequest(i, "requestText", e.target.value)}
                rows={4}
                style={{ width: "100%" }}
              />
              <div className="table-actions" style={{ marginTop: "0.5rem" }}>
                {r.state === "added" ? (
                  <span style={{ color: "var(--accent)" }}>Added ✓</span>
                ) : (
                  <button
                    type="button"
                    className="btn small"
                    disabled={r.state === "saving"}
                    onClick={() => addPrayerRequest(i)}
                  >
                    {r.state === "saving" ? "Adding..." : "+ Add prayer request"}
                  </button>
                )}
              </div>
              {r.cardError && (
                <p style={{ color: "var(--danger)", marginTop: "0.25rem" }} role="alert">
                  {r.cardError}
                </p>
              )}
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
                rows={4}
                style={{ width: "100%" }}
              />
              <label style={{ display: "block", marginTop: "0.5rem", fontWeight: "normal" }}>
                Amount ($, optional)
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={n.requestedAmount ?? ""}
                  disabled={n.state !== "pending"}
                  onChange={(e) =>
                    updateNeed(i, "requestedAmount", e.target.value ? Number(e.target.value) : null)
                  }
                  style={{ width: "8rem", marginLeft: "0.5rem" }}
                />
              </label>
              <div className="table-actions" style={{ marginTop: "0.5rem" }}>
                {n.state === "added" ? (
                  <span style={{ color: "var(--accent)" }}>Added ✓</span>
                ) : (
                  <button
                    type="button"
                    className="btn small"
                    disabled={n.state === "saving"}
                    onClick={() => addNeed(i)}
                  >
                    {n.state === "saving" ? "Adding..." : "+ Add one-time need"}
                  </button>
                )}
              </div>
              {n.cardError && (
                <p style={{ color: "var(--danger)", marginTop: "0.25rem" }} role="alert">
                  {n.cardError}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
