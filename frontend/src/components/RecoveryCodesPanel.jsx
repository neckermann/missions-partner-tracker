import React, { useState } from "react";
import CopyButton from "./shared/CopyButton.jsx";

// Shown once, straight after an authenticator app is set up (or when a new set is made): the person's
// recovery codes. Each works one time to sign in if the phone is lost. They can copy or download them, and
// the way on stays closed until they tick that they have saved them, because this is the only time the
// codes are ever shown.
export default function RecoveryCodesPanel({ codes, onDone, doneLabel = "Continue" }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n");

  function download() {
    const blob = new Blob([`Recovery codes. Each one works once.\n\n${text}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 420 }}>
      <h3 style={{ margin: 0 }}>Save your recovery codes</h3>
      <p style={{ margin: 0 }}>
        If you lose your phone you can sign in with one of these instead of an authenticator code. Each code
        works once. Keep them somewhere safe, such as a password manager or a printed page. They are not shown
        again.
      </p>
      <ul
        aria-label="Recovery codes"
        style={{
          listStyle: "none",
          margin: 0,
          padding: "0.75rem",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.35rem 1rem",
          fontFamily: "monospace",
          fontSize: "1.05rem",
          background: "var(--surface-2)",
          borderRadius: 6,
        }}
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <CopyButton text={text} label="Copy all recovery codes" showText />
        <button type="button" className="btn secondary" onClick={download}>
          Download as a text file
        </button>
      </div>
      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I have saved
        these codes somewhere safe
      </label>
      <div>
        <button type="button" className="btn" disabled={!saved} onClick={onDone}>
          {doneLabel}
        </button>
      </div>
    </div>
  );
}
