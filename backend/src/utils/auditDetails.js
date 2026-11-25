// Turns an audit entry's `details` JSON into one readable line, shared by the Audit
// log page and CSV export. Handles { field: { from, to } }, { field: "changed" }
// secret notes, { added: [...] } lists and plain values.
const show = (v) => {
  if (v === null || v === undefined || v === "") return "none";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  // A machine code ("unknown_email") reads as words.
  if (typeof v === "string" && /^[a-z]+(_[a-z]+)+$/.test(v)) return v.replace(/_/g, " ");
  return String(v);
};

// camelCase / snake_case key -> "Camel case"
const humanize = (key) => {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
};

function describeDetails(details) {
  if (!details || typeof details !== "object") return "";
  const parts = [];
  for (const [key, value] of Object.entries(details)) {
    if (value && typeof value === "object" && !Array.isArray(value) && ("from" in value || "to" in value)) {
      parts.push(`${humanize(key)}: ${show(value.from)} → ${show(value.to)}`);
    } else if (Array.isArray(value)) {
      parts.push(`${humanize(key)}: ${value.map(show).join(", ")}`);
    } else {
      parts.push(`${humanize(key)}: ${show(value)}`);
    }
  }
  return parts.join("; ");
}

module.exports = { describeDetails };
