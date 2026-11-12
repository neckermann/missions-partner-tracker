import React, { useEffect, useState } from "react";
import { fetchTripsSettings, updateTripsSettings } from "../api/client.js";
import ApplicationQuestionsEditor from "../components/admin/ApplicationQuestionsEditor.jsx";

// New (#252) -- church-wide settings for the whole Trips feature area:
// donation instructions (§13), donor-contact opt-in (§6), and the two
// private-link gates (§4/§6). Not per-trip (so it doesn't belong on
// AdminTripDetail.jsx) and not general church info (so it doesn't
// belong on the About Church page either).
const emptyForm = {
  onlineGivingUrl: "",
  onlineGivingInstructions: "",
  collectDonorContactInfo: false,
  allowPrivateApplicationLinks: false,
  allowPublicSupportRaisingLinks: false,
  tripApplicationTemplate: [],
  tripQuestionLibrary: [],
};

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
    <div className="admin-shell">
      <h2>Trips Settings</h2>
      <form onSubmit={handleSubmit} className="admin-section">
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
          Never shown on the public support-raising page regardless of this setting — only on the participant's
          own self-service page and to admins.
        </p>

        <h3 style={{ marginTop: "1.5rem" }}>Private links</h3>
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
        <div className="admin-checkbox-row">
          <label>
            <input
              type="checkbox"
              checked={form.allowPublicSupportRaisingLinks}
              onChange={(e) => update("allowPublicSupportRaisingLinks", e.target.checked)}
            />
            Allow participants to have public support-raising pages
          </label>
        </div>

        <h3 style={{ marginTop: "1.5rem" }}>Application template</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          Asked on every trip's application form, before that trip's own questions. Edit here instead of re-typing
          the same question on every trip.
        </p>
        <ApplicationQuestionsEditor
          questions={form.tripApplicationTemplate || []}
          library={form.tripQuestionLibrary || []}
          onAdd={(input) => update("tripApplicationTemplate", [...(form.tripApplicationTemplate || []), { id: crypto.randomUUID(), ...input }])}
          onUpdate={(qId, patch) =>
            update(
              "tripApplicationTemplate",
              (form.tripApplicationTemplate || []).map((q) => (q.id === qId ? { ...q, ...patch } : q))
            )
          }
          onRemove={(qId) => update("tripApplicationTemplate", (form.tripApplicationTemplate || []).filter((q) => q.id !== qId))}
          onAddFromLibrary={(entry) => update("tripApplicationTemplate", [...(form.tripApplicationTemplate || []), { ...entry, id: crypto.randomUUID() }])}
        />

        <h3 style={{ marginTop: "1.5rem" }}>Saved questions</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          A reusable library, not shown to anyone directly -- pick from it when adding a question here or on any
          trip's own page, instead of retyping a commonly-used one.
        </p>
        <ApplicationQuestionsEditor
          questions={form.tripQuestionLibrary || []}
          onAdd={(input) => update("tripQuestionLibrary", [...(form.tripQuestionLibrary || []), { id: crypto.randomUUID(), ...input }])}
          onUpdate={(qId, patch) =>
            update(
              "tripQuestionLibrary",
              (form.tripQuestionLibrary || []).map((q) => (q.id === qId ? { ...q, ...patch } : q))
            )
          }
          onRemove={(qId) => update("tripQuestionLibrary", (form.tripQuestionLibrary || []).filter((q) => q.id !== qId))}
        />

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
