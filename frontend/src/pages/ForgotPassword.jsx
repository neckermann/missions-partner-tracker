import React, { useState } from "react";
import { Link } from "react-router-dom";
import { requestPasswordSetupLink } from "../api/client.js";

// "Forgot your password?": asks for the account's email and says a link is on its way. The server
// answers the same way for every address, so this page can't be used to find out who has an
// account; while the site can't send email it says to ask an administrator instead.
const GENERIC_MESSAGE = "If that email has an account, a new link to set up your sign-in is on its way.";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSending(true);
    let reply = GENERIC_MESSAGE;
    try {
      const result = await requestPasswordSetupLink(email);
      if (result?.message) reply = result.message;
    } catch {
      // The server answers the same way for every address; show the generic message on a failure.
    }
    setMessage(reply);
    setSending(false);
  }

  return (
    <div className="admin-shell" style={{ maxWidth: 420 }}>
      <h2>Get a new sign-in link</h2>
      {message ? (
        <>
          <p role="status">{message}</p>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            The link works once and expires in an hour. Check your spam folder if it doesn't arrive in a few
            minutes.
          </p>
        </>
      ) : (
        <>
          <p style={{ color: "var(--muted)" }}>
            Enter the email address you sign in with and we'll email you a link to choose a new password.
          </p>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </label>
            <button type="submit" className="btn" disabled={sending}>
              {sending ? "Sending…" : "Email me a link"}
            </button>
          </form>
        </>
      )}
      <p style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
        <Link to="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
