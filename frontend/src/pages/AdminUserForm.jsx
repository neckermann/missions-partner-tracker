import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createUser, fetchTrips } from "../api/client.js";
import Wizard from "../components/shared/Wizard.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import TripGrantPicker from "../components/admin/TripGrantPicker.jsx";
import ManualSendNotice from "../components/shared/ManualSendNotice.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";

const initialValues = {
  email: "",
  firstName: "",
  lastName: "",
  role: "editor",
  authProvider: "local",
  password: "",
  sendWelcomeEmail: true,
  requireMfa: false,
  // Guests only: [{ tripId, expiresAt }] -- see TripGrantPicker.
  tripAccess: [],
};

// Create only -- a dedicated page, same shape as AdminPartnerForm.jsx's
// "New Partner" (its own field-count survey comment explains why that one
// earned the Wizard shell; the welcome-email/password/MFA options added in
// #285/#286 put Add User past that same bar). A popup-modal version of
// this previously shipped and was corrected in review: the Wizard shell is
// meant to read as its own page -- breadcrumb, page title, Cancel/Next
// pinned to the viewport bottom -- not a dialog floating over the list,
// which is what every other "+Add X" quick-action already looks like and
// this is deliberately not. Edit stays on AdminUsers.jsx's own list page
// (a plain QuickActionModal) -- it never had the welcome-email step, and
// resetting a password or changing a role is a single-topic action.
export default function AdminUserForm() {
  const navigate = useNavigate();
  // The trip page's "Invite a new guest" link lands here with ?tripId= so
  // the wizard opens as a guest already given that trip (#356).
  const [searchParams] = useSearchParams();
  const presetTripId = searchParams.get("tripId");
  const startingValues = presetTripId
    ? { ...initialValues, role: "guest", tripAccess: [{ tripId: presetTripId, expiresAt: null }] }
    : initialValues;
  const [trips, setTrips] = useState([]);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  // Set only when the account just created needs a manual setup link
  // (outbound email is off) -- shown in place of the wizard, not after
  // navigating away, so the link is never on a screen nobody's looking at.
  const [manualLink, setManualLink] = useState(null); // { email, url } | null

  useEffect(() => {
    fetchTrips().then(setTrips).catch(console.error);
  }, []);

  function backToList(notice) {
    navigate("/admin/settings/users", notice ? { state: { notice } } : undefined);
  }

  async function handleFinish(values) {
    setSaving(true);
    setSubmitError("");
    try {
      const payload = { ...values };
      // Only a guest takes trip access; MFA is always required for one, so
      // the server ignores requireMfa for that role either way.
      if (values.role !== "guest") delete payload.tripAccess;
      if (!payload.password) delete payload.password;

      const created = await createUser(payload);
      if (created.welcomeEmail?.manualSetupUrl) {
        setManualLink({ email: created.email, url: created.welcomeEmail.manualSetupUrl });
        setSaving(false);
        return;
      }
      if (created.welcomeEmail && !created.welcomeEmail.sent && !created.welcomeEmail.skipped) {
        backToList(
          `${created.email} was created, but the welcome email couldn't be sent (${created.welcomeEmail.error}). Use "Send setup link" on their row to try again.`
        );
        return;
      }
      backToList();
    } catch (err) {
      setSubmitError(mapServerErrorMessage(err?.response?.data?.error) || "Failed to create user");
      setSaving(false);
    }
  }

  const steps = [
    {
      key: "basics",
      label: "Basics",
      validate: (values) => {
        if (!values.email.trim()) return "Email is required.";
        if (values.role === "guest" && values.tripAccess.length === 0) {
          return "Choose at least one trip for this guest.";
        }
        return null;
      },
      render: ({ values, setValue }) => (
        <>
          <div className="form-grid">
            <label>
              Email
              <input
                type="email"
                value={values.email}
                onChange={(e) => setValue("email", e.target.value)}
                required
              />
            </label>
            <label>
              First Name
              <input value={values.firstName} onChange={(e) => setValue("firstName", e.target.value)} />
            </label>
            <label>
              Last Name
              <input value={values.lastName} onChange={(e) => setValue("lastName", e.target.value)} />
            </label>
            <label>
              Role
              <select value={values.role} onChange={(e) => setValue("role", e.target.value)}>
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
                <option value="guest">Guest (only the trips you choose)</option>
              </select>
            </label>
          </div>

          {values.role === "guest" && (
            <div style={{ marginTop: "1rem" }}>
              <TripGrantPicker
                trips={trips}
                value={values.tripAccess}
                onChange={(next) => setValue("tripAccess", next)}
              />
              <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.5rem" }}>
                A guest can work on the trips you choose and see those trips' partners, nothing else in the
                app. They sign in with a password and two-factor authentication.
              </p>
            </div>
          )}
        </>
      ),
    },
    {
      key: "access",
      label: "Account Setup",
      validate: (values) => {
        if (!values.sendWelcomeEmail && values.password && values.password.length < 8) {
          return "Password must be at least 8 characters.";
        }
        return null;
      },
      render: ({ values, setValue }) => (
        <>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={values.sendWelcomeEmail}
                onChange={(e) => setValue("sendWelcomeEmail", e.target.checked)}
              />
              Send a welcome email so they can set their own password (recommended)
            </label>
            <label>
              <input
                type="checkbox"
                checked={values.role === "guest" || values.requireMfa}
                disabled={values.role === "guest"}
                onChange={(e) => setValue("requireMfa", e.target.checked)}
              />
              Require two-factor authentication at first sign-in
              {values.role === "guest" && " (always required for guests)"}
            </label>
          </div>
          <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.5rem" }}>
            {values.sendWelcomeEmail
              ? "They'll get a one-time link to choose their own password. Nobody else ever sees it."
              : 'No email is sent. Set a password below, or leave it blank and use "Send setup link" on their row later. Until a password is set they can\'t sign in.'}
          </p>
          {!values.sendWelcomeEmail && (
            <label style={{ marginTop: "1rem" }}>
              Password (optional)
              <input
                type="password"
                value={values.password}
                onChange={(e) => setValue("password", e.target.value)}
                minLength={8}
              />
            </label>
          )}
        </>
      ),
    },
  ];

  return (
    <div className="admin-shell">
      <Breadcrumb
        items={[
          { label: "Settings", to: "/admin/settings" },
          { label: "Manage Users", to: "/admin/settings/users" },
          { label: "Add User" },
        ]}
      />
      <h2>Add User</h2>
      <p style={{ color: "#666", marginTop: "-0.5rem" }}>
        Just enough to create the account — they can fill in the rest later.
      </p>

      <div className="admin-section">
        {manualLink ? (
          <>
            <p>
              {manualLink.email} was created. Outbound email is off, so share this setup link with them
              directly instead:
            </p>
            <ManualSendNotice recipients={manualLink} />
            <div style={{ marginTop: "1rem" }}>
              <button type="button" className="btn" onClick={() => backToList()}>
                Done
              </button>
            </div>
          </>
        ) : (
          <Wizard
            steps={steps}
            initialValues={startingValues}
            onFinish={handleFinish}
            onCancel={() => backToList()}
            finishing={saving}
          />
        )}
        {submitError && (
          <p style={{ color: "#b91c1c" }} role="alert">
            {submitError}
          </p>
        )}
      </div>
    </div>
  );
}
