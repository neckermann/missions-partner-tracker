import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { browserSupportsWebAuthn, completeSetup, fetchSetupStatus, registerPasskey } from "../api/client.js";
import EnrolSecondFactor from "../components/EnrolSecondFactor.jsx";
import SignInChoice from "../components/SignInChoice.jsx";
import { passwordsMatch } from "../utils/password.js";
import { passkeyErrorMessage } from "../utils/passkeyError.js";

// First-run account creation: only succeeds before the first admin exists; after that
// GET /auth/setup-status reports needed: false and this page redirects to /login.
//
// The first administrator chooses how they will sign in, like anyone with a new account (see SetPassword): a passkey
// on this device, or a password and an authenticator app. Setup hands back an enrolment token, and adding the second
// factor opens the session, so they land in the admin area with no separate sign-in step.
const muted = { color: "var(--muted)" };
const column = { display: "flex", flexDirection: "column", gap: "0.75rem" };

export default function Setup() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState({});
  // choose | passkey | password | app
  const [step, setStep] = useState("choose");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [choice, setChoice] = useState("device");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupToken, setSetupToken] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSetupStatus()
      .then((result) => {
        if (!result.needed) {
          navigate("/login", { replace: true });
        } else {
          setStatus(result);
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [navigate]);

  const browserCanPasskey = browserSupportsWebAuthn();
  const passkeyPossible = Boolean(status.passkeySignIn) && browserCanPasskey;

  function goOn() {
    navigate("/admin", { replace: true });
  }

  function handleChoose(e) {
    e.preventDefault();
    setError("");
    setStep(passkeyPossible && choice === "device" ? "passkey" : "password");
  }

  async function createPasskey() {
    setError("");
    setSaving(true);
    try {
      // The account is created the first time; a cancelled prompt keeps the enrolment token so trying again works.
      let token = setupToken;
      if (!token) {
        token = (await completeSetup(email, undefined, "passkey", { firstName, lastName })).setupToken;
        setSetupToken(token);
      }
      await registerPasskey("", token);
      goOn();
    } catch (err) {
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
    if (!passwordsMatch(password, confirmPassword)) {
      setError("Passwords don't match");
      return;
    }
    setSaving(true);
    try {
      const result = await completeSetup(email, password, "password", { firstName, lastName });
      setSetupToken(result.setupToken);
      setStep("app");
    } catch (err) {
      setError(err.response?.data?.error || "Setup failed");
    } finally {
      setSaving(false);
    }
  }

  if (checking) return null;

  if (step === "app") {
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

  return (
    <div className="admin-shell" style={{ maxWidth: 480 }}>
      {step === "choose" && (
        <>
          <h2>Welcome</h2>
          <p style={muted}>
            This is a fresh site with no administrator yet. Create the first one. Two-factor sign-in is
            required for everyone on a new site, so next you'll choose how you will sign in. After that you
            can invite others, and set up your church's name and colors.
          </p>
          <p style={muted}>
            Once you are in, we'll suggest adding a second administrator too, so a lost phone is never the end
            of the road.
          </p>
          <form onSubmit={handleChoose} style={column}>
            <label>
              Your first name
              <input
                type="text"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={100}
                autoFocus
              />
            </label>
            <label>
              Your last name
              <input
                type="text"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={100}
              />
            </label>
            <p style={{ ...muted, margin: "-0.25rem 0 0", fontSize: "0.85rem" }}>
              Shown beside the changes you make, so your team can see who did what. You can leave it blank and
              add it later in My Account.
            </p>
            <label>
              Your email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <SignInChoice
              choice={choice}
              setChoice={setChoice}
              passkeyPossible={passkeyPossible}
              passwordPossible
              passkeyOnByServer={Boolean(status.passkeySignIn)}
              browserCanPasskey={browserCanPasskey}
            />
            <button type="submit" className="btn">
              Continue
            </button>
          </form>
        </>
      )}

      {step === "passkey" && (
        <>
          <h2>Create your passkey</h2>
          <p style={muted}>Your device will ask for your fingerprint, face or screen lock. That is all.</p>
          <p style={muted}>
            Good to know: a passkey has no recovery codes. If you lose this device, a second administrator can
            reset your sign-in, or on a server you run, the recovery steps in the guide will. That is why
            we'll suggest adding a second administrator next.
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
            {!setupToken && (
              <button type="button" className="btn secondary" onClick={() => setStep("choose")}>
                Back
              </button>
            )}
          </div>
        </>
      )}

      {step === "password" && (
        <>
          <h2>Choose a password</h2>
          <p style={muted}>
            At least 8 characters. A few random words makes a strong one that is easy to remember. Next you'll
            add an authenticator app.
          </p>
          <form onSubmit={handlePassword} style={column}>
            <label>
              Password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                autoFocus
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Creating account…" : "Continue"}
            </button>
            <button type="button" className="btn secondary" onClick={() => setStep("choose")}>
              Back
            </button>
          </form>
        </>
      )}
    </div>
  );
}
