import React from "react";

// A partner picker, grouped by kind: a plain controlled <select> whose value is a partnerId.
// `partners` is whatever fetchPartners() returned; only id, kind and displayName are read.
export default function PartnerSelect({
  partners,
  value,
  onChange,
  required,
  includeArchived = false,
  ...rest
}) {
  const usable = includeArchived ? partners : partners.filter((p) => !p.archived);
  const missionaries = usable.filter((p) => p.kind === "missionary");
  const organizations = usable.filter((p) => p.kind === "organization");

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required={required} {...rest}>
      <option value="">Select one...</option>
      {missionaries.length > 0 && (
        <optgroup label="Missionaries">
          {missionaries.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </optgroup>
      )}
      {organizations.length > 0 && (
        <optgroup label="Organizations">
          {organizations.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
