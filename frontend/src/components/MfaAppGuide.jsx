import React from "react";

// Plain-language "what do I do?" for someone who has never used an
// authenticator app. Shown wherever a person enrolls in two-factor
// authentication (the forced first-login setup and Account Settings).
// One recommended app with store links for both phone types, plus a short
// list of alternatives -- any app that supports "TOTP" codes works.
const RECOMMENDED = {
  name: "Microsoft Authenticator",
  ios: "https://apps.apple.com/app/microsoft-authenticator/id983156458",
  android: "https://play.google.com/store/apps/details?id=com.azure.authenticator",
};
const ALTERNATIVES = [
  {
    name: "Google Authenticator",
    ios: "https://apps.apple.com/app/google-authenticator/id388497605",
    android: "https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2",
  },
  { name: "Authy" },
  { name: "1Password" },
  { name: "Bitwarden" },
];

const stepStyle = { margin: "0 0 0.75rem", paddingLeft: "0.25rem" };

export default function MfaAppGuide() {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: "0.9rem 1rem",
        background: "#fafafa",
        marginBottom: "1rem",
      }}
    >
      <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>New to two-factor authentication?</h3>
      <p style={{ margin: "0 0 0.75rem", color: "#444", fontSize: "0.9rem" }}>
        It adds a second step when you sign in: a 6-digit code from an app on your phone. Even if someone
        learned your password, they couldn't get in without your phone. It takes about two minutes.
      </p>
      <ol style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.9rem", color: "#333" }}>
        <li style={stepStyle}>
          <strong>Install an authenticator app</strong> on your phone. We suggest {RECOMMENDED.name} (free):{" "}
          <a href={RECOMMENDED.ios} target="_blank" rel="noopener noreferrer">
            iPhone
          </a>{" "}
          ·{" "}
          <a href={RECOMMENDED.android} target="_blank" rel="noopener noreferrer">
            Android
          </a>
          .
        </li>
        <li style={stepStyle}>
          <strong>Open the app and add an account.</strong> Choose the option to scan a QR code, then point
          your phone's camera at the code below.
        </li>
        <li style={stepStyle}>
          <strong>Type the 6-digit code</strong> the app shows into the box below. The code changes every 30
          seconds, so just enter the current one.
        </li>
      </ol>
      <details style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#444" }}>
        <summary style={{ cursor: "pointer" }}>Prefer a different app?</summary>
        <p style={{ margin: "0.5rem 0 0.25rem" }}>
          Any authenticator app that supports time-based codes works, for example:
        </p>
        <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
          {ALTERNATIVES.map((a) => (
            <li key={a.name}>
              {a.name}
              {a.ios && (
                <>
                  {" "}
                  (
                  <a href={a.ios} target="_blank" rel="noopener noreferrer">
                    iPhone
                  </a>{" "}
                  ·{" "}
                  <a href={a.android} target="_blank" rel="noopener noreferrer">
                    Android
                  </a>
                  )
                </>
              )}
            </li>
          ))}
        </ul>
      </details>
      <p style={{ margin: "0.6rem 0 0", fontSize: "0.8rem", color: "#666" }}>
        Don't have your phone handy? Ask your administrator for help.
      </p>
    </div>
  );
}
