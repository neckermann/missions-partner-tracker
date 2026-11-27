import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  browserSupportsWebAuthn,
  completePasswordSetup,
  registerPasskey,
  requestPasswordSetupLink,
  startPasskeyLinkSetup,
  validatePasswordSetup,
} from "../api/client.js";
import EnrolSecondFactor from "../components/EnrolSecondFactor.jsx";
import SignInChoice from "../components/SignInChoice.jsx";
import { passkeyErrorMessage } from "../utils/passkeyError.js";

// The page a setup or reset link opens. The link proves the inbox; the person then chooses how they will sign in
// and is signed in at the end, with no separate sign-in step:
//   * "mostly this device": a passkey (fingerprint, face or screen lock), which is both proofs at once;
//   * "different or shared computers": a password, then an authenticator app and recovery codes.
// An account that already has two-factor only has its password changed here (a link alone never replaces a second
// factor) and then signs in the normal way. Every failure shows the same generic message and offers a fresh link by
// email (the server answers that request identically whether or not an account exists); while the site can't send
// email it says so and points to an administrator.
const GENERIC_REQUEST_MESSAGE =
  "If that email has an account, a new link to set up your sign-in is on its way.";

const muted = { color: "var(--muted)" };
const column = { display: "flex", flexDirection: "column", gap: "0.75rem" };

