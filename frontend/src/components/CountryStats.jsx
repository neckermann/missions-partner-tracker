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
              <p className="country-stats-title">Joshua Project Statistics</p>
              <dl className="country-stats-grid">
                {info.Ctry && (
                  <>
                    <dt>Country</dt>
                    <dd>{info.Ctry}</dd>
                  </>
                )}
                {info.ReligionPrimary && (
                  <>
                    <dt>Primary Religion</dt>
                    <dd>{info.ReligionPrimary}</dd>
                  </>
                )}
                {info.Population != null && (
                  <>
                    <dt>Population</dt>
                    <dd>{info.Population.toLocaleString()}</dd>
                  </>
                )}
                {info.PercentChristianity != null && (
                  <>
                    <dt>Christianity</dt>
                    <dd>{info.PercentChristianity.toFixed(2)}%</dd>
                  </>
                )}
                {info.PercentEvangelical != null && (
                  <>
                    <dt>Evangelical</dt>
                    <dd>{info.PercentEvangelical.toFixed(2)}%</dd>
                  </>
                )}
                {info.JPScaleText && (
                  <>
                    <dt>JP Scale</dt>
                    <dd>{info.JPScaleText}</dd>
                  </>
                )}
              </dl>
              <p className="country-stats-source">
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
