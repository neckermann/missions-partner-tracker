import React, { useEffect, useState } from "react";
import { fetchMyKeyDates } from "../../api/client.js";
import CopyButton from "../shared/CopyButton.jsx";

// The email-off option for key-date reminders: when Email (Sending) isn't on, the daily key-date email isn't
// sent, so this hands the person the same list to copy and pass on (a text to the team, a note, a printout).
// Renders nothing when email is on, the feature is off, or nothing is coming up.
export default function KeyDatesCopyList() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchMyKeyDates()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data || data.emailOn || data.items.length === 0) return null;
  const text = ["Key dates coming up", ...data.items.map((i) => `${i.when}: ${i.text}`)].join("\n");

  return (
    <div className="admin-section" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
      <p style={{ marginTop: 0, fontWeight: 600 }}>Key-date emails aren&apos;t on here</p>
      <p style={{ color: "var(--muted)" }}>
        Email (Sending) is off, so the daily email isn&apos;t sent. Here is what it would have said. Copy it
        and pass it on however you like.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 0.75rem" }}>
        {data.items.map((i) => (
          <li key={`${i.partnerId}-${i.when}-${i.text}`} style={{ padding: "0.2rem 0" }}>
            <strong>{i.when}</strong> &middot; {i.text}
          </li>
        ))}
      </ul>
      <CopyButton text={text} label="Copy this week's list" showText />
    </div>
  );
}
