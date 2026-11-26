// How a person likes to be reached, and how careful to be with a partner. The values match the
// server's list (backend/src/utils/contactMethods.js); this adds the words a person reads.
export const CONTACT_METHODS = [
  { value: "call", label: "Phone call" },
  { value: "text", label: "Text message" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "signal", label: "Signal" },
  { value: "messenger", label: "Messenger" },
  { value: "other", label: "Other" },
];

// "Other" reads as what the note says ("Telegram"), when there is one.
export function methodLabel(method, note) {
  if (!method) return "";
  if (method === "other") return note || "Other";
  return CONTACT_METHODS.find((m) => m.value === method)?.label || method;
}

export const CONTACT_LEVELS = [
  { value: "normal", label: "Normal", hint: "Reach them as usual." },
  {
    value: "caution",
    label: "Use caution",
    hint: "Reachable, but follow the guidelines, and only the ways you tick.",
  },
  {
    value: "no_direct",
    label: "Don't contact directly",
    hint: "Hide their number and email; say who to go through instead.",
  },
];

// The level a partner is at: a family may be "caution" or "no_direct"; an organization is always normal.
export function contactLevelOf(partner) {
  if (partner?.kind === "organization") return "normal";
  return partner?.contactLevel || "normal";
}
