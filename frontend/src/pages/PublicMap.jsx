import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { fetchPublicMissionaries, fetchPublicOrganizations } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";

// Default Leaflet marker icons don't load correctly with bundlers unless
// pointed at the CDN explicitly.
const icon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
const restrictedIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [18, 30],
  iconAnchor: [9, 30],
  className: "restricted-marker",
});
// Same marker image as missionaries, tinted via a CSS hue-rotate filter
// (see .org-marker in index.css) so organization pins are visually distinct
// without needing a separate image asset.
const orgIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  className: "org-marker",
});

const DEFAULT_TOUR_SECONDS = 30;

// supportingSince is a full date under the hood (see backend migration
// notes) but only the year is meaningful to show publicly.
function formatYear(value) {
  if (!value) return null;
  return String(value).slice(0, 4);
}

// Handles flying the map to a given lat/lng whenever `target` changes.
function FlyToController({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo([target.gpsLat, target.gpsLng], 6, { duration: 1.5 });
    }
  }, [target, map]);
  return null;
}

// Popups are just "quick details" — name, photo, a one-line meta, and
// overviewShort — with everything else (full overview, links, sending
// party, country stats) living on the dedicated detail page linked at the
// bottom. Content is static (no more inline expand/collapse), but Leaflet
// still only auto-pans a popup once, at open time, based on its content's
// size at that instant. If that measurement happens to land before the
// browser has finished laying out the popup (e.g. the overviewShort text
// wrapping to a couple lines), part of the popup can end up rendered
// outside the visible map area. Calling update() once after mount forces
// Leaflet to recompute size/position — and re-run its auto-pan — against
// the fully-rendered content.
function MissionaryPopup({ m }) {
  const popupRef = useRef(null);
  useEffect(() => {
    popupRef.current?.update();
  }, []);

  return (
    <Popup
      ref={popupRef}
      minWidth={220}
      maxWidth={280}
      // The app header is a fixed bar sitting on top of the map, which
      // Leaflet's auto-pan has no knowledge of — without extra top padding
      // it can still leave part of a tall popup rendering underneath/behind
      // the header instead of fully inside the visible map area.
      autoPanPaddingTopLeft={[20, 80]}
      autoPanPaddingBottomRight={[20, 20]}
    >
      <div className="popup-card">
        <div className="popup-header">
          {m.photo && (
            <img
              src={m.photo}
              alt={m.displayName}
              className="popup-avatar"
              onError={(e) => (e.target.style.display = "none")}
            />
          )}
          <h3 className="popup-name">{m.displayName}</h3>
          <p className="popup-meta">
            {[m.fieldDisplayName, m.supportingSince && `Since ${formatYear(m.supportingSince)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {m.overviewShort && <p className="popup-summary">{m.overviewShort}</p>}
        </div>
        <Link to={`/partners/missionary/${m.id}`} className="btn secondary small">
          View Full Profile
        </Link>
      </div>
    </Popup>
  );
}

function OrganizationPopup({ o }) {
  const popupRef = useRef(null);
  useEffect(() => {
    popupRef.current?.update();
  }, []);

  return (
    <Popup
      ref={popupRef}
      minWidth={220}
      maxWidth={280}
      autoPanPaddingTopLeft={[20, 80]}
      autoPanPaddingBottomRight={[20, 20]}
    >
      <div className="popup-card">
        <div className="popup-header">
          {o.photo && (
            <img
              src={o.photo}
              alt={o.name}
              className="popup-avatar"
              onError={(e) => (e.target.style.display = "none")}
            />
          )}
          <h3 className="popup-name">{o.name}</h3>
          <p className="popup-meta">{[o.orgType, o.fieldDisplayName].filter(Boolean).join(" · ")}</p>
          {o.overviewShort && <p className="popup-summary">{o.overviewShort}</p>}
        </div>
        <Link to={`/partners/organization/${o.id}`} className="btn secondary small">
          View Full Profile
        </Link>
      </div>
    </Popup>
  );
}

export default function PublicMap() {
  const [searchParams] = useSearchParams();
  const [missionaries, setMissionaries] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [activeIndex, setActiveIndex] = useState(null);
  const [activeOrg, setActiveOrg] = useState(null);
  // ?tour=1 (or just ?tourSeconds=..., which implies tour=1) auto-starts the
  // tour on load, instead of requiring a click on "Start Tour".
  const [autoScroll, setAutoScroll] = useState(searchParams.has("tour") || searchParams.has("tourSeconds"));
  const intervalRef = useRef(null);
  const markerRefs = useRef({});
  const orgMarkerRefs = useRef({});
  const { logo, partnerTermPlural, publicTagline } = useSettings();

  // ?tourSeconds=15 slows down/speeds up the auto-tour; defaults to 30s.
  const tourSeconds = (() => {
    const raw = Number(searchParams.get("tourSeconds"));
    return raw > 0 ? raw : DEFAULT_TOUR_SECONDS;
  })();

  useEffect(() => {
    fetchPublicMissionaries().then(setMissionaries).catch(console.error);
    fetchPublicOrganizations().then(setOrganizations).catch(console.error);
  }, []);

  const withCoords = missionaries.filter((m) => m.gpsLat && m.gpsLng);
  const orgsWithCoords = organizations.filter((o) => o.gpsLat && o.gpsLng);

  // Auto fly-through: advance to the next pin every `tourSeconds` seconds.
  // Jumps to the first pin immediately whenever the tour (re)starts, rather
  // than waiting a full interval — unconditionally, not just when nothing
  // was active yet, so this still fires even if the visitor had already
  // clicked a pin/list card before starting the tour (otherwise it would
  // silently keep showing that pin for a full tourSeconds before advancing).
  useEffect(() => {
    if (autoScroll && withCoords.length > 0) {
      setActiveIndex(0);
      intervalRef.current = setInterval(() => {
        setActiveIndex((prev) => {
          const next = prev === null ? 0 : (prev + 1) % withCoords.length;
          return next;
        });
      }, tourSeconds * 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoScroll, withCoords.length, tourSeconds]);

  const activeMissionary = activeIndex !== null ? withCoords[activeIndex] : null;

  // Whenever the active pin changes (tour advancing, a list click, or a
  // marker click), open its popup automatically instead of requiring an
  // extra click on the pin itself.
  useEffect(() => {
    if (activeMissionary) {
      markerRefs.current[activeMissionary.id]?.openPopup();
    }
  }, [activeMissionary]);

  // Organizations aren't part of the tour/activeIndex cycling — just a
  // click-to-fly-and-open-popup, independent of the missionary tour state.
  useEffect(() => {
    if (activeOrg) {
      orgMarkerRefs.current[activeOrg.id]?.openPopup();
    }
  }, [activeOrg]);

  return (
    <div>
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {logo?.url && <img src={logo.url} alt="" className="header-logo" />}
          <div>
            <h1>Our {partnerTermPlural} Around the World</h1>
            {publicTagline && <p className="header-tagline">{publicTagline}</p>}
          </div>
        </div>
        <div>
          <Link to="/" style={{ color: "white", marginRight: "1rem" }}>
            Partner Directory
          </Link>
          <button
            className="btn"
            onClick={() => setAutoScroll((v) => !v)}
            style={{ marginRight: "0.5rem" }}
          >
            {autoScroll ? "Stop Tour" : "Start Tour"}
          </button>
        </div>
      </header>

      <div className={`map-layout ${autoScroll ? "tour-mode" : ""}`}>
        {/* Quick-identify-and-fly list — just enough to pick a pin. Full
            write-ups (overview, links, country stats, sending party, etc.)
            live on /partners now; a click here still opens the marker's
            popup, which links out to that full profile. */}
        {!autoScroll && (
          <div className="missionary-list">
            {missionaries.length === 0 && <p style={{ padding: "1rem" }}>Loading...</p>}
            {missionaries.map((m) => {
              const coordIdx = withCoords.indexOf(m);
              return (
                <div
                  key={m.id}
                  className={`missionary-card ${coordIdx === activeIndex ? "active" : ""}`}
                  onClick={() => {
                    setAutoScroll(false);
                    setActiveIndex(coordIdx >= 0 ? coordIdx : null);
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    {m.photo && (
                      <img
                        src={m.photo}
                        alt={m.displayName}
                        className="missionary-thumb"
                        onError={(e) => (e.target.style.display = "none")}
                      />
                    )}
                    <div>
                      <h3>
                        {m.displayName}
                        {m.isRestricted && <span className="badge-restricted">Restricted</span>}
                      </h3>
                      <p>{m.fieldDisplayName}</p>
                    </div>
                  </div>
                </div>
              );
            })}

            {organizations.length > 0 && (
              <>
                <h2 style={{ padding: "0.75rem 1.1rem 0", margin: 0, fontSize: "0.95rem" }}>Organizations</h2>
                {organizations.map((o) => (
                  <div
                    key={o.id}
                    className={`missionary-card ${activeOrg?.id === o.id ? "active" : ""}`}
                    onClick={() => setActiveOrg(orgsWithCoords.find((org) => org.id === o.id) || null)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      {o.photo && (
                        <img
                          src={o.photo}
                          alt={o.name}
                          className="missionary-thumb"
                          onError={(e) => (e.target.style.display = "none")}
                        />
                      )}
                      <div>
                        <h3>
                          {o.name}
                          {o.isRestricted && <span className="badge-restricted">Restricted</span>}
                        </h3>
                        <p>{[o.orgType, o.fieldDisplayName].filter(Boolean).join(" · ")}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <div className="map-container">
          <MapContainer
            center={[10, 20]}
            zoom={2}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FlyToController target={activeMissionary} />
            <FlyToController target={activeOrg} />
            {withCoords.map((m) => (
              <Marker
                key={m.id}
                ref={(el) => {
                  if (el) markerRefs.current[m.id] = el;
                }}
                position={[m.gpsLat, m.gpsLng]}
                icon={m.isRestricted ? restrictedIcon : icon}
                eventHandlers={{
                  click: () => {
                    setAutoScroll(false);
                    setActiveIndex(withCoords.indexOf(m));
                  },
                }}
              >
                <MissionaryPopup m={m} />
              </Marker>
            ))}
            {orgsWithCoords.map((o) => (
              <Marker
                key={o.id}
                ref={(el) => {
                  if (el) orgMarkerRefs.current[o.id] = el;
                }}
                position={[o.gpsLat, o.gpsLng]}
                icon={orgIcon}
                eventHandlers={{
                  click: () => setActiveOrg(o),
                }}
              >
                <OrganizationPopup o={o} />
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
