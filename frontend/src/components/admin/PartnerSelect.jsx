import React from "react";

// A partner picker, grouped by kind. Every "add X against a partner" form
// needs one, and before missionaries and organizations merged each of them
// hand-rolled two <optgroup>s over two separately-fetched lists and encoded
// the choice as a "missionary:<id>" string that the submit handler had to
// split apart again. The value is just a partnerId now, so this is a plain
// controlled <select>.
//
// `partners` is whatever fetchPartners() returned — it only reads id, kind
// and displayName, so a summary row is enough.
export default function PartnerSelect({ partners, value, onChange, required, includeArchived = false, ...rest }) {
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
