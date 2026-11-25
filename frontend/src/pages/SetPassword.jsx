import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { validatePasswordSetup, completePasswordSetup, requestPasswordSetupLink } from "../api/client.js";

// Landing page for the "Choose your password" button in the welcome email.
// The token in the URL is the only credential; every failure shows the same
// generic message and offers a fresh link by email (the server answers that
// request identically whether or not an account exists). While this site can't send email it
// says so and points to an administrator instead of promising a link that won't come.
const GENERIC_REQUEST_MESSAGE =
  "If that email has an account waiting to be set up, a new link is on its way.";

export default function SetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState("loading"); // loading | form | invalid | done
  const [info, setInfo] = useState(null); // { email, firstName, mfaRequired }
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState({ mfaRequired: false });
  const [requestEmail, setRequestEmail] = useState("");
  // What the server said about the new-link request (null until asked): the generic "on its
  // way" while email works, or "ask your administrator" while this site can't send email.
  const [requestMessage, setRequestMessage] = useState(null);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    validatePasswordSetup(token)
      .then((data) => {
        setInfo(data);
        setState("form");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setSaving(true);
    try {
      const result = await completePasswordSetup(token, password);
      setDone({ mfaRequired: !!result.mfaRequired });
      setState("done");
    } catch (err) {
      if (err.response?.status === 400 && /invalid or has expired/i.test(err.response?.data?.error || "")) {
        setState("invalid");
      } else {
        setError(err.response?.data?.error || "Something went wrong. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRequest(e) {
    e.preventDefault();
    let message = GENERIC_REQUEST_MESSAGE;
    try {
      const result = await requestPasswordSetupLink(requestEmail);
      if (result?.message) message = result.message;
    } catch {
      // The server answers the same way for every address; show the generic message on a failure.
    }
    setRequestMessage(message);
  }

  return (
    <div className="admin-shell" style={{ maxWidth: 420 }}>
      {state === "loading" && <p>Checking your link…</p>}

      {state === "form" && (
        <>
          <h2>{info?.firstName ? `Welcome, ${info.firstName}` : "Welcome"}</h2>
          <p style={{ color: "var(--muted)" }}>
            Choose a password for <strong>{info?.email}</strong>. Use at least 8 characters -- a few random
            words makes a strong, easy-to-remember password.
          </p>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                maxLength={128}
                required
                autoFocus
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                maxLength={128}
                required
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving…" : "Set password"}
            </button>
          </form>
        </>
      )}

      {state === "done" && (
        <>
          <h2>Password set</h2>
          <p style={{ color: "var(--muted)" }}>
            You're all set.
            {done.mfaRequired
              ? " Next, sign in -- you'll be guided through setting up two-factor authentication with an authenticator app on your phone."
              : " You can sign in now."}
          </p>
          <Link className="btn" to="/login">
            Go to sign in
          </Link>
        </>
      )}

      {state === "invalid" && (
        <>
          <h2>This link has expired</h2>
          <p style={{ color: "var(--muted)" }}>
            This link is invalid or has expired. Enter your email and we'll send you a new one.
          </p>
          {requestMessage ? (
            <p role="status">{requestMessage}</p>
          ) : (
            <form
              onSubmit={handleRequest}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <label>
                Email
                <input
                  type="email"
                  value={requestEmail}
                  onChange={(e) => setRequestEmail(e.target.value)}
                  required
                />
              </label>
              <button type="submit" className="btn">
                Email me a new link
              </button>
            </form>
          )}
          <p style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
            Already set your password? <Link to="/login">Sign in</Link>
          </p>
        </>
      )}
    </div>
  );
}
