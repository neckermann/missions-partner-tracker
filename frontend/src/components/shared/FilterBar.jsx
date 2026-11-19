import React from "react";

// Generic filter-bar shell, resource-agnostic -- lifted out of
// AdminReports.jsx's field-rendering switch and TripFilterBar.jsx's
// pills+box chrome (both now retired into this). A resource page
// supplies a `fields` array ({ name, label, type, options?, showWhen? },
// the exact contract backend/src/reports/index.js's listReports()
// already returns) plus its current `values` and an `onChange(name,
// value)` -- typically backed by hooks/useFilterState.js, which owns
// syncing those values to the URL query string.
//
// `pills` is optional -- a quick-filter row bound to one of `fields` by
// name (e.g. Trip status), rendered as buttons above the field grid
// instead of a <select> inside it. The named field is skipped in the
// grid so it isn't rendered twice.
function renderField(field, values, onChange) {
  const value = values[field.name] ?? (field.type === "checkbox" ? false : "");
  switch (field.type) {
    case "select":
      return (
        <select value={value} onChange={(e) => onChange(field.name, e.target.value)}>
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "number":
      return (
        <input type="number" min="0" value={value} onChange={(e) => onChange(field.name, e.target.value)} />
      );
    case "date":
      return <input type="date" value={value} onChange={(e) => onChange(field.name, e.target.value)} />;
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(field.name, e.target.checked)}
          style={{ width: "auto" }}
        />
      );
    default:
      return <input type="text" value={value} onChange={(e) => onChange(field.name, e.target.value)} />;
  }
}

export default function FilterBar({ fields, values, onChange, onReset, pills, title = "Filters" }) {
  const visibleFields = fields.filter((field) => {
    if (pills && field.name === pills.field) return false;
    if (field.showWhen && values[field.showWhen.field] !== field.showWhen.equals) return false;
    return true;
  });

  return (
    <div className="admin-section">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button type="button" className="btn secondary small" onClick={onReset}>
          Reset Filters
        </button>
      </div>
      {pills && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          {pills.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={values[pills.field] === opt.value ? "btn small" : "btn secondary small"}
              onClick={() => onChange(pills.field, opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {visibleFields.length > 0 && (
        <div className="form-grid" style={{ marginTop: "0.75rem" }}>
          {visibleFields.map((field) => (
            <label
              key={field.name}
              style={
                field.type === "checkbox"
                  ? { display: "flex", flexDirection: "row", alignItems: "center", gap: "0.4rem" }
                  : undefined
              }
            >
              {field.type === "checkbox" ? null : field.label}
              {renderField(field, values, onChange)}
              {field.type === "checkbox" ? field.label : null}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
