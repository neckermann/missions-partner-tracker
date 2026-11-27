import React, { useState } from "react";
import { formatPhone } from "../../utils/phone.js";
import { contactActions, primaryContactOf } from "../../utils/contactActions.js";
import { contactLevelOf, methodLabel } from "../../utils/contactMethods.js";
import { formatDateLong, todayInputValue, toDateInputValue } from "../../utils/format.js";
import ContactCardEditor from "./ContactCardEditor.jsx";
import { onClickUnlessSelecting } from "../../utils/clickableRow.js";
import CopyValue from "../shared/CopyValue.jsx";

// The contact card on a partner's page: who to reach first, how they like to be reached, one-tap
// actions, how careful to be, and when anyone last was in touch. Shown to everyone who can see the
// partner.
//
// The partner's contact level:
//   normal    -- details and tap actions as usual;
//   caution   -- the same under a warning with the guidelines, and only the ways the church ticked;
//   no_direct -- the person's number, email and actions are hidden, replaced by who to go through
//                and the guidelines, so the page can't nudge anyone into calling them.

// Whole days between two yyyy-mm-dd strings, as local calendar days.
function daysBetweenInputs(laterStr, earlierStr) {
  const [ly, lm, ld] = laterStr.split("-").map(Number);
  const [ey, em, ed] = earlierStr.split("-").map(Number);
  return Math.round((Date.UTC(ly, lm - 1, ld) - Date.UTC(ey, em - 1, ed)) / 86400000);
}

function ActionButtons({ actions }) {
  if (actions.length === 0) return null;
  return (
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
  );
}

