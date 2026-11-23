import React, { useEffect, useState } from "react";
import { fetchTripsSettings, updateTripsSettings } from "../api/client.js";
import ApplicationQuestionsEditor from "../components/admin/ApplicationQuestionsEditor.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";

// New (#252) -- church-wide settings for the whole Trips feature area.
// Not per-trip (so it doesn't belong on any single trip's own pages --
// AdminTripOverview.jsx etc.) and not general church info (so it doesn't
// belong on the About Church page either). Each concern below is its own
// EditableSection card -- same click-card -> popup -> edit -> save
// boundary every other editable page in this app uses, grouped under
// .admin-section-group/.admin-group-heading the same way
// AdminPartnerDetail.jsx groups its own cards, with that same page's
// jump-rail pattern reused here for the 4 groups.
const emptyForm = {
  onlineGivingUrl: "",
  onlineGivingInstructions: "",
  collectDonorContactInfo: false,
  collectApplicantAddress: true,
  collectEmergencyContact: true,
  allowPrivateApplicationLinks: false,
  allowPublicSupportRaisingLinks: false,
  enableTripBudgeting: false,
  tripApplicationTemplate: [],
  tripQuestionLibrary: [],
  tripRequirementTemplate: [],
  tripRequirementLibrary: [],
};

// Inline, not a shared component -- ApplicationQuestionsEditor.jsx's
// fields (required/options) don't fit a requirement (kind/bodyText/
// reminderLeadDays instead). Two call sites on this same page now
// (tripRequirementTemplate below, and tripRequirementLibrary further
// down) -- both just want the same {items, onChange} controlled list,
// no library-picker prop needed here the way the question editor has
// one, since neither of this component's own two consumers is itself
// a library being picked *from*.
function RequirementTemplateEditor({ items, onChange }) {
  const [draft, setDraft] = useState({
    label: "",
    kind: "document",
    bodyText: "",
    reminderLeadDays: "",
    minorsOnly: false,
  });

  function update(index, patch) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function remove(index) {
    onChange(items.filter((_, i) => i !== index));
  }
  // Move-up/move-down, not drag-and-drop -- matches
  // ApplicationQuestionsEditor.jsx's own reasoning (no drag-and-drop
  // precedent anywhere in this app, not worth a new dependency for a
  // realistically-short list). This editor never had reorder at all
  // before; order matters here (it's the literal sequence a participant
  // sees requirements in), so it gets the same move buttons the question
  // editor already has, not a new pattern.
  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  }
  function add(e) {
    e.preventDefault();
    if (!draft.label.trim()) return;
    onChange([
      ...items,
      {
        id: crypto.randomUUID(),
        label: draft.label.trim(),
        kind: draft.kind,
        bodyText: draft.kind === "esignature" ? draft.bodyText.trim() || null : null,
        reminderLeadDays: draft.reminderLeadDays ? Number(draft.reminderLeadDays) : null,
        minorsOnly: draft.minorsOnly,
      },
    ]);
    setDraft({ label: "", kind: "document", bodyText: "", reminderLeadDays: "", minorsOnly: false });
  }

  return (
    <div>
      <ol style={{ paddingLeft: "1.2rem" }}>
        {items.map((item, index) => (
          <li key={item.id} style={{ marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <button
                  type="button"
                  className="btn-remove"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="btn-remove"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                  title="Move down"
                >
                  ▼
                </button>
              </div>
              <input
                style={{ flex: 1, minWidth: 200 }}
                value={item.label}
                onChange={(e) => update(index, { label: e.target.value })}
              />
              <select value={item.kind} onChange={(e) => update(index, { kind: e.target.value })}>
                <option value="document">Document</option>
                <option value="task">Task</option>
                <option value="esignature">E-signature</option>
              </select>
              <label
                style={{
                  fontWeight: 400,
                  fontSize: "0.85rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.3rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!item.minorsOnly}
                  onChange={(e) => update(index, { minorsOnly: e.target.checked })}
                />
                Minors only
              </label>
              <button type="button" className="btn-remove" onClick={() => remove(index)}>
                ✕
              </button>
            </div>
            {item.kind === "esignature" && (
              <textarea
                style={{ marginTop: "0.4rem" }}
                rows={3}
                placeholder="Agreement text the participant will sign"
                value={item.bodyText || ""}
                onChange={(e) => update(index, { bodyText: e.target.value })}
              />
            )}
          </li>
        ))}
      </ol>
      <form onSubmit={add} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <input
          style={{ flex: 1, minWidth: 200 }}
          value={draft.label}
          onChange={(e) => setDraft((f) => ({ ...f, label: e.target.value }))}
          placeholder="e.g. Signed Code of Conduct"
        />
        <select value={draft.kind} onChange={(e) => setDraft((f) => ({ ...f, kind: e.target.value }))}>
          <option value="document">Document</option>
          <option value="task">Task</option>
          <option value="esignature">E-signature</option>
        </select>
        <label
          style={{
            fontWeight: 400,
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            gap: "0.3rem",
          }}
        >
          <input
            type="checkbox"
            checked={draft.minorsOnly}
            onChange={(e) => setDraft((f) => ({ ...f, minorsOnly: e.target.checked }))}
          />
          Minors only
        </label>
        {draft.kind === "esignature" && (
          <textarea
            style={{ flex: "1 1 100%", minWidth: 220 }}
            rows={3}
            placeholder="Agreement text the participant will sign"
            value={draft.bodyText}
            onChange={(e) => setDraft((f) => ({ ...f, bodyText: e.target.value }))}
          />
        )}
        <button type="submit" className="btn secondary small">
          + Add
        </button>
      </form>
    </div>
  );
}

function AdminCheckboxField({ checked, onChange, label }) {
  return (
    <div className="admin-checkbox-row">
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    </div>
  );
}

export default function AdminSettingsTrips() {
  const [settings, setSettings] = useState(emptyForm);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetchTripsSettings()
      .then((s) => setSettings({ ...emptyForm, ...s }))
      .catch(() => setLoadError("Couldn't load Trips settings."));
  }, []);

  async function reload() {
    const s = await fetchTripsSettings();
    setSettings({ ...emptyForm, ...s });
  }

  // Each card's onSave sends only the fields it owns -- PUT /settings/trips
  // is a partial update (every field on the schema is optional), so one
  // card's save never touches another card's own data.
  async function savePartial(patch) {
    await updateTripsSettings(patch);
  }

  if (loadError) {
    return (
      <div className="admin-shell">
        <SettingsPageHeader title="Trips Settings" />
        <p className="form-error" role="alert">
          {loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <SettingsPageHeader title="Trips Settings" />

      <div className="partner-jump-rail">
        {[
          { label: "Giving & Budget", href: "#trips-settings-giving" },
          { label: "Application Form", href: "#trips-settings-application" },
          { label: "Trip Requirements", href: "#trips-settings-requirements" },
          { label: "Access & Links", href: "#trips-settings-access" },
        ].map((item) => (
          <a key={item.href} href={item.href} className="btn secondary small">
            {item.label}
          </a>
        ))}
      </div>

      <div className="admin-section-group" id="trips-settings-giving" style={{ scrollMarginTop: "1rem" }}>
        <h2 className="admin-group-heading">Giving &amp; Budget</h2>

        <EditableSection
          title="Giving & Budget"
          value={{
            onlineGivingUrl: settings.onlineGivingUrl || "",
            onlineGivingInstructions: settings.onlineGivingInstructions || "",
            collectDonorContactInfo: settings.collectDonorContactInfo,
            enableTripBudgeting: settings.enableTripBudgeting,
          }}
          onSave={savePartial}
          onSaved={reload}
          view={(v) => (
            <>
              <p>
                <strong>Online giving URL:</strong> {v.onlineGivingUrl || "Not set"}
              </p>
              <p>
                <strong>Online giving instructions:</strong> {v.onlineGivingInstructions || "Not set"}
              </p>
              <p>
                <strong>Donor contact info:</strong>{" "}
                {v.collectDonorContactInfo ? "Collected" : "Not collected"}
              </p>
              <p>
                <strong>Trip budgeting:</strong> {v.enableTripBudgeting ? "On" : "Off"}
              </p>
            </>
          )}
          edit={(d, set) => (
            <>
              <label>
                Online giving URL
                <input
                  value={d.onlineGivingUrl}
                  onChange={(e) => set("onlineGivingUrl", e.target.value)}
                  placeholder="https://give.yourchurch.org"
                />
              </label>
              <label style={{ marginTop: "0.75rem" }}>
                Online giving instructions
                <textarea
                  rows={2}
                  value={d.onlineGivingInstructions}
                  onChange={(e) => set("onlineGivingInstructions", e.target.value)}
                  placeholder="Fund category: Missions Trips. Include the participant's name in the memo."
                />
              </label>

              <h4 style={{ marginTop: "1.25rem" }}>Donor contact info</h4>
              <AdminCheckboxField
                checked={d.collectDonorContactInfo}
                onChange={(v) => set("collectDonorContactInfo", v)}
                label="Collect donor email/phone when logging a contribution"
              />
              <p style={{ color: "#888", fontSize: "0.85rem" }}>
                Never shown on the public support-raising page regardless of this setting — only on the
                participant's own self-service page and to admins.
              </p>

              <h4 style={{ marginTop: "1.25rem" }}>Trip budgets</h4>
              <AdminCheckboxField
                checked={d.enableTripBudgeting}
                onChange={(v) => set("enableTripBudgeting", v)}
                label="Track a planned budget per trip"
              />
              <p style={{ color: "#888", fontSize: "0.85rem" }}>
                Adds a Financial section to each trip's own page for logging estimated costs (flights,
                lodging, etc.) and seeing how much is still needed against what's been raised. Turned off, the
                budget half of that section doesn't appear at all.
              </p>
            </>
          )}
        />
      </div>

      <div
        className="admin-section-group"
        id="trips-settings-application"
        style={{ marginTop: "2rem", scrollMarginTop: "1rem" }}
      >
        <h2 className="admin-group-heading">Application Form</h2>
        <p style={{ color: "#888", fontSize: "0.85rem", margin: "-0.5rem 0 1rem" }}>
          Everything below is part of what a person fills out when applying — before they're ever a confirmed
          participant.
        </p>

        <EditableSection
          title="Application Questions"
          value={{ tripApplicationTemplate: settings.tripApplicationTemplate || [] }}
          onSave={savePartial}
          onSaved={reload}
          view={(v) => (
            <p>
              {(v.tripApplicationTemplate || []).length} question
              {(v.tripApplicationTemplate || []).length === 1 ? "" : "s"} asked on every trip's application,
              before that trip's own questions.
            </p>
          )}
          edit={(d, set) => (
            <ApplicationQuestionsEditor
              questions={d.tripApplicationTemplate}
              library={settings.tripQuestionLibrary || []}
              onAdd={(input) =>
                set("tripApplicationTemplate", [
                  ...d.tripApplicationTemplate,
                  { id: crypto.randomUUID(), ...input },
                ])
              }
              onUpdate={(qId, patch) =>
                set(
                  "tripApplicationTemplate",
                  d.tripApplicationTemplate.map((q) => (q.id === qId ? { ...q, ...patch } : q))
                )
              }
              onRemove={(qId) =>
                set(
                  "tripApplicationTemplate",
                  d.tripApplicationTemplate.filter((q) => q.id !== qId)
                )
              }
              onReorder={(reordered) => set("tripApplicationTemplate", reordered)}
              onAddFromLibrary={(entry) =>
                set("tripApplicationTemplate", [
                  ...d.tripApplicationTemplate,
                  { ...entry, id: crypto.randomUUID() },
                ])
              }
            />
          )}
        />

        <div style={{ marginTop: "1rem" }}>
          <EditableSection
            title="Saved Question Library"
            value={{ tripQuestionLibrary: settings.tripQuestionLibrary || [] }}
            onSave={savePartial}
            onSaved={reload}
            view={(v) => (
              <p>
                {(v.tripQuestionLibrary || []).length} reusable question
                {(v.tripQuestionLibrary || []).length === 1 ? "" : "s"} — not itself shown to anyone, ever.
                Pick from it when adding a question above or on any trip's own page.
              </p>
            )}
            edit={(d, set) => (
              <ApplicationQuestionsEditor
                questions={d.tripQuestionLibrary}
                onAdd={(input) =>
                  set("tripQuestionLibrary", [
                    ...d.tripQuestionLibrary,
                    { id: crypto.randomUUID(), ...input },
                  ])
                }
                onUpdate={(qId, patch) =>
                  set(
                    "tripQuestionLibrary",
                    d.tripQuestionLibrary.map((q) => (q.id === qId ? { ...q, ...patch } : q))
                  )
                }
                onRemove={(qId) =>
                  set(
                    "tripQuestionLibrary",
                    d.tripQuestionLibrary.filter((q) => q.id !== qId)
                  )
                }
                onReorder={(reordered) => set("tripQuestionLibrary", reordered)}
              />
            )}
          />
        </div>

        <div style={{ marginTop: "1rem" }}>
          <EditableSection
            title="Applicant Information Collected"
            value={{
              collectApplicantAddress: settings.collectApplicantAddress,
              collectEmergencyContact: settings.collectEmergencyContact,
            }}
            onSave={savePartial}
            onSaved={reload}
            view={(v) => (
              <>
                <p>
                  <strong>Mailing address:</strong>{" "}
                  {v.collectApplicantAddress ? "Collected" : "Not collected"}
                </p>
                <p>
                  <strong>Emergency contact:</strong>{" "}
                  {v.collectEmergencyContact ? "Collected" : "Not collected"}
                </p>
              </>
            )}
            edit={(d, set) => (
              <>
                <h4>Applicant mailing address</h4>
                <AdminCheckboxField
                  checked={d.collectApplicantAddress}
                  onChange={(v) => set("collectApplicantAddress", v)}
                  label="Collect applicant mailing address"
                />
                <p style={{ color: "#888", fontSize: "0.85rem" }}>
                  Shown as a real structured address block on the public application form — street, city,
                  state, postal code, country. Turned off, the block doesn't appear on the form at all.
                </p>

                <h4 style={{ marginTop: "1.25rem" }}>Applicant emergency contact</h4>
                <AdminCheckboxField
                  checked={d.collectEmergencyContact}
                  onChange={(v) => set("collectEmergencyContact", v)}
                  label="Collect applicant emergency contact info"
                />
                <p style={{ color: "#888", fontSize: "0.85rem" }}>
                  Shown as a real structured name/phone/email block on the public application form. Turned
                  off, the block doesn't appear on the form at all.
                </p>
              </>
            )}
          />
        </div>
      </div>

      <div
        className="admin-section-group"
        id="trips-settings-requirements"
        style={{ marginTop: "2rem", scrollMarginTop: "1rem" }}
      >
        <h2 className="admin-group-heading">Trip Requirements</h2>
        <p style={{ color: "#888", fontSize: "0.85rem", margin: "-0.5rem 0 1rem" }}>
          What's needed <strong>after</strong> someone is accepted onto the team — a different phase from the
          application form above.
        </p>

        <EditableSection
          title="Trip Requirements"
          value={{ tripRequirementTemplate: settings.tripRequirementTemplate || [] }}
          onSave={savePartial}
          onSaved={reload}
          view={(v) => (
            <p>
              {(v.tripRequirementTemplate || []).length} requirement
              {(v.tripRequirementTemplate || []).length === 1 ? "" : "s"} automatically added to every
              newly-created, actively-recruiting trip.
            </p>
          )}
          edit={(d, set) => (
            <>
              <p style={{ color: "#888", fontSize: "0.85rem" }}>
                Editing this later only affects trips created afterward; it never changes an already-created
                trip's own copy.
              </p>
              <RequirementTemplateEditor
                items={d.tripRequirementTemplate}
                onChange={(items) => set("tripRequirementTemplate", items)}
              />
            </>
          )}
        />

        <div style={{ marginTop: "1rem" }}>
          <EditableSection
            title="Saved Requirement Library"
            value={{ tripRequirementLibrary: settings.tripRequirementLibrary || [] }}
            onSave={savePartial}
            onSaved={reload}
            view={(v) => (
              <p>
                {(v.tripRequirementLibrary || []).length} reusable requirement
                {(v.tripRequirementLibrary || []).length === 1 ? "" : "s"} — not added to any trip
                automatically. Pick from it on a specific trip's own Requirements section when that trip
                actually needs it.
              </p>
            )}
            edit={(d, set) => (
              <RequirementTemplateEditor
                items={d.tripRequirementLibrary}
                onChange={(items) => set("tripRequirementLibrary", items)}
              />
            )}
          />
        </div>
      </div>

      <div
        className="admin-section-group"
        id="trips-settings-access"
        style={{ marginTop: "2rem", scrollMarginTop: "1rem" }}
      >
        <h2 className="admin-group-heading">Access &amp; Links</h2>

        <EditableSection
          title="Access & Links"
          value={{
            allowPrivateApplicationLinks: settings.allowPrivateApplicationLinks,
            allowPublicSupportRaisingLinks: settings.allowPublicSupportRaisingLinks,
          }}
          onSave={savePartial}
          onSaved={reload}
          view={(v) => (
            <>
              <p>
                <strong>Private application links:</strong> {v.allowPrivateApplicationLinks ? "On" : "Off"}
              </p>
              <p>
                <strong>Public support-raising pages:</strong>{" "}
                {v.allowPublicSupportRaisingLinks ? "On" : "Off"}
              </p>
            </>
          )}
          edit={(d, set) => (
            <>
              <AdminCheckboxField
                checked={d.allowPrivateApplicationLinks}
                onChange={(v) => set("allowPrivateApplicationLinks", v)}
                label="Allow staff to generate private application links"
              />
              <div style={{ marginTop: "0.6rem" }}>
                <AdminCheckboxField
                  checked={d.allowPublicSupportRaisingLinks}
                  onChange={(v) => set("allowPublicSupportRaisingLinks", v)}
                  label="Allow participants to have public support-raising pages"
                />
              </div>
            </>
          )}
        />
      </div>
    </div>
  );
}
