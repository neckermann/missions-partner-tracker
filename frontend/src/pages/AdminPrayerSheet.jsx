import React, { useCallback, useEffect, useState } from "react";
import { fetchPrayerSheet } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { formatDateLong, todayInputValue } from "../utils/format.js";

// The Sunday prayer sheet: a one-page, printable list of what to pray for, or the same thing one partner per slide
// for the screen at church. The content is already limited by the server to what the public site may show
// (backend/src/utils/prayerSheet.js); this page only lays it out. How often the church makes a sheet decides how
// many partners are on each (a rotation, so everyone is prayed for about once a month).
const CADENCES = [
  { value: "weekly", label: "Every week", hint: "a quarter of our partners on each sheet" },
  { value: "biweekly", label: "Every two weeks", hint: "half of our partners on each sheet" },
  { value: "monthly", label: "Once a month", hint: "all of our partners on one sheet" },
];
const STORAGE_KEY = "prayerSheetCadence";

// The coming Sunday (today, when today is one), as yyyy-mm-dd, worked out from the same date string the date field
// uses so the browser's time zone cannot push it a day either way.
export function nextSunday(today = todayInputValue()) {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return new Date(Date.UTC(y, m - 1, d + ((7 - weekday) % 7))).toISOString().slice(0, 10);
}

function savedCadence() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return CADENCES.some((c) => c.value === value) ? value : "weekly";
  } catch {
    return "weekly";
  }
}

export default function AdminPrayerSheet() {
  const { churchName, partnerTermPlural } = useSettings();
  const [cadence, setCadence] = useState(savedCadence);
  const [date, setDate] = useState(() => nextSunday());
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [slide, setSlide] = useState(null); // null = not showing slides, otherwise the index

  useEffect(() => {
    if (!date) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchPrayerSheet({ date, cadence })
      .then((data) => !cancelled && setSheet(data))
      .catch(() => !cancelled && setError("Couldn't load the prayer sheet."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date, cadence]);

  function chooseCadence(value) {
    setCadence(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* the choice just isn't remembered */
    }
  }

  const partners = sheet?.partners || [];
  const closeSlides = useCallback(() => setSlide(null), []);
  const cadenceHint = CADENCES.find((c) => c.value === cadence)?.hint;
  const term = (partnerTermPlural || "Missionaries").toLowerCase();

  return (
    <div className="admin-shell prayer-sheet-page">
      <div className="no-print">
        <h2>Prayer sheet</h2>
        <p style={{ color: "var(--muted)" }}>
          A page to print for Sunday, or slides for the screen. It shows only what your public site may show:
          public {term} and their public prayer requests, never private ones. The sheets rotate through your{" "}
          {term}, so each one comes round about once a month.
        </p>
        <div className="prayer-sheet-controls">
          <label>
            Make a sheet
            <select value={cadence} onChange={(e) => chooseCadence(e.target.value)}>
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            For the Sunday of
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="prayer-sheet-buttons">
            <button
              type="button"
              className="btn"
              onClick={() => window.print()}
              disabled={partners.length === 0}
            >
              Print
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setSlide(0)}
              disabled={partners.length === 0}
            >
              Show as slides
            </button>
          </div>
        </div>
        {cadenceHint && (
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>This sheet: {cadenceHint}.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <article className="prayer-sheet" aria-label="Prayer sheet">
        <header className="prayer-sheet-header">
          {churchName && <div className="prayer-sheet-church">{churchName}</div>}
          <h1>Praying for our {partnerTermPlural || "Missionaries"}</h1>
          <div className="prayer-sheet-date">{formatDateLong(date, { fallback: "" })}</div>
        </header>
        {loading && !sheet ? (
          <p>Loading…</p>
        ) : partners.length === 0 ? (
          <p className="prayer-sheet-empty">
            Nothing to pray for on this sheet yet. A partner appears once it is public and has a public prayer
            request marked as ministry.
          </p>
        ) : (
          <ul className="prayer-sheet-list">
            {partners.map((p) => (
              <li key={p.id} className="prayer-sheet-partner">
                <h2>
                  {p.displayName}
                  {p.country && <span className="prayer-sheet-country"> · {p.country}</span>}
                </h2>
                <ul>
                  {p.requests.map((r) => (
                    <li key={r.id}>{r.text}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {sheet && sheet.totalPartners > 0 && (
          <footer className="prayer-sheet-footer">
            {sheet.group.count > 1
              ? `Today's sheet: ${partners.length} of ${sheet.totalPartners} ${term}. Everyone comes round about once a month.`
              : `All ${sheet.totalPartners} ${term}.`}
          </footer>
        )}
      </article>

      {slide !== null && partners.length > 0 && (
        <Slides
          partners={partners}
          index={slide}
          onIndex={setSlide}
          onClose={closeSlides}
          title={`Praying for our ${partnerTermPlural || "Missionaries"}`}
        />
      )}
    </div>
  );
}

// One partner per slide: big text for a screen. Left and right arrows move, Escape closes.
function Slides({ partners, index, onIndex, onClose, title }) {
  const last = partners.length - 1;
  const go = useCallback((n) => onIndex(Math.max(0, Math.min(last, n))), [last, onIndex]);
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " ") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go, onClose]);

  const p = partners[index];
  return (
    <div className="prayer-slides no-print" role="dialog" aria-modal="true" aria-label="Prayer slides">
      <div className="prayer-slides-title">{title}</div>
      <div className="prayer-slides-body">
        <h2>
          {p.displayName}
          {p.country && <span className="prayer-sheet-country"> · {p.country}</span>}
        </h2>
        <ul>
          {p.requests.map((r) => (
            <li key={r.id}>{r.text}</li>
          ))}
        </ul>
      </div>
      <div className="prayer-slides-bar">
        <button type="button" className="btn secondary" onClick={() => go(index - 1)} disabled={index === 0}>
          Previous
        </button>
        <span aria-live="polite">
          {index + 1} of {partners.length}
        </span>
        <button
          type="button"
          className="btn secondary"
          onClick={() => go(index + 1)}
          disabled={index === last}
        >
          Next
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