export default function ContactCard({
  partner,
  adults = [],
  entries = [],
  showLog = true,
  canEdit = false,
  canEditCare = false,
  careTeam = null,
  onChanged,
}) {
  const [editing, setEditing] = useState(false);
  const person = primaryContactOf(partner, adults);
  const isOrg = partner.kind === "organization";
  const level = contactLevelOf(partner);
  const channels = partner.contactChannels || [];
  const hidden = level === "no_direct";

  // The tap actions this person may be reached by: none when we are not to contact them
  // directly, and only the ticked ways under caution.
  let actions = hidden || !person ? [] : contactActions(person);
  if (level === "caution" && channels.length > 0) actions = actions.filter((a) => channels.includes(a.key));
  // Copy follows the same rule as the tap actions: a number may be copied only where Call or Text is offered, an
  // email only where Email is, so the button can never hand over a way the church said not to use.
  const canCopyPhone = actions.some((a) => a.key === "call" || a.key === "text");
  const canCopyEmail = actions.some((a) => a.key === "email");
  const firstName = (p) => (p?.name || "").split(" ")[0] || undefined;
  const viaActions = hidden
    ? contactActions({ phone: partner.contactViaPhone, email: partner.contactViaEmail }).filter(
        (a) => a.key === "call" || a.key === "email"
      )
    : [];

  const last = entries.reduce((m, e) => {
    const d = toDateInputValue(e.contactDate);
    return !m || d > m ? d : m;
  }, null);
  const days = last ? daysBetweenInputs(todayInputValue(), last) : null;
  // Only while it is still in the future; an old date means nothing.
  const snoozeValue = partner.contactSnoozedUntil ? toDateInputValue(partner.contactSnoozedUntil) : "";
  const snoozedUntil = snoozeValue && snoozeValue > todayInputValue() ? snoozeValue : "";

  // Who else is in the family, and how they like to be reached.
  const others = isOrg || hidden ? [] : adults.filter((a) => a.id !== person?.adultId && a.contactMethod);
  const preferred = person?.method ? methodLabel(person.method, person.methodNote) : "";

  return (
    // One card, two zones: the contact details on top open Edit contact, the care team below opens its
    // own editor. Inside the contact zone the links and buttons (call, email) keep their own click; the
    // title button is the keyboard way in.
    <div className="admin-section" id="contact-card" aria-label="Contact card">
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={canEdit ? "contact-zone contact-zone-clickable" : "contact-zone"}
        onClick={
          canEdit
            ? onClickUnlessSelecting((e) => {
                if (!e.target.closest("a, button, input, select, textarea, label, [role='button']"))
                  setEditing(true);
              })
            : undefined
        }
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <h3 style={{ margin: 0, border: 0, padding: 0 }}>
            <span aria-hidden="true">📇 </span>
            {canEdit ? (
              <button
                type="button"
                className="summary-item-link"
                aria-label="Edit contact"
                onClick={() => setEditing(true)}
                style={{ font: "inherit", color: "inherit", textDecoration: "none" }}
              >
                Contact
              </button>
            ) : (
              "Contact"
            )}
          </h3>
        </div>

        {level === "caution" && (
          <div role="note" className="contact-notice contact-notice-caution">
            <strong>Use caution</strong>
            {channels.length > 0 && (
              <div>Reach them by {channels.map((c) => methodLabel(c).toLowerCase()).join(" or ")} only.</div>
            )}
            {partner.contactInstructions && (
              <div style={{ whiteSpace: "pre-wrap", marginTop: "0.25rem" }}>
                {partner.contactInstructions}
              </div>
            )}
          </div>
        )}

        {hidden && (
          <div role="note" className="contact-notice contact-notice-stop">
            <strong>Don't contact directly</strong>
            <div style={{ whiteSpace: "pre-wrap", marginTop: "0.25rem" }}>
              {partner.contactInstructions || "Ask staff before reaching out."}
            </div>
            {(partner.contactViaName || partner.contactViaPhone || partner.contactViaEmail) && (
              <div style={{ marginTop: "0.6rem" }}>
                <div style={{ fontSize: "0.8rem", textTransform: "uppercase", color: "var(--muted)" }}>
                  Go through
                </div>
                <strong>{partner.contactViaName || "Their go-between"}</strong>
                {partner.contactViaRole && (
                  <span style={{ color: "var(--muted)" }}> · {partner.contactViaRole}</span>
                )}
                {(partner.contactViaPhone || partner.contactViaEmail) && (
                  <div style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                    <CopyValue kind="phone" value={partner.contactViaPhone} whose={partner.contactViaName} />
                    {partner.contactViaPhone && partner.contactViaEmail ? " · " : ""}
                    <CopyValue kind="email" value={partner.contactViaEmail} whose={partner.contactViaName} />
                  </div>
                )}
                <ActionButtons actions={viaActions} />
              </div>
            )}
          </div>
        )}

        {person ? (
          <div style={{ marginTop: "0.6rem" }}>
            <div>
              <strong>{person.name || "Contact"}</strong>
              {person.isPrimary && <span style={{ color: "var(--muted)" }}> · primary contact</span>}
            </div>
            {!hidden && (person.phone || person.email) && (
              <div style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                {/* A copy button only for a way the card itself offers: under caution, only the ticked ways. */}
                {canCopyPhone ? (
                  <CopyValue kind="phone" value={person.phone} whose={firstName(person)} />
                ) : (
                  formatPhone(person.phone)
                )}
                {person.phone && person.email ? " · " : ""}
                {canCopyEmail ? (
                  <CopyValue kind="email" value={person.email} whose={firstName(person)} />
                ) : (
                  person.email
                )}
              </div>
            )}
          </div>
        ) : (
          <p style={{ color: "var(--muted)", marginTop: "0.6rem" }}>No contact person on file yet.</p>
        )}

        {!hidden && preferred && (
          <div className="contact-highlight">
            Prefers <strong>{preferred}</strong>
          </div>
        )}

        {!hidden && <ActionButtons actions={actions} />}

        {others.length > 0 && (
          <div style={{ marginTop: "0.6rem", fontSize: "0.9rem", color: "var(--muted)" }}>
            {others.map((a) => (
              <div key={a.id}>
                {[a.firstName, a.lastName].filter(Boolean).join(" ")} prefers{" "}
                {methodLabel(a.contactMethod, a.contactMethodNote)}
              </div>
            ))}
          </div>
        )}

        {showLog && (
          <div style={{ marginTop: "0.6rem", fontSize: "0.9rem", color: "var(--muted)" }}>
            {last
              ? `Last contact: ${days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`} (${formatDateLong(last)})`
              : "No contact logged yet."}
          </div>
        )}
        {snoozedUntil && (
          <div style={{ marginTop: "0.4rem", fontSize: "0.9rem", color: "var(--muted)" }}>
            Not this season: not called quiet until {formatDateLong(snoozedUntil)}.
          </div>
        )}
      </div>

      {careTeam && <div className="contact-care-team">{careTeam}</div>}

      {editing && (
        <ContactCardEditor
          partner={partner}
          adults={adults}
          canEditCare={canEditCare}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
