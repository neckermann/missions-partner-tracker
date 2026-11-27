import React from "react";

const muted = { color: "var(--muted)" };

// "Where will you mostly sign in?": the plain-words explanation of the two proofs, and the choice between a passkey
// on this device and a password with an authenticator app. Used by the new-account page and first-run setup. When
// only one way is possible (the browser can't make a passkey, or the church signs in with a passkey only) there is
// nothing to choose, so a sentence says what will happen instead of the radio buttons.
export default function SignInChoice({
  choice,
  setChoice,
  passkeyPossible,
  passwordPossible,
  passkeyOnByServer,
  browserCanPasskey,
}) {
  return (
    <>
      <details style={{ marginBottom: "1rem" }}>
        <summary>Why do we ask for two proofs?</summary>
        <p style={muted}>
          This site holds private details about missionaries, and some serve where being identified could put
          them at risk. A password alone can be guessed, reused from another site, or stolen. So we also ask
          for a second proof that only you have.
        </p>
        <p style={muted}>
          <strong>A passkey</strong> is that second proof built in. Your device checks it is you (fingerprint,
          face or screen lock) and tells the site. There is no password to steal, and a fake website can't
          trick it.
        </p>
        <p style={muted}>
          <strong>An authenticator app</strong> on your phone shows a 6-digit code that changes every 30
          seconds. Someone who has your password still can't get in without your phone.
        </p>
        <p style={muted}>
          <strong>Recovery codes</strong> are spare keys for the day you lose your phone. You'll be given a
          set to keep.
        </p>
      </details>

      {passkeyPossible && passwordPossible ? (
        <fieldset style={{ border: 0, padding: 0, margin: "0 0 1rem" }}>
          <legend style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Where will you mostly sign in?</legend>
          <label
            style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", marginBottom: "0.75rem" }}
          >
            <input
              type="radio"
              name="where"
              checked={choice === "device"}
              onChange={() => setChoice("device")}
            />
            <span>
              <strong>Mostly on this device</strong>
              <br />
              <span style={muted}>
                This is your own phone or computer. You will sign in with your fingerprint, face or screen
                lock. Nothing to remember or type. We'll set up a passkey.
              </span>
            </span>
          </label>
          <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
            <input
              type="radio"
              name="where"
              checked={choice === "shared"}
              onChange={() => setChoice("shared")}
            />
            <span>
              <strong>On different or shared computers</strong>
              <br />
              <span style={muted}>
                An office, library or family computer, or several you don't own. You type a password and a
                code from an app on your phone, so it works on any computer and leaves nothing behind. We'll
                set up a password and an app.
              </span>
            </span>
          </label>
        </fieldset>
      ) : (
        <p style={muted}>
          {passkeyPossible
            ? "This church signs in with a passkey, so we'll set one up on this device."
            : passkeyOnByServer && !browserCanPasskey
              ? "This browser can't make a passkey, so we'll set up a password and an authenticator app."
              : "We'll set up a password and an authenticator app."}
        </p>
      )}
    </>
  );
}
