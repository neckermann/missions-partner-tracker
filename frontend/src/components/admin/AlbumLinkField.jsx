import React, { useState } from "react";

// Link to an album the admin maintains elsewhere (never in-app file storage). Fully controlled:
// provider and url come from the parent's form state every render.
const PROVIDERS = [
  { value: "google_photos", label: "Google Photos", placeholder: "https://photos.app.goo.gl/..." },
  { value: "icloud", label: "iCloud Shared Album", placeholder: "https://www.icloud.com/sharedalbum/..." },
  { value: "other", label: "Other", placeholder: "https://..." },
];

// Mirrors trips.js ALBUM_URL_PATTERNS: a client-side hint only; the backend 400 is the enforcement.
const HINT_PATTERNS = {
  google_photos: /^https:\/\/photos\.(app\.goo\.gl|google\.com)\//i,
  icloud: /^https:\/\/(www\.)?icloud\.com\/(sharedalbum|photos)\//i,
  other: /^https?:\/\/.+\..+/,
};

export default function AlbumLinkField({ provider, url, onChange }) {
  const [touched, setTouched] = useState(false);
  const selected = PROVIDERS.find((p) => p.value === provider);
  const showHint = touched && selected && url && !HINT_PATTERNS[provider].test(url.trim());

  function selectProvider(value) {
    if (!value) {
      onChange(null, null);
      return;
    }
    onChange(value, url || "");
  }

  return (
    <>
      <select value={provider || ""} onChange={(e) => selectProvider(e.target.value || null)}>
        <option value="">Not specified</option>
        {PROVIDERS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      {selected && (
        <>
          <input
            value={url || ""}
            onChange={(e) => onChange(provider, e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={selected.placeholder}
            style={{ marginTop: "0.4rem" }}
          />
          {/* Always rendered once a provider is picked, space reserved via
              minHeight even when empty -- this hint toggling must never
              shift the layout of whatever sits below it (e.g. the form's
              Save button), or a click landing right as the hint appears
              can miss its target. */}
          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--warn)",
              marginTop: "0.25rem",
              minHeight: "1.2em",
              visibility: showHint ? "visible" : "hidden",
            }}
          >
            Doesn't look like a {selected.label} link -- double-check it before saving.
          </p>
        </>
      )}
    </>
  );
}
