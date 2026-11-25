import React, { useEffect, useState } from "react";
import { fetchSupportOptions } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import { groupOptions } from "../components/admin/SupportPreferencesCard.jsx";
import { formatDateLong, todayInputValue } from "../utils/format.js";

// A clean, printable copy of the current menu (retired options left out) for a conversation with
// a partner: groups, boxes to tick, and lines to write on. It stores and sends nothing; staff
// still record the answers on the partner's card. Printing reuses the report letterhead and the
// global print rules in index.css (browser print, "Save as PDF" for a PDF).
export default function AdminSettingsSupportPreferencesPrint() {
  const { churchName, logo } = useSettings();
  const [options, setOptions] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSupportOptions()
      .then((all) => setOptions(all.filter((o) => o.active)))
      .catch(() => setError("Couldn't load the menu."));
  }, []);

  const groups = groupOptions(options || []);

  return (
    <div className="admin-shell">
      <div className="no-print">
        <SettingsPageHeader
          title="Printable menu"
          crumbLabel="Printable menu"
          actions={
            <button type="button" className="btn" onClick={() => window.print()} disabled={!options?.length}>
              Print
            </button>
          }
        />
        <p style={{ color: "var(--muted)" }}>
          A copy of the menu to print or save as a PDF (use your browser&apos;s print dialog). Options you
          have retired are left out. It stores nothing: record a partner&apos;s answers on their page
          afterwards.
        </p>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {options && options.length === 0 && <p>There are no options on the menu yet.</p>}

      {options && options.length > 0 && (
        <div className="admin-section support-menu-sheet">
          <div className="report-letterhead" aria-hidden="true">
            {logo?.url && <img src={logo.url} alt="" className="report-letterhead-logo" />}
            <div className="report-letterhead-text">
              {churchName && <div className="report-letterhead-church">{churchName}</div>}
              <div className="report-letterhead-title">How can we support you?</div>
            </div>
            <div className="report-letterhead-meta">
              {formatDateLong(todayInputValue(), { fallback: "" })}
            </div>
          </div>
          <h3 className="support-menu-title">How can we support you?</h3>
          <p className="support-menu-lead">
            Tick anything that would help, and add a note where you like. This stays with your care team.
          </p>
          {groups.map((g) => (
            <section key={g.name} className="support-menu-group">
              <h4>{g.name}</h4>
              {g.options.map((o) => (
                <div key={o.id} className="support-menu-option">
                  {o.kind === "offer" && <div>☐ {o.label}</div>}
                  {o.kind === "text" && (
                    <>
                      <div>{o.label}</div>
                      <div className="support-menu-line" />
                      <div className="support-menu-line" />
                    </>
                  )}
                  {(o.kind === "single" || o.kind === "multiple") && (
                    <>
                      <div>
                        {o.label}{" "}
                        <span className="support-menu-hint">
                          ({o.kind === "single" ? "pick one" : "pick any"})
                        </span>
                      </div>
                      <div className="support-menu-choices">
                        {o.choices.map((c) => (
                          <span key={c}>☐ {c}</span>
                        ))}
                        {o.allowOther && <span>☐ Something else: ____________</span>}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </section>
          ))}
          <p className="support-menu-footer">
            Name: ______________________________ &nbsp; Date: ______________
          </p>
        </div>
      )}
    </div>
  );
}
