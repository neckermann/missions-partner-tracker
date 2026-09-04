import React, { useEffect, useRef, useState } from "react";
import { fetchAdminMissionaries, fetchAdminOrganizations } from "../api/client.js";
import bookletCssUrl from "../styles/booklet.css?url";
import { useSettings } from "../context/SettingsContext.jsx";

// The polyfill build auto-paginates whatever's in <body> on load — used to
// build a standalone printable document opened in its own tab, as opposed
// to the Previewer class used for the inline on-page preview below. Loaded
// from a CDN rather than a local package import: pagedjs's package.json
// doesn't expose "./dist/paged.polyfill.js" via its "exports" map, so
// Vite's bundler refuses to resolve it as a deep import even though the
// file exists on disk. A plain <script src="..."> string in HTML we build
// at runtime never goes through Vite's resolver, so this sidesteps that
// entirely. Version-pinned to match the installed pagedjs release.
const PAGED_POLYFILL_URL = "https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js";

// Rotates per missionary page so the booklet doesn't look monotone —
// easy to swap for real brand colors later.
const PALETTE = [
  { accent: "#C97A3D", tint: "#F6E4D3" },
  { accent: "#4C7A79", tint: "#E1EDEC" },
  { accent: "#6B5B4C", tint: "#EFE8E2" },
  { accent: "#7A8B6F", tint: "#E9EEE4" },
];

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Date-only fields are UTC-midnight ISO strings — build the Date from raw
// Y/M/D components (not new Date(isoString)) to avoid a timezone-shift
// off-by-one-day bug, matching AdminMissionaryDetail.jsx's formatDate.
function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function renderAddressBlock(label, address) {
  if (!address) return "";
  const lines = [address.addressLine1, address.addressLine2].filter(Boolean);
  const cityLine = [address.city, address.stateProvinceRegion, address.postalCode]
    .filter(Boolean)
    .join(", ");
  if (!lines.length && !cityLine && !address.country) return "";
  return `
    <div class="booklet-block">
      <h3>${escapeHtml(label)}</h3>
      ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}
      ${cityLine ? `<p>${escapeHtml(cityLine)}</p>` : ""}
      ${address.country ? `<p>${escapeHtml(address.country)}</p>` : ""}
    </div>`;
}

// Adults and children are still separate DB tables (different fields —
// phone/email only make sense for adults), but display them as one "Family"
// unit here. `fields.showAdults`/`fields.showChildren` independently gate
// each half of the same block, so children can still be hidden on their own.
function renderFamilyBlock(m, fields) {
  const rows = [];
  if (fields.showAdults) {
    if (m.anniversary) rows.push(`<p><strong>Anniversary:</strong> ${escapeHtml(formatDate(m.anniversary))}</p>`);
    if (m.preferredContactMethod) {
      rows.push(`<p><strong>Preferred Contact:</strong> ${escapeHtml(m.preferredContactMethod)}</p>`);
    }
    (m.adults || []).forEach((a) => {
      const parts = [a.phone1, a.email].filter(Boolean).map(escapeHtml);
      rows.push(`<p>${escapeHtml(a.name)}${parts.length ? ` — ${parts.join(" · ")}` : ""}</p>`);
    });
  }
  if (fields.showChildren) {
    (m.children || []).forEach((c) => {
      rows.push(
        `<p><em>Child</em> — ${escapeHtml(c.name)}${c.birthday ? ` — ${escapeHtml(formatDate(c.birthday))}` : ""}</p>`
      );
    });
  }
  if (!rows.length) return "";
  return `<div class="booklet-block"><h3>Family</h3>${rows.join("")}</div>`;
}

function renderSendingPartyBlock(m) {
  const parts = [];
  if (m.sendingChurch?.name) {
    const bits = [m.sendingChurch.contactName, m.sendingChurch.phone].filter(Boolean).map(escapeHtml);
    parts.push(
      `<p><strong>Sending Church:</strong> ${escapeHtml(m.sendingChurch.name)}${bits.length ? ` — ${bits.join(" · ")}` : ""}</p>`
    );
  }
  if (m.sendingOrg?.name) {
    const bits = [m.sendingOrg.contactName, m.sendingOrg.phone].filter(Boolean).map(escapeHtml);
    parts.push(
      `<p><strong>Sending Org:</strong> ${escapeHtml(m.sendingOrg.name)}${bits.length ? ` — ${bits.join(" · ")}` : ""}</p>`
    );
  }
  if (!parts.length) return "";
  return `<div class="booklet-block"><h3>Sending Church / Org</h3>${parts.join("")}</div>`;
}

