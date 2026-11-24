import React, { useEffect, useState } from "react";
import { fetchPartner, fetchPrayerRequests, fetchPartnerFiles } from "../../api/client.js";
import Field from "./Field.jsx";
import PhotoTile from "../shared/PhotoTile.jsx";
import { AddressSummary } from "../../pages/AdminPartnerDetail.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { addressByType } from "../../utils/addresses.js";
import { fileKindLabel } from "../../utils/fileKinds.js";
import { formatDate, formatDateLong } from "../../utils/format.js";

// A guest's own view of a Partner they hold a grant for -- a separate,
// deliberately minimal component, not AdminPartnerDetail.jsx's normal
// admin/editor/viewer layout with sections conditionally hidden. That page
// is already this app's biggest/most complex (~1,200+ lines) and keeps
// growing; threading isGuest checks through it would make it a
// deny-list a future section could easily forget to also gate. This is an
// allow-list instead: it only ever renders what's deliberately decided
// below, read-only, with no edit affordance at all (this role has none on
// this page) and no link to anywhere this role can't go -- the silent
// "bounced back to your trip with no explanation" bug this was built
// alongside was partly caused by exactly that kind of stray link.
//
// Shown: basic identity (name, current photo, field/region, serving
// location) so a guest recognizes who they're serving alongside,
// plus Prayer Requests and Newsletters & Docs in full detail (per the
// explicit ask -- this role may read that content, unlike financial
// support detail, which the backend now blocks outright for them:
// supportEntries.js/supportNeeds.js).
//
// Deliberately NOT shown, no clear reason this role needs it for their
// one trip: Family/Children/Languages/Furloughs/Church Visits/Links,
// Trip History, Mailing Address, Admin Notes on a prayer request or file.
// Easy to add later if that turns out wrong.
export default function GuestPartnerView({ partnerId }) {
  const { enabledFeatures } = useSettings();
  const [partner, setPartner] = useState(null);
  const [prayerRequests, setPrayerRequests] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    Promise.all([
      fetchPartner(partnerId),
      enabledFeatures.prayerRequests ? fetchPrayerRequests({ partnerId }) : Promise.resolve([]),
      enabledFeatures.partnerFiles ? fetchPartnerFiles({ partnerId }) : Promise.resolve([]),
    ])
      .then(([p, pr, f]) => {
        if (cancelled) return;
        setPartner(p);
        setPrayerRequests(pr);
        setFiles(f);
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
  }, [partnerId, enabledFeatures.prayerRequests, enabledFeatures.partnerFiles]);

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;
  if (failed || !partner) {
    return (
      <div className="admin-shell">
        <p className="field-warning">Couldn't load this partner's details.</p>
      </div>
    );
  }

  const physical = addressByType(partner.addresses, "physical") || {};
  const currentPhoto = partner.photos?.[0];

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        {currentPhoto && <PhotoTile src={currentPhoto.url} alt={partner.displayName} size={96} />}
        <h2 style={{ margin: 0 }}>{partner.displayName}</h2>
      </div>

      <div className="admin-section" style={{ marginTop: "1rem" }}>
        <h3>Overview</h3>
        <Field label="Field / Region" value={partner.fieldDisplayName} showEmpty />
        <div style={{ marginTop: "0.75rem" }}>
          <AddressSummary address={physical} />
        </div>
      </div>

      {enabledFeatures.prayerRequests && (
        <div className="admin-section">
          <h3>Prayer Requests</h3>
          {prayerRequests.length === 0 ? (
            <p style={{ color: "#888" }}>No prayer requests on file.</p>
          ) : (
            prayerRequests.map((r, i) => (
              <div
                key={r.id}
                style={
                  i > 0 ? { borderTop: "1px solid #eee", marginTop: "1rem", paddingTop: "1rem" } : undefined
                }
              >
                <Field label="Category" value={r.category === "strategic" ? "Strategic" : "Situational"} />
                <Field label="Date Received" value={formatDateLong(r.dateReceived)} />
                <Field label="Prayer Request" value={r.requestText} />
                <Field
                  label="Answered"
                  value={
                    r.status === "answered"
                      ? `${formatDateLong(r.dateAnswered)}${r.answeredNote ? ` -- ${r.answeredNote}` : ""}`
                      : "Not yet answered"
                  }
                  showEmpty
                />
              </div>
            ))
          )}
        </div>
      )}

      {enabledFeatures.partnerFiles && (
        <div className="admin-section">
          <h3>Newsletters &amp; Docs</h3>
          {files.length === 0 ? (
            <p style={{ color: "#888" }}>No newsletters or documents on file.</p>
          ) : (
            files.map((f, i) => (
              <div
                key={f.id}
                style={
                  i > 0 ? { borderTop: "1px solid #eee", marginTop: "1rem", paddingTop: "1rem" } : undefined
                }
              >
                <Field label="Kind" value={fileKindLabel(f.kind)} />
                <Field label="Title" value={f.title || f.fileName} />
                <Field label="Received Date" value={formatDate(f.receivedDate)} />
                <button
                  type="button"
                  className="btn secondary small"
                  style={{ marginTop: "0.5rem" }}
                  onClick={() => window.open(`/api/partner-files/${f.id}/download`, "_blank")}
                >
                  Download File
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
