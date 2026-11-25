import React, { useState } from "react";

// Shown wherever a feature's own email would have gone out, but this
// church hasn't enabled Email (Sending) -- the link/content itself never
// needed Postmark to exist, only the automatic delivery did (see SPEC.md
// § 4), so this hands it back for an admin to copy and send however they
// actually have (personal email, text, in person) instead of the feature
// just quietly doing nothing.
//
// `recipients` is one { name?, email?, url } or an array of them -- the
// single-recipient shape (a password setup link, a participant's own
// access link) and the multi-recipient shape (a meeting invite, a
// checklist notice fanned out to a trip's participants) share this one
// component rather than each page rolling its own copy-link UI.
export default function ManualSendNotice({ recipients, title = "Email sending isn't enabled here" }) {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  const [copiedIndex, setCopiedIndex] = useState(null);

  if (list.length === 0) return null;

  async function copy(url, index) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((i) => (i === index ? null : i)), 2000);
    } catch {
      // Clipboard access can be denied (permissions, non-HTTPS context) --
      // the link is still selectable/copyable by hand in the input below,
      // so this isn't a dead end, just a missed convenience.
    }
  }

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
          <button type="button" className="btn secondary small" onClick={() => copy(r.url, i)}>
            {copiedIndex === i ? "Copied!" : "Copy"}
          </button>
        </div>
      ))}
    </div>
  );
}
