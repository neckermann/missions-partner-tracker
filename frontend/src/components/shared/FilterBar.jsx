import React, { useEffect, useRef, useState } from "react";

const SEARCH_DEBOUNCE_MS = 250;

// Generic filter-bar shell. `fields` is ({ name, label, type, options?, showWhen? }) the contract
// of backend/src/reporting/registry.js listReports(); `values`/`onChange(name, value)` are
// typically backed by hooks/useFilterState.js (which syncs to the URL). `pills` is an optional
// quick-filter row bound to one field by name (skipped in the chip row). Only active fields render
// as removable chips; the rest sit behind "+ Add filter". A field's default is `false` for a
// checkbox, "all" for a select, "" otherwise. `extraChips` is pre-rendered chip content that
// doesn't fit the fields model.
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

// "all" is the empty-filter sentinel for selects, and for untyped fields like AdminPartners' `country`.
function fieldIsDefault(field, values) {
  const v = values[field.name];
  if (field.type === "checkbox") return !v;
  if (field.type === "number" || field.type === "date") return v === undefined || v === "";
  return v === undefined || v === "" || v === "all";
}

function defaultValueFor(field) {
  if (field.type === "checkbox") return false;
  if (field.type === "number" || field.type === "date") return "";
  return "all";
}

function SearchBox({ field, value, onChange }) {
  const [local, setLocal] = useState(value || "");
  useEffect(() => setLocal(value || ""), [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (local !== (value || "")) onChange(field.name, local);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Only `local` should retrigger the debounce timer, not `value`/`onChange` changing on their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div className="filter-search-box">
      <span aria-hidden="true">🔍</span>
      <input type="text" value={local} onChange={(e) => setLocal(e.target.value)} placeholder={field.label} />
      {local && (
        <button
          type="button"
          className="filter-search-clear"
          onClick={() => {
            setLocal("");
            onChange(field.name, "");
          }}
          aria-label="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function AddFilterPopover({ fields, onAdd }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (fields.length === 0) return null;

  return (
    <div className="add-filter-wrap" ref={wrapRef}>
      <button type="button" className="add-filter-chip" onClick={() => setOpen((v) => !v)}>
        + Add filter
      </button>
      {open && (
        <div className="filter-popover-panel">
          {fields.map((f) => (
            <button
              key={f.name}
              type="button"
              className="fp-item"
              onClick={() => {
                onAdd(f);
                setOpen(false);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FilterBar({ fields, values, onChange, onReset, pills, extraChips }) {
  const [manuallyAdded, setManuallyAdded] = useState({});

  const searchField = fields.find((f) => f.name === "search");
  const chippableFields = fields.filter((field) => {
    if (field.name === "search") return false;
    if (pills && field.name === pills.field) return false;
    if (field.showWhen && values[field.showWhen.field] !== field.showWhen.equals) return false;
    return true;
  });

  const activeFields = chippableFields.filter((f) => !fieldIsDefault(f, values) || manuallyAdded[f.name]);
  const availableFields = chippableFields.filter((f) => fieldIsDefault(f, values) && !manuallyAdded[f.name]);

  function removeField(field) {
    onChange(field.name, defaultValueFor(field));
    setManuallyAdded((m) => {
      if (!(field.name in m)) return m;
      const next = { ...m };
      delete next[field.name];
      return next;
    });
  }

  function clearAll() {
    onReset();
    setManuallyAdded({});
  }

  return (
    <div className="admin-section">
      <div className="filter-bar-row">
        {pills && (
          <div className="filter-pill-row">
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
        {searchField && <SearchBox field={searchField} value={values.search} onChange={onChange} />}
        {extraChips}
        {activeFields.map((field) => (
          <span key={field.name} className="filter-chip on">
            {field.type === "checkbox" ? (
              <span className="filter-chip-label">{field.label}</span>
            ) : (
              <>
                <span className="filter-chip-label">{field.label}:</span>
                {renderField(field, values, onChange)}
              </>
            )}
            <button
              type="button"
              className="fc-x"
              onClick={() => removeField(field)}
              aria-label={`Remove ${field.label} filter`}
            >
              ✕
            </button>
          </span>
        ))}
        {activeFields.length > 0 && (
          <button type="button" className="clear-all-link" onClick={clearAll}>
            Clear all
          </button>
        )}
        <AddFilterPopover
          fields={availableFields}
          onAdd={(field) => {
            // A checkbox field has only default (off, not shown) and added (on), so adding it from the
            // popover turns it on directly.
            if (field.type === "checkbox") {
              onChange(field.name, true);
            } else {
              setManuallyAdded((m) => ({ ...m, [field.name]: true }));
            }
          }}
        />
      </div>
    </div>
  );
}
