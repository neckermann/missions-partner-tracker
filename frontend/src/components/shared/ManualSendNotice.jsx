import React from "react";
import CopyButton from "./CopyButton.jsx";

// Shown where a feature's email would have gone out but Email (Sending) isn't enabled (SPEC.md
// § 4): hands the link/content to an admin to copy and send themselves. `recipients` is one
// { name?, email?, url } or an array of them.
export default function ManualSendNotice({ recipients, title = "Email sending isn't enabled here" }) {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  if (list.length === 0) return null;

  return (
    <div className="admin-section" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
      <p style={{ marginTop: 0, fontWeight: 600 }}>{title}</p>
      <p style={{ color: "var(--muted)" }}>
        Copy {list.length > 1 ? "each link" : "this link"} below and send it yourself -- a personal email, a
        text, or in person all work.
      </p>
      {list.map((r, i) => (
        <div
          key={r.url}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: i === 0 ? 0 : "0.5rem" }}
        >
          <div style={{ flex: "0 0 auto", minWidth: "140px" }}>
            {r.name || r.email ? (
              <span>
                {r.name}
                {r.name && r.email ? " -- " : ""}
                {r.email}
              </span>
            ) : null}
          </div>
          <input readOnly value={r.url} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
          <CopyButton text={r.url} label={r.name ? `Copy link for ${r.name}` : "Copy link"} showText />
        </div>
      ))}
    </div>
  );
}
