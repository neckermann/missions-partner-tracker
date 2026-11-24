import React from "react";
import { contactActions, primaryContactOf } from "../../utils/contactActions.js";
import { formatDateLong, todayInputValue, toDateInputValue } from "../../utils/format.js";

// The contact card on a partner's page (#288): who to reach first, how they
// prefer to be reached, one-tap actions, and when anyone last was in touch.
// Shown to everyone who can see the partner.
//
// When the partner is marked NOT safe to contact, the tap actions (and the
// number/address behind them) are replaced by the special communication
// instructions staff wrote -- so the page can't nudge anyone into calling
// someone who shouldn't be called.

// Whole days between two yyyy-mm-dd strings, as local calendar days.
function daysBetweenInputs(laterStr, earlierStr) {
  const [ly, lm, ld] = laterStr.split("-").map(Number);
  const [ey, em, ed] = earlierStr.split("-").map(Number);
  return Math.round((Date.UTC(ly, lm - 1, ld) - Date.UTC(ey, em - 1, ed)) / 86400000);
}

export default function ContactCard({ partner, adults = [], entries = [] }) {
  const person = primaryContactOf(partner, adults);
  const unsafe = partner.kind !== "organization" && partner.contactSafe === false;
  const actions = unsafe || !person ? [] : contactActions(person);

  const last = entries.reduce((m, e) => {
    const d = toDateInputValue(e.contactDate);
    return !m || d > m ? d : m;
  }, null);
  const days = last ? daysBetweenInputs(todayInputValue(), last) : null;

  return (
    <div className="admin-section" id="contact-card" aria-label="Contact card">
      <h3 style={{ margin: 0 }}>
        <span aria-hidden="true">📇 </span>Contact
      </h3>

      {unsafe && (
        <div
          role="note"
          style={{
            marginTop: "0.6rem",
            padding: "0.6rem 0.8rem",
            borderRadius: "var(--radius, 6px)",
            border: "1px solid var(--warn, #a6540f)",
          }}
        >
          <strong>Special communication instructions</strong>
          <div style={{ whiteSpace: "pre-wrap", marginTop: "0.25rem" }}>
            {partner.contactInstructions || "Not safe to contact directly. Ask staff before reaching out."}
          </div>
        </div>
      )}

      {person ? (
        <div style={{ marginTop: "0.6rem" }}>
          <div>
            <strong>{person.name || "Contact"}</strong>
            {person.isPrimary && <span style={{ color: "#666" }}> · primary contact</span>}
          </div>
          {!unsafe && (person.phone || person.email) && (
            <div style={{ fontSize: "0.9rem", color: "#555" }}>
              {[person.phone, person.email].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      ) : (
        <p style={{ color: "#888", marginTop: "0.6rem" }}>No contact person on file yet.</p>
      )}

      {partner.preferredContactMethod && (
        <div style={{ marginTop: "0.3rem", fontSize: "0.9rem" }}>
          Prefers: <strong>{partner.preferredContactMethod}</strong>
        </div>
      )}

      {actions.length > 0 && (
        <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {actions.map((a) => (
            <a
              key={a.key}
              className="btn secondary small"
              href={a.href}
              {...(a.key === "whatsapp" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {a.label}
            </a>
          ))}
        </div>
      )}

      <div style={{ marginTop: "0.6rem", fontSize: "0.9rem", color: "#555" }}>
        {last
          ? `Last contact: ${days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`} (${formatDateLong(last)})`
          : "No contact logged yet."}
      </div>
    </div>
  );
}