function renderOrgContactBlock(o) {
  const rows = [];
  if (o.contactName) rows.push(`<p><strong>Contact:</strong> ${escapeHtml(o.contactName)}</p>`);
  if (o.contactPhone) rows.push(`<p><strong>Phone:</strong> ${escapeHtml(o.contactPhone)}</p>`);
  if (o.contactEmail) rows.push(`<p><strong>Email:</strong> ${escapeHtml(o.contactEmail)}</p>`);
  if (o.websiteLink) rows.push(`<p><strong>Website:</strong> ${escapeHtml(o.websiteLink)}</p>`);
  if (!rows.length) return "";
  return `<div class="booklet-block"><h3>Contact Info</h3>${rows.join("")}</div>`;
}

// A dedicated, full page of ruled, spaced lines for handwritten notes and
// prayer requests — inserted immediately after an entry's detail page (see
// buildBookletHtml) rather than squeezed alongside it, so the detail page's
// own layout never changes and, once printed/bound, each entry gets its own
// facing page for notes.
function buildNotesPageHtml(name, accent) {
  return `
    <section class="booklet-page booklet-notes-page" style="--accent:${accent}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      <h2 class="booklet-notes-heading">Notes &amp; Prayer Requests</h2>
      <p class="booklet-notes-subheading">${escapeHtml(name)}</p>
      <div class="booklet-notes-lines"></div>
    </section>`;
}

// A genuinely blank page used only to fix booklet-print page alignment (see
// the pageCount/pad() logic in buildBookletHtml) — labeled rather than
// silently empty, matching standard print convention for intentional blanks
// so it doesn't look like a printing error.
function buildBlankPageHtml() {
  return `
    <section class="booklet-page booklet-blank-page">
      <p>This page is intentionally left blank.</p>
    </section>`;
}

// One page per organization — leaner than a missionary page (no family/trip
// capacity), just the fields explicitly asked for: type/region, supporting
// since, contact info, overview, and focus.
function buildOrganizationPageHtml(o, index) {
  const palette = PALETTE[index % PALETTE.length];
  const eyebrow = [o.orgType, o.fieldDisplayName].filter(Boolean).join(" · ");

  return `
    <section class="booklet-page" style="--accent:${palette.accent};--tint:${palette.tint}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      <p class="booklet-eyebrow">${escapeHtml(eyebrow)}</p>
      <h2 class="booklet-name">${escapeHtml(o.name)}</h2>
      ${o.supportingSince ? `<p style="font-family: Arial, sans-serif; font-size: 11pt; color: #555; margin: 0 0 0.15in;">Partnering since ${escapeHtml(formatDate(o.supportingSince))}</p>` : ""}
      ${renderOrgContactBlock(o)}
      ${o.overview ? `<div class="booklet-callout"><p>${escapeHtml(o.overview)}</p></div>` : ""}
      ${o.focusArea ? `<div class="booklet-block"><h3>Focus Area</h3><p>${escapeHtml(o.focusArea)}</p></div>` : ""}
      <div class="booklet-footer">${escapeHtml(o.name)}</div>
    </section>`;
}

// A lightweight divider page (reuses the cover's styling) marking the start
// of the Local or National organizations section.
function buildSectionDivider(title, accent) {
  return `
    <section class="booklet-cover" style="--accent:${accent}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      <h1 class="booklet-cover-title" style="font-size: 36pt;">${escapeHtml(title)}</h1>
    </section>`;
}

// Closing page, always last — simpler than the front cover by design (every
// reference booklet layout this template set drew from treats the back
// cover as a plain sign-off, never a repeat of the front cover): church
// logo/name if Church Settings has them, a short closing message, and the
// generated date. Falls back to a generic thank-you if aboutText/
// publicTagline are both unset, so an instance with no branding configured
// still gets a real closing page instead of an empty one.
function buildBackCoverHtml({ churchName, logo, aboutText, publicTagline, accent }) {
  const message = aboutText || publicTagline || "Thank you for your prayers and support.";
  return `
    <section class="booklet-cover booklet-back-cover" style="--accent:${accent}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      ${logo?.url ? `<img class="booklet-back-logo" src="${escapeHtml(logo.url)}" alt="" />` : ""}
      ${churchName ? `<p class="booklet-back-church">${escapeHtml(churchName)}</p>` : ""}
      <p class="booklet-back-message">${escapeHtml(message)}</p>
    </section>`;
}

