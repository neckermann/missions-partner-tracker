import React, { useState } from "react";
import { createUser } from "../../api/client.js";
import QuickActionModal from "../shared/QuickActionModal.jsx";

// The participant page's entry into guest access: creates an account with one grant on this trip
// and sends the welcome email (or hands back a manual setup link when outbound email is off).
// Two-factor is required automatically for the guest.
export default function GiveGuestAccessModal({ tripId, participant, onClose, onCreated }) {
  const [form, setForm] = useState({
    email: participant.email || "",
    firstName: participant.firstName || "",
    lastName: participant.lastName || "",
  });
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit() {
    const created = await createUser({
      email: form.email.trim(),
      firstName: form.firstName.trim() || null,
      lastName: form.lastName.trim() || null,
      role: "guest",
      tripAccess: [{ tripId }],
      sendWelcomeEmail: true,
    });
    onCreated(created);
  }

  return (
    <QuickActionModal title="Give guest access" onClose={onClose} onSubmit={handleSubmit}>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        This creates a guest login for this trip. They can work on this trip and see its partner, nothing else
        in the app, and they'll set up a password and two-factor authentication from a link we send them.
        Access ends 30 days after the trip ends.
      </p>
      <div className="form-grid">
        <label>
          Email
          <input type="email" value={form.email} onChange={set("email")} required />
        </label>
        <label>
          First name
          <input value={form.firstName} onChange={set("firstName")} />
        </label>
        <label>
          Last name
          <input value={form.lastName} onChange={set("lastName")} />
        </label>
      </div>
    </QuickActionModal>
  );
}