export default function SetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";
  // loading | invalid | choose | passkey | password | app | done
  const [state, setState] = useState("loading");
  const [info, setInfo] = useState(null);
  const [choice, setChoice] = useState("device"); // "device" | "shared"
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [setupToken, setSetupToken] = useState(null);
  const [requestEmail, setRequestEmail] = useState("");
  const [requestMessage, setRequestMessage] = useState(null);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    validatePasswordSetup(token)
      .then((data) => {
        setInfo(data);
        // Someone who already has two-factor only changes the password; nobody else gets a choice to make
        // unless both ways are on offer.
        setState("choose");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  const passkeyPossible =
    Boolean(info?.passkeyAllowed) && !info?.hasSecondFactor && browserSupportsWebAuthn();
  const passwordPossible = info ? info.passwordAllowed !== false : true;

  function linkExpired(err) {
    return err.response?.status === 400 && /invalid or has expired/i.test(err.response?.data?.error || "");
  }

  function goOn() {
    navigate("/admin");
  }

  function continueFromChoice() {
    setError("");
    // With only one way on offer there was nothing to choose, so the radio buttons weren't shown.
    const wantsPasskey = passkeyPossible && (!passwordPossible || choice === "device");
    setState(wantsPasskey ? "passkey" : "password");
  }

  async function createPasskey() {
    setError("");
    setSaving(true);
    try {
      // The link is spent the first time; a cancelled prompt keeps the enrolment token, so trying again works.
      let tokenForPasskey = setupToken;
      if (!tokenForPasskey) {
        const started = await startPasskeyLinkSetup(token);
        tokenForPasskey = started.setupToken;
        setSetupToken(tokenForPasskey);
      }
      await registerPasskey("", tokenForPasskey);
      goOn();
    } catch (err) {
      if (linkExpired(err)) setState("invalid");
      else
        setError(
          err.response?.data?.error ||
            `${passkeyErrorMessage(err, "Couldn't create a passkey")} You can try again, or go back and use a password and an app.`
        );
    } finally {
      setSaving(false);
    }
  }

  async function handlePassword(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setSaving(true);
    try {
      const result = await completePasswordSetup(token, password);
      if (result.setupToken) {
        setSetupToken(result.setupToken);
        setState("app");
      } else {
        // An account that already has two-factor (or a demo): no session from a link alone.
        setState("done");
      }
    } catch (err) {
      if (linkExpired(err)) setState("invalid");
      else setError(err.response?.data?.error || "Something went wrong. Please try again.");
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

  if (state === "app") {
    return (
      <EnrolSecondFactor
        setupToken={setupToken}
        heading="Add your authenticator app"
        intro="Open an authenticator app on your phone, scan this, then type the 6-digit code it shows."
        allowPasskey={false}
        onDone={goOn}
        doneLabel="Continue to the site"
      />
    );
  }

  const title = info?.reset
    ? "Choose a new password"
    : info?.firstName
      ? `Welcome, ${info.firstName}`
      : "Welcome";

  return (
    <div className="admin-shell" style={{ maxWidth: 480 }}>
      {state === "loading" && <p>Checking your link…</p>}

      {state === "choose" && info?.hasSecondFactor && (
        <>
          <h2>{title}</h2>
          <p style={muted}>
            Choose a new password for <strong>{info.email}</strong>. Use at least 8 characters. A few random
            words makes a strong, easy-to-remember password. This account already has two-factor sign-in, so
            you will be asked for it when you sign in.
          </p>
          <PasswordForm
            password={password}
            confirm={confirm}
            setPassword={setPassword}
            setConfirm={setConfirm}
            error={error}
            saving={saving}
            onSubmit={handlePassword}
            submitLabel="Set password"
          />
        </>
      )}

      {state === "choose" && !info?.hasSecondFactor && (
        <>
          <h2>{title}</h2>
          <p style={muted}>
            This is <strong>{info?.email}</strong>. Let's set up how you will sign in.
          </p>

          <SignInChoice
            choice={choice}
            setChoice={setChoice}
            passkeyPossible={passkeyPossible}
            passwordPossible={passwordPossible}
            passkeyOnByServer={Boolean(info?.passkeyAllowed)}
            browserCanPasskey={browserSupportsWebAuthn()}
          />
          <button type="button" className="btn" onClick={continueFromChoice}>
            Continue
          </button>
        </>
      )}

      {state === "passkey" && (
        <>
          <h2>Create your passkey</h2>
          <p style={muted}>Your device will ask for your fingerprint, face or screen lock. That is all.</p>
          <p style={muted}>
            Good to know: a passkey has no recovery codes. If you lose this device, ask an administrator to
            reset your sign-in, or use "Email me a new link" on the sign-in page if your church has email set
            up.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div style={column}>
            <button type="button" className="btn" onClick={createPasskey} disabled={saving}>
              {saving ? "Waiting for your device…" : "Create a passkey on this device"}
            </button>
            {passwordPossible && !setupToken && (
              <button type="button" className="btn secondary" onClick={() => setState("choose")}>
                Back
              </button>
            )}
          </div>
        </>
      )}

      {state === "password" && (
        <>
          <h2>Choose a password</h2>
          <p style={muted}>
            At least 8 characters. A few random words makes a strong one that is easy to remember. Next you'll
            add an authenticator app.
          </p>
          <PasswordForm
            password={password}
            confirm={confirm}
            setPassword={setPassword}
            setConfirm={setConfirm}
            error={error}
            saving={saving}
            onSubmit={handlePassword}
            submitLabel="Continue"
          />
          {!info?.hasSecondFactor && passkeyPossible && (
            <button
              type="button"
              className="btn secondary"
              style={{ marginTop: "0.75rem" }}
              onClick={() => setState("choose")}
            >
              Back
            </button>
          )}
        </>
      )}

      {state === "done" && (
        <>
          <h2>{info?.reset ? "Password changed" : "Password set"}</h2>
          <p style={muted}>
            {info?.reset
              ? "Your password is changed, and other devices have been signed out."
              : "You're all set."}{" "}
            Sign in with your new password.
          </p>
          <Link className="btn" to="/login">
            Go to sign in
          </Link>
        </>
      )}

      {state === "invalid" && (
        <>
          <h2>This link has expired</h2>
          <p style={muted}>
            Links work once, for a limited time. Enter your email and we'll send you a new one.
          </p>
          {requestMessage ? (
            <p role="status">{requestMessage}</p>
          ) : (
            <form onSubmit={handleRequest} style={column}>
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
            Already set up? <Link to="/login">Sign in</Link>
          </p>
        </>
      )}
    </div>
  );
}

function PasswordForm({ password, confirm, setPassword, setConfirm, error, saving, onSubmit, submitLabel }) {
  return (
    <form onSubmit={onSubmit} style={column}>
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
        {saving ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