function buildMissionaryPageHtml(m, index, fields) {
  const palette = PALETTE[index % PALETTE.length];
  const physical = (m.addresses || []).find((a) => a.type === "physical");
  const mailing = (m.addresses || []).find((a) => a.type === "mailing");

  return `
    <section class="booklet-page" style="--accent:${palette.accent};--tint:${palette.tint}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      ${fields.showPhoto && m.photos?.[0]?.url ? `<img class="booklet-photo" src="${escapeHtml(m.photos[0].url)}" alt="" />` : ""}
      <p class="booklet-eyebrow">${escapeHtml(m.fieldDisplayName || "")}</p>
      <h2 class="booklet-name">${escapeHtml(m.displayName)}</h2>
      ${fields.showOverview && m.overview ? `<div class="booklet-callout"><p>${escapeHtml(m.overview)}</p></div>` : ""}
      ${fields.showServingLocation ? renderAddressBlock("Serving Location", physical) : ""}
      ${fields.showMailing ? renderAddressBlock("Mailing & Contact Address", mailing) : ""}
      ${renderFamilyBlock(m, fields)}
      ${fields.showSendingParty ? renderSendingPartyBlock(m) : ""}
      <div class="booklet-footer">${escapeHtml(m.displayName)}</div>
    </section>`;
}

const TEMPLATE_OPTIONS = [
  { value: "classic", label: "Classic", description: "Warm accent-colored circles, a soft tinted callout, a circular photo — the original look." },
  { value: "modern", label: "Modern", description: "Clean and structured — no decorative shapes, bold rules, a rectangular photo, condensed sans-serif headers." },
  { value: "traditional", label: "Traditional", description: "Understated and formal — a thin bordered page frame, a small centered portrait, serif type throughout." },
];

function buildBookletHtml({
  missionaries,
  organizations = [],
  includeOrganizations = false,
  title,
  subtitle,
  fields,
  template = "classic",
  churchName,
  logo,
  aboutText,
  publicTagline,
}) {
  const generatedDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const cover = `
    <section class="booklet-cover" style="--accent:${PALETTE[0].accent}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      <h1 class="booklet-cover-title">${escapeHtml(title)}</h1>
      <p class="booklet-cover-subtitle">${escapeHtml(subtitle)}</p>
      <p class="booklet-cover-date">${escapeHtml(generatedDate)}</p>
    </section>`;

  const index = `
    <section class="booklet-index">
      <h2 class="booklet-index-title">Included Missionaries</h2>
      <ul class="booklet-index-list">
        ${missionaries
          .map(
            (m) =>
              `<li>${escapeHtml(m.displayName)}${m.fieldDisplayName ? ` — ${escapeHtml(m.fieldDisplayName)}` : ""}</li>`
          )
          .join("")}
      </ul>
    </section>`;

  // Booklet/duplex printing folds sheets in half, so opened flat, only
  // pages (2, 3), (4, 5), (6, 7)... ever actually face each other as a
  // spread — never (3, 4). For a detail page to always land facing its own
  // notes page, the pair must start on an even page number. pageCount
  // tracks the running logical page count as we build; pad() inserts a
  // blank page (a completely normal thing in real booklet layout) whenever
  // the count is currently even, right before a run of pairs begins, so
  // that run starts on the next (even) page. This assumes every page below
  // renders as exactly one physical page — a missionary/org with an
  // unusually large amount of content could still spill onto a second
  // physical page and shift everything after it out of alignment; there's
  // no way to guarantee fixed page heights in HTML/CSS without truncating
  // real data, so that's a residual edge case, not something padding fixes.
  let pageCount = 0;
  const withNotes = !!fields.showNotesPage;
  function pad() {
    if (withNotes && pageCount % 2 === 0) {
      pageCount += 1;
      return buildBlankPageHtml();
    }
    return "";
  }

  pageCount += 1; // cover
  pageCount += 1; // missionary index

  let pages = "";
  if (missionaries.length > 0) {
    pages += pad();
    pages += missionaries
      .map((m, i) => {
        const palette = PALETTE[i % PALETTE.length];
        pageCount += 1;
        const detailPage = buildMissionaryPageHtml(m, i, fields);
        let notesPage = "";
        if (withNotes) {
          pageCount += 1;
          notesPage = buildNotesPageHtml(m.displayName, palette.accent);
        }
        return detailPage + notesPage;
      })
      .join("");
  }

  let orgSection = "";
  if (includeOrganizations && organizations.length > 0) {
    const localOrgs = organizations.filter((o) => o.orgType === "Local");
    const nationalOrgs = organizations.filter((o) => o.orgType !== "Local");

    const orgIndex = `
      <section class="booklet-index">
        <h2 class="booklet-index-title">Local &amp; National Partners</h2>
        <ul class="booklet-index-list">
          ${organizations
            .map((o) => `<li>${escapeHtml(o.name)} — ${escapeHtml(o.orgType)}</li>`)
            .join("")}
        </ul>
      </section>`;
    orgSection += orgIndex;
    pageCount += 1;

    const buildOrgPages = (orgs) =>
      orgs
        .map((o, i) => {
          const palette = PALETTE[i % PALETTE.length];
          pageCount += 1;
          const detailPage = buildOrganizationPageHtml(o, i);
          let notesPage = "";
          if (withNotes) {
            pageCount += 1;
            notesPage = buildNotesPageHtml(o.name, palette.accent);
          }
          return detailPage + notesPage;
        })
        .join("");

    if (localOrgs.length) {
      orgSection += buildSectionDivider("Local Organizations", PALETTE[1].accent);
      pageCount += 1;
      orgSection += pad();
      orgSection += buildOrgPages(localOrgs);
    }
    if (nationalOrgs.length) {
      orgSection += buildSectionDivider("National Organizations", PALETTE[2].accent);
      pageCount += 1;
      orgSection += pad();
      orgSection += buildOrgPages(nationalOrgs);
    }
  }

  const backCover = buildBackCoverHtml({ churchName, logo, aboutText, publicTagline, accent: PALETTE[0].accent });

  return `<div class="tpl-${template}">${cover}${index}${pages}${orgSection}${backCover}</div>`;
}

