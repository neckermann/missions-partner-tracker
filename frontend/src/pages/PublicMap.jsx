import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchPublicPartners } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";

// Marker images come from the installed leaflet package, not a CDN. Vite
// rewrites these imports to hashed files it serves itself.
//
// They used to point at unpkg.com, with a comment saying bundlers couldn't
// resolve them otherwise. That is true of the *default* icon paths Leaflet
// builds at runtime -- it guesses them from its own stylesheet URL, which a
// bundler moves -- but it was never true of an explicit import, which is
// the normal fix. The CDN version meant every pin on the public map, and
// the Leaflet stylesheet in index.html, depended on a third party staying
// reachable. See the tile comment below for what that costs.
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

// A 1x1 transparent pixel, used for tiles that fail to load.
//
// Leaflet's default is to leave the failed response visible, so when a tile
// provider refuses a request its error image tiles the whole viewport --
// OpenStreetMap's is a yellow hazard-tape graphic reading "Access blocked",
// repeated across the map. The pins stay correct underneath it, so a blank
// background is both more honest and more usable than the provider's
// complaint rendered five hundred times.
const BLANK_TILE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// Basemap tiles.
//
// This pointed at {s}.tile.openstreetmap.org, which is not allowed. Those
// are OpenStreetMap's volunteer-run servers, and their tile usage policy
// forbids exactly this -- a deployed app pointing users at them -- so they
// eventually answered with a 403 whose body says so. The {s} subdomain
// trick made it worse: it exists to open more parallel connections than a
// single host allows, which is the specific behaviour the policy calls out,
// and OSM deprecated those subdomains besides.
//
// CARTO publishes these basemaps for public web use, keyless, asking only
// for the attribution below -- which matters for this project, because a
// church deploying its own instance cannot be made to go and register for
// an API key first.
//
// Nothing here is free of someone else's terms, though, which is the real
// lesson of the 403: a church that gets blocked, wants satellite imagery,
// or has its own provider should be able to change this from the admin UI
// rather than by editing this file. See CONTRIBUTING.md on why per-instance
// choices belong in Church Settings.
const TILE_URL = "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

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
// Same marker image as missionaries, tinted via a CSS hue-rotate filter
// (see .org-marker in index.css) so organization pins are visually distinct
// without needing a separate image asset.
const orgIcon = new L.Icon({
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
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
        <Link to={`/partners/${m.id}`} className="btn secondary small">
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
              alt={o.displayName}
              className="popup-avatar"
              onError={(e) => (e.target.style.display = "none")}
            />
          )}
          <h3 className="popup-name">{o.displayName}</h3>
          <p className="popup-meta">{[o.orgType, o.fieldDisplayName].filter(Boolean).join(" · ")}</p>
          {o.overviewShort && <p className="popup-summary">{o.overviewShort}</p>}
        </div>
        <Link to={`/partners/${o.id}`} className="btn secondary small">
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
  // Set when the tile provider refuses or drops a request. The pins are
  // our own data and stay correct, so the map keeps working -- this only
  // explains the blank background instead of leaving it a mystery.
  const [tilesFailed, setTilesFailed] = useState(false);
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
    fetchPublicPartners().then(setPartners).catch(console.error);
  }, []);

  // Both kinds arrive from one endpoint now, split here for the two
  // differently-styled marker sets and the two sidebar groups.
  const missionaries = partners.filter((p) => p.kind === "missionary");
  const organizations = partners.filter((p) => p.kind === "organization");
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
          <button className="btn" onClick={() => setAutoScroll((v) => !v)} style={{ marginRight: "0.5rem" }}>
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
              attribution={TILE_ATTRIBUTION}
              url={TILE_URL}
              errorTileUrl={BLANK_TILE}
              eventHandlers={{
                tileerror: () => setTilesFailed(true),
                tileload: () => setTilesFailed(false),
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
