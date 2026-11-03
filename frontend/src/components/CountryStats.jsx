import React, { useState } from "react";
import { fetchCountryInfo } from "../api/client.js";

// Joshua Project's own progress-scale tiers (#157) -- matched by substring
// rather than an exact string, since JPScaleText's precise wording isn't
// contractually documented and this degrades gracefully (plain text, no
// color) for any value that doesn't match rather than risk showing a wrong
// color for an unexpected one. "frontier" is checked before the bare
// "unreached" it's a more specific variant of.
const JP_SCALE_TIERS = [
  { match: /frontier/i, tier: 1 },
  { match: /unreached/i, tier: 1 },
  { match: /minimally/i, tier: 2 },
  { match: /superficially/i, tier: 3 },
  { match: /partially/i, tier: 4 },
  { match: /significantly/i, tier: 5 },
];

function jpScaleTier(text) {
  const hit = JP_SCALE_TIERS.find((t) => t.match.test(text));
  return hit ? hit.tier : null;
}

// Window1040's exact wire shape isn't documented (boolean vs "Y"/"N" vs
// 1/0) -- only render the badge when it's unambiguously affirmative, never
// a "No" badge, since a false negative here (silently not shown) is a far
// smaller problem than a wrong claim about a real place.
function isAffirmative(value) {
  if (value === true || value === 1) return true;
  return typeof value === "string" && /^(y|yes|true)$/i.test(value.trim());
}

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
                {info.JPScaleText &&
                  (() => {
                    const tier = jpScaleTier(info.JPScaleText);
                    const title =
                      "Joshua Project's Progress Scale: how reached this country's peoples are, from Unreached (1) to Significantly reached (5).";
                    return (
                      <>
                        <dt>JP Scale</dt>
                        <dd>
                          {tier ? (
                            <>
                              <span className={`jp-scale-pill jp-scale-${tier}`} title={title}>
                                {info.JPScaleText}
                              </span>
                              <div className="jp-scale-gauge" title={title}>
                                <div className="jp-scale-gauge-labels">
                                  <span>Unreached</span>
                                  <span>Reached</span>
                                </div>
                                <span className="jp-scale-gauge-track">
                                  <span className="jp-scale-1" />
                                  <span className="jp-scale-2" />
                                  <span className="jp-scale-3" />
                                  <span className="jp-scale-4" />
                                  <span className="jp-scale-5" />
                                  <span
                                    className="jp-scale-gauge-marker"
                                    style={{ left: `${((tier - 0.5) / 5) * 100}%` }}
                                  />
                                </span>
                              </div>
                            </>
                          ) : (
                            info.JPScaleText
                          )}
                        </dd>
                      </>
                    );
                  })()}
                {isAffirmative(info.Window1040) && (
                  <>
                    <dt>10/40 Window</dt>
                    <dd>
                      <span
                        className="status-pill warn"
                        title="The 10/40 Window: the band of latitude (10°N-40°N) home to most of the world's least-reached peoples."
                      >
                        Yes
                      </span>
                    </dd>
                  </>
                )}
                {info.CntPeoplesLR > 0 && (
                  <>
                    <dt>Unreached People Groups</dt>
                    <dd>
                      {info.CntPeoplesLR.toLocaleString()}
                      {info.PoplPeoplesLR != null && ` (${info.PoplPeoplesLR.toLocaleString()} people)`}
                    </dd>
                  </>
                )}
                {info.CntPeoplesFPG > 0 && (
                  <>
                    <dt>Frontier People Groups</dt>
                    <dd>
                      {info.CntPeoplesFPG.toLocaleString()}
                      {info.PoplPeoplesFPG != null && ` (${info.PoplPeoplesFPG.toLocaleString()} people)`}
                    </dd>
                  </>
                )}
                {info.BibleComplete != null && info.CntPrimaryLanguages > 0 && (
                  <>
                    <dt>Bible Access</dt>
                    <dd>
                      {info.BibleComplete} of {info.CntPrimaryLanguages} primary languages have a complete
                      Bible
                    </dd>
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
