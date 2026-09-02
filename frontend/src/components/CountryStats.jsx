import React, { useState } from "react";
import { fetchCountryInfo } from "../api/client.js";

// Lazy-loaded Joshua Project country statistics, shown behind a toggle so
// we're not calling out to a third-party API for every missionary on page
// load — only when someone actually wants to see it.
export default function CountryStats({ countryCode }) {
  const [expanded, setExpanded] = useState(false);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!countryCode) return null;

  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (info || failed) return; // already fetched (or already failed) once
    setLoading(true);
    try {
      setInfo(await fetchCountryInfo(countryCode));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="country-stats">
      <button type="button" className="btn secondary small" onClick={toggle}>
        {expanded ? "Hide" : "Show"} Country Statistics
      </button>
      {expanded && (
        <div className="country-stats-panel">
          {loading && <p>Loading...</p>}
          {failed && <p>Country statistics unavailable.</p>}
          {info && (
            <>
              <p style={{ marginTop: 0 }}>Joshua Project Statistics for Country:</p>
              {info.Ctry && <p>Country: {info.Ctry}</p>}
              {info.ReligionPrimary && <p>Primary Religion: {info.ReligionPrimary}</p>}
              {info.Population != null && <p>Population: {info.Population.toLocaleString()}</p>}
              {info.PercentChristianity != null && (
                <p>Christianity: {info.PercentChristianity.toFixed(2)}%</p>
              )}
              {info.PercentEvangelical != null && (
                <p>Evangelical: {info.PercentEvangelical.toFixed(2)}%</p>
              )}
              {info.JPScaleText && <p>JP Scale: {info.JPScaleText}</p>}
              <p style={{ fontSize: "0.75rem", color: "#888", marginBottom: 0 }}>
                Source:{" "}
                <a href="https://www.joshuaproject.net/" target="_blank" rel="noreferrer">
                  joshuaproject.net
                </a>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
