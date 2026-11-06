import React, { useEffect, useState } from "react";
import { fetchChurchSettings, updateChurchSettings, syncAllSendingChurch } from "../api/client.js";
import AddressFields from "../components/admin/AddressFields.jsx";

const emptyAddress = {
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateProvinceRegion: "",
  postalCode: "",
  country: "",
};

const emptyForm = {
  churchName: "",
  phone: "",
  contactName: "",
  contactEmail: "",
  websiteLink: "",
  timezone: "UTC",
  address: { ...emptyAddress },
};

// A real built-in, no library needed -- returns every valid IANA zone
// name, so an admin can only ever pick a value that's actually valid.
// A typo'd free-text value (e.g. "America/New York" with a space, or a
// non-IANA abbreviation like "EST") would otherwise silently fall back
// to UTC server-side with no feedback to anyone -- see this field's own
// comment in schema.prisma.
const TIMEZONES = Intl.supportedValuesOf("timeZone");

// Settings is a singleton — GET returns { featureRegistry } with everything
// else absent before it's ever been saved (see routes/settings.js), so
// `s?.id` (not `!s`) is the actual "has this church configured anything
// yet" check — same pattern as the other Site Administration pages. Only
// pulls in the fields this page owns -- Branding/Features/Users are
// separate pages under the sidebar's Site Administration group (see
// AdminSidebar.jsx), each PUTting just its own slice, so saving here never
// touches the others' fields.
function mergeFetchedRecord(s) {
  if (!s?.id) return emptyForm;
  return {
    ...emptyForm,
    ...s,
    address: { ...emptyForm.address, ...(s.address || {}) },
  };
}

export default function AdminSettingsAbout() {
  const [form, setForm] = useState(emptyForm);
  const [sentByOurChurchCount, setSentByOurChurchCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchChurchSettings()
      .then((s) => {
        setForm(mergeFetchedRecord(s));
        setSentByOurChurchCount(s?.sentByOurChurchCount || 0);
      })
      .catch(() => setError("Couldn't load church settings."));
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSuccess("");
    setSyncSuccess("");
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess("");
    setSyncSuccess("");
    setError("");
    try {
      const updated = await updateChurchSettings(form);
      setForm(mergeFetchedRecord(updated));
      setSuccess("Saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save church settings.");
    } finally {
      setSaving(false);
    }
  }

  // Only offered right after a save, next to "Saved." -- the moment this
  // info just changed is exactly when it's worth asking "push that out to
  // everyone sent by us?", rather than a button sitting there permanently
  // regardless of whether anything's actually out of date.
  async function handleSyncAll() {
    setSyncing(true);
    setSyncSuccess("");
    setError("");
    try {
      const { updatedCount } = await syncAllSendingChurch();
      setSyncSuccess(`Updated ${updatedCount} partner${updatedCount === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't update partners with this info.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>About Church</h2>
      <p style={{ color: "#555" }}>
        Basic church info — used to auto-fill the Sending Church section when this church is the sender, and
        for contact details shown across the admin app.
      </p>

      <form onSubmit={handleSubmit} className="admin-form">
        <div className="admin-section">
          <h3>Church Info</h3>
          <div className="form-grid">
            <label>
              Church Name
              <input value={form.churchName || ""} onChange={(e) => update("churchName", e.target.value)} />
            </label>
            <label>
              Phone
              <input value={form.phone || ""} onChange={(e) => update("phone", e.target.value)} />
            </label>
            <label>
              Contact Name
              <input value={form.contactName || ""} onChange={(e) => update("contactName", e.target.value)} />
            </label>
            <label>
              Contact Email
              <input
                value={form.contactEmail || ""}
                onChange={(e) => update("contactEmail", e.target.value)}
              />
            </label>
            <label>
              Website
              <input value={form.websiteLink || ""} onChange={(e) => update("websiteLink", e.target.value)} />
            </label>
            <label>
              Timezone
              <select value={form.timezone || "UTC"} onChange={(e) => update("timezone", e.target.value)}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p style={{ color: "#666", fontSize: "0.85rem", marginTop: "-0.5rem" }}>
            Drives every scheduled send in this app (email digests, GroupMe) so "send at 9" actually means 9am
            here, not UTC. Changing this takes effect the next time the app restarts, not instantly.
          </p>
          <h4>Address</h4>
          <AddressFields value={form.address} onChange={(addr) => update("address", addr)} />
        </div>

        <div className="form-save-bar">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          {error && (
            <span style={{ color: "#b91c1c" }} role="alert">
              {error}
            </span>
          )}
          {success && <span style={{ color: "#2a5d3c" }}>{success}</span>}
          {success && sentByOurChurchCount > 0 && (
            <>
              <span style={{ color: "#555" }}>
                {sentByOurChurchCount} partner{sentByOurChurchCount === 1 ? "" : "s"} marked &ldquo;Sent by
                our church.&rdquo;
              </span>
              <button
                type="button"
                className="btn secondary small"
                onClick={handleSyncAll}
                disabled={syncing}
              >
                {syncing ? "Updating..." : "Update them all with this info"}
              </button>
            </>
          )}
          {syncSuccess && <span style={{ color: "#2a5d3c" }}>{syncSuccess}</span>}
        </div>
      </form>
    </div>
  );
}
