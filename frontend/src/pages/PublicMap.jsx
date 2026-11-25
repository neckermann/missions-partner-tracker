import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchPublicPartners } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { formatYear } from "../utils/format.js";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import PhotoTile from "../components/shared/PhotoTile.jsx";

// Marker images come from the installed leaflet package, not a CDN: Leaflet's default icon paths are
// guessed at runtime and break under a bundler, and a CDN would make every pin depend on a third party.
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

// A 1x1 transparent pixel for failed tiles. Leaflet otherwise leaves the failed response visible, and
// a provider's error image (OSM's "Access blocked" tape) would tile the whole viewport.
const BLANK_TILE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// Basemap tiles, in preference order. OpenStreetMap blocks by network, so the same build can work for
// one visitor and be blank for another; the map moves to the next source when one fails repeatedly.
// Sources must be keyless (a self-hosting church can't register for a tile account). CARTO was removed:
// it serves a 200 "API KEY REQUIRED" watermark tile. Esri's path order is {z}/{y}/{x}. Every host must
// also be allowed by the CSP img-src in backend/src/server.js, or the browser blocks it silently (a test pins the two).
const TILE_SOURCES = [
  {
    name: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    name: "Esri",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
];

// Tile failures on one source before moving to the next: above one flaky request, within the first screenful.
const TILE_FAILURES_BEFORE_FALLBACK = 4;

const icon = new L.Icon({
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
const restrictedIcon = new L.Icon({
  iconUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [18, 30],
  iconAnchor: [9, 30],
  className: "restricted-marker",
});
// Same marker image as missionaries, tinted via CSS hue-rotate (.org-marker in index.css).
const orgIcon = new L.Icon({
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  className: "org-marker",
});

const DEFAULT_TOUR_SECONDS = 30;
// See the tourSeconds comment below for why there is a floor at all.
const MIN_TOUR_SECONDS = 10;

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

// Popups are quick details only; the rest lives on the detail page. Leaflet auto-pans a popup once, using its
// size at open time, which can be measured before layout finishes; calling update() after mount re-runs the pan.
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
      // The fixed app header sits over the map and Leaflet's auto-pan doesn't know it; pad the top.
      autoPanPaddingTopLeft={[20, 80]}
      autoPanPaddingBottomRight={[20, 20]}
    >
      <div className="popup-card">
        <div className="popup-header">
          {m.photo && (
            <PhotoTile src={m.photo} alt={m.displayName} shape="circle" size={176} className="popup-avatar" />
          )}
          <h3 className="popup-name">{m.displayName}</h3>
          <p className="popup-meta">
            {[m.fieldDisplayName, m.supportingSince && `Partnering since ${formatYear(m.supportingSince)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {m.overviewShort && <p className="popup-summary">{m.overviewShort}</p>}
        </div>
        <Link to={`/partners/${m.id}`} className="btn small">
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
            <PhotoTile src={o.photo} alt={o.displayName} shape="circle" size={176} className="popup-avatar" />
          )}
          <h3 className="popup-name">{o.displayName}</h3>
          <p className="popup-meta">{[o.orgType, o.fieldDisplayName].filter(Boolean).join(" · ")}</p>
          {o.overviewShort && <p className="popup-summary">{o.overviewShort}</p>}
        </div>
        <Link to={`/partners/${o.id}`} className="btn small">
          View Full Profile
        </Link>
      </div>
    </Popup>
  );
}

export default function PublicMap() {
  const [searchParams] = useSearchParams();
  const [partners, setPartners] = useState([]);
  const [activeIndex, setActiveIndex] = useState(null);
  const [activeOrg, setActiveOrg] = useState(null);
  // Which TILE_SOURCES entry is in use; failures are counted in a ref (it changes on every failed
  // tile and nothing renders from it).
  const [tileSourceIndex, setTileSourceIndex] = useState(0);
  const tileFailures = useRef(0);
  // True once every source has failed; the pins stay correct, this explains the blank background.
  const [tilesFailed, setTilesFailed] = useState(false);
  // ?tour=1 (or ?tourSeconds=..., which implies it) auto-starts the tour on load.
  const [autoScroll, setAutoScroll] = useState(searchParams.has("tour") || searchParams.has("tourSeconds"));
  const intervalRef = useRef(null);
  const markerRefs = useRef({});
  const orgMarkerRefs = useRef({});
  const { partnerTermPlural, publicTagline } = useSettings();
  const tileSource = TILE_SOURCES[tileSourceIndex];

  // ?tourSeconds sets the tour pace (default 30s). Floored because an unattended ?tour=1 display fetches
  // tiles continuously, which OSM's tile usage policy prohibits; lower values are clamped, not rejected.
  const tourSeconds = (() => {
    const raw = Number(searchParams.get("tourSeconds"));
    if (!(raw > 0)) return DEFAULT_TOUR_SECONDS;
    return Math.max(raw, MIN_TOUR_SECONDS);
  })();

  useEffect(() => {
    fetchPublicPartners().then(setPartners).catch(console.error);
  }, []);

  // Split for the two marker styles and sidebar groups.
  const missionaries = partners.filter((p) => p.kind === "missionary");
  const organizations = partners.filter((p) => p.kind === "organization");
  const withCoords = missionaries.filter((m) => m.gpsLat && m.gpsLng);
  const orgsWithCoords = organizations.filter((o) => o.gpsLat && o.gpsLng);

  // Auto fly-through: advance every `tourSeconds`, jumping to the first pin immediately on (re)start,
  // even if the visitor had already clicked a pin.
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

  // Open the active pin's popup automatically when it changes.
  useEffect(() => {
    if (activeMissionary) {
      markerRefs.current[activeMissionary.id]?.openPopup();
    }
  }, [activeMissionary]);

  // Organizations aren't part of the tour cycle; click flies to them and opens the popup.
  useEffect(() => {
    if (activeOrg) {
      orgMarkerRefs.current[activeOrg.id]?.openPopup();
    }
  }, [activeOrg]);

  return (
    <div>
      <PublicSiteHeader title={`Our ${partnerTermPlural} Around the World`} subtitle={publicTagline}>
        <button className="btn" onClick={() => setAutoScroll((v) => !v)}>
          {autoScroll ? "Stop Tour" : "Start Tour"}
        </button>
      </PublicSiteHeader>

      <div className={`map-layout ${autoScroll ? "tour-mode" : ""}`}>
        {/* Quick-identify-and-fly list; full write-ups live on the partner detail page. */}
        {!autoScroll && (
          <div className="missionary-list" role="region" aria-label="Partner list">
            {partners.length === 0 && <p style={{ padding: "1rem" }}>Loading...</p>}
            {missionaries.map((m) => {
              const coordIdx = withCoords.indexOf(m);
              return (
                <button
                  type="button"
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
                </button>
              );
            })}

            {organizations.length > 0 && (
              <>
                <h2 style={{ padding: "0.75rem 1.1rem 0", margin: 0, fontSize: "0.95rem" }}>Organizations</h2>
                {organizations.map((o) => (
                  <button
                    type="button"
                    key={o.id}
                    className={`missionary-card ${activeOrg?.id === o.id ? "active" : ""}`}
                    onClick={() => setActiveOrg(orgsWithCoords.find((org) => org.id === o.id) || null)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      {o.photo && (
                        <img
                          src={o.photo}
                          alt={o.displayName}
                          className="missionary-thumb"
                          onError={(e) => (e.target.style.display = "none")}
                        />
                      )}
                      <div>
                        <h3>
                          {o.displayName}
                          {o.isRestricted && <span className="badge-restricted">Restricted</span>}
                        </h3>
                        <p>{[o.orgType, o.fieldDisplayName].filter(Boolean).join(" · ")}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        <div className="map-container">
          {tilesFailed && (
            <p className="map-tile-warning" role="status">
              The background map isn't loading right now. Locations below are still accurate.
            </p>
          )}
          <MapContainer
            center={[10, 20]}
            zoom={2}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom={true}
          >
            <TileLayer
              // Keyed so Leaflet refetches when the source changes (otherwise only uncached tiles use the new URL).
              key={tileSource.url}
              attribution={tileSource.attribution}
              url={tileSource.url}
              errorTileUrl={BLANK_TILE}
              eventHandlers={{
                tileerror: () => {
                  tileFailures.current += 1;
                  if (tileFailures.current < TILE_FAILURES_BEFORE_FALLBACK) return;
                  tileFailures.current = 0;
                  setTileSourceIndex((current) => {
                    if (current + 1 < TILE_SOURCES.length) return current + 1;
                    // Nothing left to try.
                    setTilesFailed(true);
                    return current;
                  });
                },
                // Only a tile that really arrived counts: Leaflet swaps a failed tile to errorTileUrl, whose
                // load event would otherwise immediately undo the tileerror.
                tileload: (e) => {
                  if (e.tile?.src && !e.tile.src.startsWith("data:")) {
                    tileFailures.current = 0;
                    setTilesFailed(false);
                  }
                },
              }}
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
