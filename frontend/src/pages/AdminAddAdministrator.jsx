import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createUser } from "../api/client.js";
import CopyButton from "../components/shared/CopyButton.jsx";
import { markAddAdministratorAsked } from "../hooks/usePublicSiteChoiceRedirect.js";

// Shown once, right after the first administrator signs in on a new site: add a second administrator, so a lost
// phone or device is never the end of the road. Always skippable ("Not now"); the Home page keeps a "You are the
// only administrator" reminder until a second one exists.
export default function AdminAddAdministrator() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(null); // { email, sent, manualSetupUrl, emailError }

  function finish() {
    markAddAdministratorAsked();
    navigate("/admin", { replace: true });
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const result = await createUser({ email, firstName, role: "admin", sendWelcomeEmail: true });
      setAdded({
        email,
        sent: Boolean(result.welcomeEmail?.sent),
        manualSetupUrl: result.welcomeEmail?.manualSetupUrl || null,
        emailError: result.welcomeEmail?.error || null,
      });
      markAddAdministratorAsked();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't add that person. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (added) {
    return (
      <div className="admin-shell" style={{ maxWidth: "36rem" }}>
        <h2>Administrator added</h2>
        {added.sent ? (
          <p>
            We emailed <strong>{added.email}</strong> a link to set up their sign-in.
          </p>
        ) : (
          <>
            {added.emailError ? (
              <p>The account was created, but the email couldn't be sent ({added.emailError}).</p>
            ) : (
              <p>This site can't send email yet, so give {added.email} this link yourself.</p>
            )}
            {added.manualSetupUrl && (
              <p style={{ overflowWrap: "anywhere" }}>
                <code>{added.manualSetupUrl}</code>{" "}
                <CopyButton text={added.manualSetupUrl} label="Copy the link" />
              </p>
            )}
            <p style={{ color: "var(--muted)" }}>
              The link works once and expires. You can make a new one any time under{" "}
              <Link to="/admin/settings/users">Settings → Manage Users</Link>.
            </p>
          </>
        )}
        <button type="button" className="btn" onClick={finish}>
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="admin-shell" style={{ maxWidth: "36rem" }}>
      <h2>Add a second administrator</h2>
      <p>
        If you ever lose your phone or the device you signed in with, a second administrator can reset your
        sign-in in a minute. With only one, getting back in takes a command on the server.
      </p>
      <p style={{ color: "var(--muted)" }}>
        Pick someone you trust. They get a link to set up their own sign-in, and you never see their password.
        You can do this any time under <Link to="/admin/settings/users">Settings → Manage Users</Link>.
      </p>
      <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label>
          First name
          <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Adding…" : "Add administrator"}
          </button>
          <button type="button" className="btn secondary" onClick={finish}>
            Not now
          </button>
        </div>
      </form>
    </div>
  );
}
