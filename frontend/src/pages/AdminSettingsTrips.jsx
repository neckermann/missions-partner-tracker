import React, { useEffect, useState } from "react";
import { fetchTripsSettings, updateTripsSettings } from "../api/client.js";
import ApplicationQuestionsEditor from "../components/admin/ApplicationQuestionsEditor.jsx";

// New (#252) -- church-wide settings for the whole Trips feature area.
// Not per-trip (so it doesn't belong on AdminTripDetail.jsx) and not
// general church info (so it doesn't belong on the About Church page
// either). A two-page split was tried (issue #262) and reverted -- the
// split introduced a worse problem than it solved (it surfaced two
// settings pages outside the admin-only Settings group) for
// a smaller one (page length), which this app's own biggest page
// (AdminPartnerDetail.jsx, ~1,200 lines) already shows isn't a problem
// clearly-labeled sections can't handle on their own. Sections below are
// grouped by theme (Giving & Budget / Application Form / Trip
// Requirements / Access) and ordered within each group by how directly
// it's used, not alphabetically or by when it was added.
const emptyForm = {
  onlineGivingUrl: "",
  onlineGivingInstructions: "",
  collectDonorContactInfo: false,
  collectApplicantAddress: true,
  collectEmergencyContact: true,
  collectDateOfBirth: true,
  requireDateOfBirth: false,
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

export default function AdminSettingsTrips() {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchTripsSettings()
      .then((s) => setForm({ ...emptyForm, ...s }))
      .catch(() => setError("Couldn't load Trips settings."));
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSuccess("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await updateTripsSettings(form);
      setForm({ ...emptyForm, ...updated });
      setSuccess("Saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save Trips settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>Trips Settings</h2>
      <form onSubmit={handleSubmit} className="admin-section">
        {/* Grouped with real visual dividers (issue #262 -- the page read
        as nine undifferentiated h3's in a row with no way to tell "this is
        part of the application" from "this happens after someone's
        approved" from "this is just money config"). Reuses the exact
        .admin-section-group/.admin-group-heading pattern
        AdminPartnerDetail.jsx already established for the same problem at
        a larger scale -- not a new pattern invented for this one page. */}
        <div className="admin-section-group">
          <h2 className="admin-group-heading">Giving &amp; budget</h2>

          <h3>Donation instructions</h3>
          <label>
            Online giving URL
            <input
              value={form.onlineGivingUrl || ""}
              onChange={(e) => update("onlineGivingUrl", e.target.value)}
              placeholder="https://give.yourchurch.org"
            />
          </label>
          <label style={{ marginTop: "0.75rem" }}>
            Online giving instructions
            <textarea
              rows={2}
              value={form.onlineGivingInstructions || ""}
              onChange={(e) => update("onlineGivingInstructions", e.target.value)}
              placeholder="Fund category: Missions Trips. Include the participant's name in the memo."
            />
          </label>

          <h3 style={{ marginTop: "1.5rem" }}>Donor contact info</h3>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={form.collectDonorContactInfo}
                onChange={(e) => update("collectDonorContactInfo", e.target.checked)}
              />
              Collect donor email/phone when logging a contribution
            </label>
          </div>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>
            Never shown on the public support-raising page regardless of this setting — only on the
            participant's own self-service page and to admins.
          </p>

          <h3 style={{ marginTop: "1.5rem" }}>Trip budgets</h3>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={form.enableTripBudgeting}
                onChange={(e) => update("enableTripBudgeting", e.target.checked)}
              />
              Track a planned budget per trip
            </label>
          </div>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>
            Adds a Budget section to each trip's own page for logging estimated costs (flights, lodging, etc.)
            and seeing how much is still needed against what's been raised. Admin-only — never shown to
            applicants or participants. Turned off, the section doesn't appear at all.
          </p>
        </div>

        <div className="admin-section-group" style={{ marginTop: "2rem" }}>
          <h2 className="admin-group-heading">Application form</h2>
          <p style={{ color: "#888", fontSize: "0.85rem", margin: "-0.5rem 0 0" }}>
            Everything below is part of what a person fills out when applying — before they're ever a
            confirmed participant.
          </p>

          <h3>Application template</h3>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>
            Asked on every trip's application form, before that trip's own questions. Edit here instead of
            re-typing the same question on every trip.
          </p>
          <ApplicationQuestionsEditor
            questions={form.tripApplicationTemplate || []}
            library={form.tripQuestionLibrary || []}
            onAdd={(input) =>
              update("tripApplicationTemplate", [
                ...(form.tripApplicationTemplate || []),
                { id: crypto.randomUUID(), ...input },
              ])
            }
            onUpdate={(qId, patch) =>
              update(
                "tripApplicationTemplate",
                (form.tripApplicationTemplate || []).map((q) => (q.id === qId ? { ...q, ...patch } : q))
              )
            }
            onRemove={(qId) =>
              update(
                "tripApplicationTemplate",
                (form.tripApplicationTemplate || []).filter((q) => q.id !== qId)
              )
            }
            onReorder={(reordered) => update("tripApplicationTemplate", reordered)}
            onAddFromLibrary={(entry) =>
              update("tripApplicationTemplate", [
                ...(form.tripApplicationTemplate || []),
                { ...entry, id: crypto.randomUUID() },
              ])
            }
          />

          <h3 style={{ marginTop: "1.5rem" }}>Applicant date of birth</h3>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={form.collectDateOfBirth}
                onChange={(e) => update("collectDateOfBirth", e.target.checked)}
              />
              Collect applicant date of birth
            </label>
          </div>
          {form.collectDateOfBirth && (
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={form.requireDateOfBirth}
                  onChange={(e) => update("requireDateOfBirth", e.target.checked)}
                />
                Require it to submit an application
              </label>
            </div>
          )}
          <p style={{ color: "#888", fontSize: "0.85rem" }}>
            A real field on the application form, not a custom question -- supports minor/parent-guardian
            info, which needs a real date to check against a trip's own start date. A specific trip with
            "Collect parent/guardian info" turned on (its own per-trip setting, on that trip's own detail page
            -- not here, since not every trip at the same church has minors) always collects and requires
            this, regardless of these two church-wide defaults.
          </p>

          <h3 style={{ marginTop: "1.5rem" }}>Applicant mailing address</h3>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={form.collectApplicantAddress}
                onChange={(e) => update("collectApplicantAddress", e.target.checked)}
              />
              Collect applicant mailing address
            </label>
          </div>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>
            Shown as a real structured address block on the public application form — street, city, state,
            postal code, country. Turned off, the block doesn't appear on the form at all.
          </p>

          <h3 style={{ marginTop: "1.5rem" }}>Applicant emergency contact</h3>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={form.collectEmergencyContact}
                onChange={(e) => update("collectEmergencyContact", e.target.checked)}
              />
              Collect applicant emergency contact info
            </label>
          </div>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>
            Shown as a real structured name/phone/email block on the public application form. Turned off, the
            block doesn't appear on the form at all.
          </p>

          <h3 style={{ marginTop: "1.5rem" }}>Saved questions</h3>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>
            A reusable library, <strong>not itself shown to anyone, ever</strong> — pick from it when adding a
            question above or on any trip's own page, instead of retyping a commonly-used one. Unlike
            "Application template" above, nothing here is live on any form until you explicitly add it
            somewhere.
          </p>
          <ApplicationQuestionsEditor
            questions={form.tripQuestionLibrary || []}
            onAdd={(input) =>
              update("tripQuestionLibrary", [
                ...(form.tripQuestionLibrary || []),
                { id: crypto.randomUUID(), ...input },
              ])
            }
            onUpdate={(qId, patch) =>
              update(
                "tripQuestionLibrary",
                (form.tripQuestionLibrary || []).map((q) => (q.id === qId ? { ...q, ...patch } : q))
              )
            }
            onRemove={(qId) =>
              update(
                "tripQuestionLibrary",
                (form.tripQuestionLibrary || []).filter((q) => q.id !== qId)
              )
            }
            onReorder={(reordered) => update("tripQuestionLibrary", reordered)}
          />
        </div>

        <div className="admin-section-group" style={{ marginTop: "2rem" }}>
          <h2 className="admin-group-heading">Trip requirements</h2>
          <p style={{ color: "#888", fontSize: "0.85rem", margin: "-0.5rem 0 0" }}>
            What's needed <strong>after</strong> someone is accepted onto the team — a different phase from
            the application form above.
          </p>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>
            Automatically added to every newly-created, actively-recruiting trip — no manual re-adding needed
            per trip. Editing this later only affects trips created afterward; it never changes an
            already-created trip's own copy.
          </p>
          <RequirementTemplateEditor
            items={form.tripRequirementTemplate || []}
            onChange={(items) => update("tripRequirementTemplate", items)}
          />

          <h3 style={{ marginTop: "1.5rem" }}>Saved requirements</h3>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>
            A reusable library, <strong>not added to any trip automatically</strong> -- pick from it on a
            specific trip's own Requirements section when that trip actually needs it (e.g. a minor travel
            release form, only for a trip that actually has minors on it). Unlike "Trip requirements" above,
            nothing here is ever added anywhere until an admin explicitly picks it on a specific trip.
          </p>
          <RequirementTemplateEditor
            items={form.tripRequirementLibrary || []}
            onChange={(items) => update("tripRequirementLibrary", items)}
          />
        </div>

        <div className="admin-section-group" style={{ marginTop: "2rem" }}>
          <h2 className="admin-group-heading">Access &amp; links</h2>

          <h3>Private links</h3>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={form.allowPrivateApplicationLinks}
                onChange={(e) => update("allowPrivateApplicationLinks", e.target.checked)}
              />
              Allow staff to generate private application links
            </label>
          </div>
          <div className="admin-checkbox-row" style={{ marginTop: "0.6rem" }}>
            <label>
              <input
                type="checkbox"
                checked={form.allowPublicSupportRaisingLinks}
                onChange={(e) => update("allowPublicSupportRaisingLinks", e.target.checked)}
              />
              Allow participants to have public support-raising pages
            </label>
          </div>
        </div>

        <div className="form-save-bar">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          {success && <span style={{ color: "#1f6b4f" }}>{success}</span>}
          {error && (
            <span style={{ color: "#b91c1c" }} role="alert">
              {error}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
