import React, { useEffect, useState } from "react";
import { fetchCountryInfo } from "../api/client.js";

// Joshua Project's progress-scale tiers. JPScaleCtry is the authoritative 1-5 tier; matching
// JPScaleText is only a fallback when it is absent (its wording isn't documented), degrading to
// plain text rather than a wrong color. "frontier" is checked before the bare "unreached".
const JP_SCALE_TEXT_TIERS = [
  { match: /frontier/i, tier: 1 },
  { match: /unreached/i, tier: 1 },
  { match: /minimally/i, tier: 2 },
  { match: /superficially/i, tier: 3 },
  { match: /partially/i, tier: 4 },
  { match: /significantly/i, tier: 5 },
];

function jpScaleTier(info) {
  if (typeof info.JPScaleCtry === "number" && info.JPScaleCtry >= 1 && info.JPScaleCtry <= 5) {
    return info.JPScaleCtry;
  }
  const hit = info.JPScaleText && JP_SCALE_TEXT_TIERS.find((t) => t.match.test(info.JPScaleText));
  return hit ? hit.tier : null;
}

// Window1040's wire shape isn't documented (boolean vs "Y"/"N" vs 1/0): render the badge only when
// unambiguously affirmative, never a "No" badge, since a wrong claim about a place is worse than silence.
function isAffirmative(value) {
  if (value === true || value === 1) return true;
  return typeof value === "string" && /^(y|yes|true)$/i.test(value.trim());
}

// Rendered in its own non-clickable card, not nested in the clickable Serving Location
// EditableSection (a toggle click bubbled up and opened the edit popup). Loads by default: the
// backend (utils/joshuaProject.js) caches each country's response for 24h.
export default function CountryStats({ countryCode }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!countryCode) return;
    let cancelled = false;
    setInfo(null);
    setFailed(false);
    setLoading(true);
    fetchCountryInfo(countryCode)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  if (!countryCode) return null;

  return (
    <div className="country-stats">
      <div className="country-stats-panel">
        {loading && <p>Loading...</p>}
        {failed && <p>Country statistics unavailable.</p>}
        {info && (
          <>
            <dl className="country-stats-grid">
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
              {info.JPScaleText &&
                (() => {
                  const tier = jpScaleTier(info);
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
                    {info.BibleComplete} of {info.CntPrimaryLanguages} primary languages have a complete Bible
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
    </div>
  );
}