const FIELD_OPTIONS = [
  ["showPhoto", "Photo"],
  ["showOverview", "Ministry Overview"],
  ["showServingLocation", "Serving Location"],
  ["showMailing", "Mailing & Contact Address"],
  ["showAdults", "Family: Adults & Anniversary"],
  ["showChildren", "Family: Include Children"],
  ["showSendingParty", "Sending Church/Org"],
  ["showNotesPage", "Notes & Prayer Page (facing page per entry)"],
];

export default function AdminBooklet() {
  const [missionaries, setMissionaries] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeRestricted, setIncludeRestricted] = useState(true);
  const [includeOrganizations, setIncludeOrganizations] = useState(true);
  const [fields, setFields] = useState({
    showPhoto: true,
    showOverview: true,
    showServingLocation: true,
    showMailing: true,
    showAdults: true,
    showChildren: true,
    showSendingParty: true,
    showNotesPage: true,
  });
  const [title, setTitle] = useState("Missionary Partners");
  const [subtitle, setSubtitle] = useState("Prayer & Support Directory");
  const [template, setTemplate] = useState("classic");
  const [rendering, setRendering] = useState(false);
  const previewRef = useRef(null);
  const {
    partnerTermPlural,
    usePartnerTermInAdmin,
    loading: settingsLoading,
    churchName,
    logo,
    aboutText,
    publicTagline,
  } = useSettings();

  useEffect(() => {
    fetchAdminMissionaries().then(setMissionaries).catch(console.error);
    fetchAdminOrganizations().then(setOrganizations).catch(console.error);
  }, []);

  // Settings load asynchronously, after this component's initial state is
  // already set — swap in the custom term as soon as it's ready, but only
  // if the title is still untouched (don't clobber someone's own edit).
  useEffect(() => {
    if (!settingsLoading && usePartnerTermInAdmin) {
      setTitle((current) => (current === "Missionary Partners" ? partnerTermPlural : current));
    }
  }, [settingsLoading, usePartnerTermInAdmin, partnerTermPlural]);

  function toggleField(key) {
    setFields((f) => ({ ...f, [key]: !f[key] }));
  }

  async function updatePreview() {
    setRendering(true);
    try {
      const filtered = missionaries.filter((m) => {
        const archivedOk = !m.archived || includeArchived;
        const restrictedOk = !m.isRestricted || includeRestricted;
        return archivedOk && restrictedOk;
      });
      const includedOrgs = organizations.filter((o) => !o.archived || includeArchived);
      const html = buildBookletHtml({
        missionaries: filtered,
        organizations: includedOrgs,
        includeOrganizations,
        title,
        subtitle,
        fields,
        template,
        churchName,
        logo,
        aboutText,
        publicTagline,
      });

      const { Previewer } = await import("pagedjs");
      previewRef.current.innerHTML = "";
      await new Previewer().preview(html, [bookletCssUrl], previewRef.current);
    } finally {
      setRendering(false);
    }
  }

  // Render an initial preview as soon as data loads; after that the user
  // drives content updates explicitly via the button (re-chunking with
  // paged.js isn't cheap enough to re-run on every checkbox click) --
  // template changes are the exception, re-rendering immediately, since
  // comparing looks is the whole point of having more than one and a
  // manual button press in between would just get in the way. Depends on
  // both fetches since they resolve independently — without this, a
  // preview rendered before organizations finish loading would just miss
  // that section until "Update Preview" is clicked manually.
  useEffect(() => {
    if (missionaries.length > 0) updatePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionaries, organizations, template]);

  // Calling window.print() directly on this page means the browser has to
  // print-transform the admin form/controls out of the way via CSS tricks,
  // which can flash/look off in the print preview. Opening a standalone
  // document — just the booklet content, paginated by paged.js's polyfill
  // — in its own tab avoids that entirely; printing from there is a normal
  // single-document print with nothing else on the page.
  function handleOpenPrintable() {
    const filtered = missionaries.filter((m) => {
      const archivedOk = !m.archived || includeArchived;
      const restrictedOk = !m.isRestricted || includeRestricted;
      return archivedOk && restrictedOk;
    });
    const includedOrgs = organizations.filter((o) => !o.archived || includeArchived);
    const content = buildBookletHtml({
      missionaries: filtered,
      organizations: includedOrgs,
      includeOrganizations,
      title,
      subtitle,
      fields,
      template,
      churchName,
      logo,
      aboutText,
      publicTagline,
    });
    // paged.js's polyfill re-fetches each stylesheet's raw CSS text itself
    // (via XHR) to read the @page rules — a root-relative href like
    // "/assets/booklet-XXXX.css" doesn't resolve against a blob: document's
    // base URI, so it must be absolute (with a real origin) here.
    const absoluteCssUrl = new URL(bookletCssUrl, window.location.origin).href;
    const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<link rel="stylesheet" href="${absoluteCssUrl}" />
</head>
<body>
${content}
<script src="${PAGED_POLYFILL_URL}"></script>
</body>
</html>`;
    const blobUrl = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
    window.open(blobUrl, "_blank");
  }

  return (
    <>
      <div className="admin-shell no-print">
        <h2>Missionary Booklet</h2>
        <div className="admin-form">
          <div className="admin-section">
            <h3>Look &amp; Feel</h3>
            <div className="admin-checkbox-row" style={{ gap: "1rem", flexWrap: "wrap" }}>
              {TEMPLATE_OPTIONS.map((t) => (
                <label
                  key={t.value}
                  style={{
                    flexDirection: "column",
                    alignItems: "flex-start",
                    border: template === t.value ? "2px solid #333" : "1px solid #ddd",
                    borderRadius: "8px",
                    padding: "0.6rem 0.75rem",
                    maxWidth: "16rem",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: "bold" }}>
                    <input
                      type="radio"
                      name="booklet-template"
                      checked={template === t.value}
                      onChange={() => setTemplate(t.value)}
                    />
                    {t.label}
                  </span>
                  <span style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>{t.description}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="admin-section">
            <h3>Who's Included</h3>
            <div className="admin-checkbox-row">
              <label>
                <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
                Archived
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={includeRestricted}
                  onChange={(e) => setIncludeRestricted(e.target.checked)}
                />
                Restricted-access
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={includeOrganizations}
                  onChange={(e) => setIncludeOrganizations(e.target.checked)}
                />
                Local &amp; National Organizations
              </label>
            </div>
          </div>

          <div className="admin-section">
            <h3>What Shows on Each Page</h3>
            <div className="admin-checkbox-row">
              {FIELD_OPTIONS.map(([key, label]) => (
                <label key={key}>
                  <input type="checkbox" checked={fields[key]} onChange={() => toggleField(key)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="admin-section">
            <h3>Cover Page Text</h3>
            <div className="form-grid">
              <label>
                Booklet Title
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label>
                Subtitle
                <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
              </label>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button className="btn" onClick={updatePreview} disabled={rendering}>
              {rendering ? "Rendering..." : "Update Preview"}
            </button>
            <button className="btn secondary" onClick={handleOpenPrintable}>
              Open in New Tab to Print
            </button>
          </div>
        </div>
      </div>

      <div ref={previewRef} className="booklet-preview" />
    </>
  );
}
