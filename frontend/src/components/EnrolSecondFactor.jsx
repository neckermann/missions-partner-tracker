import React, { useEffect, useState } from "react";
import {
  browserSupportsWebAuthn,
  confirmForcedMfaSetup,
  registerPasskey,
  startForcedMfaSetup,
} from "../api/client.js";
import MfaAppGuide from "./MfaAppGuide.jsx";
import CopyButton from "./shared/CopyButton.jsx";
import RecoveryCodesPanel from "./RecoveryCodesPanel.jsx";
import { passkeyErrorMessage } from "../utils/passkeyError.js";

// Adds a second sign-in step for someone who has no session yet and only an enrolment token (from a forced
// enrolment at sign-in, or the new-account page). An authenticator app: scan, confirm a code, then the recovery
// codes, which are held on screen until saved. Optionally a passkey instead. Either way finishing opens the
// session, and `onDone` says where to go next.
export default function EnrolSecondFactor({
  setupToken,
  heading = "Two-Factor Setup Required",
  intro,
  allowPasskey = true,
  onDone,
  doneLabel = "Continue to the site",
}) {
  const [setupData, setSetupData] = useState(null); // { secret, qrCode }
  const [mfaCode, setMfaCode] = useState("");
  const [newCodes, setNewCodes] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    startForcedMfaSetup(setupToken)
      .then((data) => live && setSetupData(data))
      .catch(() => live && setError("Couldn't start the authenticator setup. Reload and try again."));
    return () => {
      live = false;
    };
  }, [setupToken]);

  async function handlePasskey() {
    setError("");
    try {
      await registerPasskey("", setupToken);
      onDone();
    } catch (err) {
      setError(`${passkeyErrorMessage(err, "Couldn't add a passkey")} Or use an authenticator app instead.`);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setError("");
    try {
      const result = await confirmForcedMfaSetup(setupToken, mfaCode);
      // The session is already open; hold on this screen until the person has saved their codes.
      if (result?.recoveryCodes?.length) setNewCodes(result.recoveryCodes);
      else onDone();
    } catch (err) {
      setError(err.response?.data?.error || "Invalid code");
    }
  }

  if (newCodes) {
    return (
      <div className="admin-shell" style={{ maxWidth: 480 }}>
        <RecoveryCodesPanel codes={newCodes} onDone={onDone} doneLabel={doneLabel} />
      </div>
    );
  }

  return (
    <div className="admin-shell" style={{ maxWidth: 480 }}>
      <h2>{heading}</h2>
      {intro && <p style={{ color: "var(--muted)" }}>{intro}</p>}
      {allowPasskey && browserSupportsWebAuthn() && (
        <div style={{ marginBottom: "1rem" }}>
          <p style={{ color: "var(--muted)" }}>
            The simplest way is a passkey: your fingerprint, face or screen lock on this device.
          </p>
          <button type="button" className="btn" onClick={handlePasskey}>
            Use a passkey
          </button>
          <p style={{ color: "var(--muted)", marginTop: "1rem" }}>Or use an authenticator app:</p>
        </div>
      )}
      <MfaAppGuide />
      {setupData && (
        <form onSubmit={handleConfirm} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <img src={setupData.qrCode} alt="MFA QR code" style={{ width: 200, height: 200 }} />
          <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            Can't scan it? Enter this code manually: <code>{setupData.secret}</code>{" "}
            <CopyButton text={setupData.secret} label="Copy the setup key" />
          </p>
          <label>
            Code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              autoFocus
              required
            />
          </label>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <button type="submit" className="btn">
            Confirm & Sign In
          </button>
        </form>
      )}
      {!setupData && error && <p style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
