import React, { useRef, useState } from "react";

// Hand-rolled canvas drawing: a signature is just connected line segments, not worth a dependency.
function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);

  function pointerPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = pointerPos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1c1d1f";
    ctx.lineTo(x, y);
    ctx.stroke();
    hasDrawn.current = true;
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(hasDrawn.current ? canvasRef.current.toDataURL("image/png") : null);
  }
  function clear() {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    hasDrawn.current = false;
    onChange(null);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={320}
        height={110}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "white",
          touchAction: "none",
          cursor: "crosshair",
        }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <div>
        <button type="button" className="btn secondary small" style={{ marginTop: "0.4rem" }} onClick={clear}>
          Clear
        </button>
      </div>
    </div>
  );
}

// Shared by the participant self-service e-signature flow: document text, a typed-or-drawn
// signature, and an attestation checkbox gating submit. onSubmit receives
// { signerName, signerRelationship, signatureImage } (a base64 PNG data URL, null if only typed).
// relationship ("self" | "parent/guardian") is recordkeeping only: nothing verifies who is at the
// keyboard (see TripDocument.signerRelationship), it just records an honest parent-signs-for-minor.
export default function SignatureCapture({ documentText, onSubmit, submitting, isMinor = false }) {
  const [mode, setMode] = useState("type"); // "type" | "draw"
  const [typedName, setTypedName] = useState("");
  const [drawnSignature, setDrawnSignature] = useState(null);
  const [attested, setAttested] = useState(false);
  // Under 18: a parent or guardian signs, so that is the only choice offered.
  const [chosenRelationship, setRelationship] = useState("self");
  const relationship = isMinor ? "parent/guardian" : chosenRelationship;

  const canSubmit = attested && typedName.trim() && (mode === "type" || drawnSignature);

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      signerName: typedName.trim(),
      signerRelationship: relationship,
      signatureImage: mode === "draw" ? drawnSignature : null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="admin-section" style={{ background: "var(--surface-2)" }}>
      <div
        style={{
          whiteSpace: "pre-wrap",
          background: "white",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.9rem 1rem",
          maxHeight: 260,
          overflowY: "auto",
          fontSize: "0.88rem",
        }}
      >
        {documentText}
      </div>

      {isMinor ? (
        <p style={{ marginTop: "0.9rem" }}>
          Because this person is under 18, a <strong>parent or legal guardian</strong> signs for them.
        </p>
      ) : (
        <label style={{ marginTop: "0.9rem" }}>
          I am signing as
          <select value={relationship} onChange={(e) => setRelationship(e.target.value)}>
            <option value="self">Myself</option>
            <option value="parent/guardian">Parent or legal guardian</option>
          </select>
        </label>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.9rem" }}>
        <button
          type="button"
          className={mode === "type" ? "btn small" : "btn secondary small"}
          onClick={() => setMode("type")}
        >
          Sign by typing my name
        </button>
        <button
          type="button"
          className={mode === "draw" ? "btn small" : "btn secondary small"}
          onClick={() => setMode("draw")}
        >
          Draw my signature
        </button>
      </div>

      <label style={{ marginTop: "0.6rem" }}>
        {relationship === "parent/guardian" ? "Parent/guardian's full name" : "Your full name"}
        <input
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="Type your full name"
        />
      </label>

      {mode === "draw" && (
        <div style={{ marginTop: "0.6rem" }}>
          <SignaturePad onChange={setDrawnSignature} />
        </div>
      )}

      <div className="admin-checkbox-row" style={{ marginTop: "0.9rem" }}>
        <label>
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
          {relationship === "parent/guardian"
            ? "I have read and agree to the above on the participant's behalf."
            : "I have read and agree to the above."}
        </label>
      </div>

      <button
        type="submit"
        className="btn"
        style={{ marginTop: "0.75rem" }}
        disabled={!canSubmit || submitting}
      >
        {submitting ? "Signing…" : "Sign"}
      </button>
      {/* Names which condition is blocking Sign, one at a time in the order a signer would meet them. */}
      {!canSubmit && !submitting && (
        <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "0.4rem" }}>
          {!typedName.trim()
            ? "Type your full name above to sign."
            : mode === "draw" && !drawnSignature
              ? "Draw your signature above to sign."
              : !attested
                ? "Check the box above to confirm before you can sign."
                : null}
        </p>
      )}
    </form>
  );
}
