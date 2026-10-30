import React, { useEffect, useMemo, useState } from "react";
import { fetchPartners, fetchChurchSettings } from "../api/client.js";
import "../styles/booklet.css";
import { useSettings } from "../context/SettingsContext.jsx";
import { formatDateLong } from "../utils/format.js";

// Every page-producing template below ends with this exact placeholder.
// buildBookletHtml does one pass over the fully-assembled document at the
// very end, replacing each occurrence in document order with that page's
// real number (see the comment there). A literal, unlikely-to-collide
// token rather than a template parameter threaded through every builder
// function and every call site -- the old pagedjs-based version tracked a
// hand-maintained `pageCount` integer in parallel with the actual HTML
// being built, across several branches (missionaries / local orgs /
// national orgs / notes on or off), which is exactly the kind of
// bookkeeping that's easy to get subtly wrong. Numbering driven by what
// literally ends up in the final HTML can't drift from it.
const PAGE_NUM = "@@BOOKLET_PAGE_NUM@@";
function pageNumberMarkup() {
  return `<div class="booklet-page-number">${PAGE_NUM}</div>`;
}

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
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// Date-only fields are UTC-midnight ISO strings — build the Date from raw
// Y/M/D components (not new Date(isoString)) to avoid a timezone-shift
// off-by-one-day bug, matching AdminMissionaryDetail.jsx's formatDate.

function renderAddressBlock(label, address) {
  if (!address) return "";
  const lines = [address.addressLine1, address.addressLine2].filter(Boolean);
  const cityLine = [address.city, address.stateProvinceRegion, address.postalCode].filter(Boolean).join(", ");
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
    if (m.anniversary)
      rows.push(
        `<p><strong>Anniversary:</strong> ${escapeHtml(formatDateLong(m.anniversary, { fallback: "" }))}</p>`
      );
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
        `<p><em>Child</em> — ${escapeHtml(c.name)}${c.birthday ? ` — ${escapeHtml(formatDateLong(c.birthday, { fallback: "" }))}` : ""}</p>`
      );
    });
  }
  if (!rows.length) return "";
  return `<div class="booklet-block"><h3>Family</h3>${rows.join("")}</div>`;
}

// The booklet is meant to be printed and handed out, same audience as
// the public site -- so this starts from the identical visibility rule
// (strategic + explicitly marked public) rather than trusting the admin
// data source's full list, which includes situational/private ones too.
// includeInBooklet narrows further (a request can be public-site-only),
// and maxPerPartner caps how many actually print -- a partner could have
// a dozen public strategic requests on file over time, and a full printed
// page of them would crowd out everything else, so this takes the most
// recent maxPerPartner (already the API's own ordering, see
// routes/prayerRequests.js). No "ongoing"/"untracked" callout here either,
// same reasoning as PublicPartnerDetail.jsx and PrayerRequestSection.jsx.
function renderPrayerRequestsBlock(entity, maxPerPartner) {
  const requests = (entity.prayerRequests || [])
    .filter((p) => p.category === "strategic" && p.isPublic && p.includeInBooklet)
    .slice(0, maxPerPartner);
  if (!requests.length) return "";
  const items = requests
    .map((p) => {
      const answered =
        p.status === "answered"
          ? `<p style="margin: 0.15rem 0 0; font-size: 9pt; color: #666;">✓ Answered${p.dateAnswered ? ` ${escapeHtml(formatDateLong(p.dateAnswered, { fallback: "" }))}` : ""}${p.answeredNote ? ` — ${escapeHtml(p.answeredNote)}` : ""}</p>`
          : "";
      return `<p style="margin: 0 0 0.1in;">${escapeHtml(p.requestText)}</p>${answered}`;
    })
    .join("");
  return `<div class="booklet-block"><h3>Prayer Requests</h3>${items}</div>`;
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
      ${pageNumberMarkup()}
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
      ${pageNumberMarkup()}
    </section>`;
}

// One page per organization — leaner than a missionary page (no family/trip
// capacity), just the fields explicitly asked for: type/region, supporting
// since, contact info, overview, and focus.
function buildOrganizationPageHtml(o, index, maxPrayerRequests) {
  const palette = PALETTE[index % PALETTE.length];
  const eyebrow = [o.orgType, o.fieldDisplayName].filter(Boolean).join(" · ");

  return `
    <section class="booklet-page" style="--accent:${palette.accent};--tint:${palette.tint}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      <p class="booklet-eyebrow">${escapeHtml(eyebrow)}</p>
      <h2 class="booklet-name">${escapeHtml(o.displayName)}</h2>
      ${o.supportingSince ? `<p class="booklet-supporting-since">Partnering since ${escapeHtml(formatDateLong(o.supportingSince, { fallback: "" }))}</p>` : ""}
      ${renderOrgContactBlock(o)}
      ${o.overview ? `<div class="booklet-callout"><p>${escapeHtml(o.overview)}</p></div>` : ""}
      ${o.focusArea ? `<div class="booklet-block"><h3>Focus Area</h3><p>${escapeHtml(o.focusArea)}</p></div>` : ""}
      ${renderPrayerRequestsBlock(o, maxPrayerRequests)}
      <div class="booklet-footer">${escapeHtml(o.displayName)}</div>
      ${pageNumberMarkup()}
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
      ${pageNumberMarkup()}
    </section>`;
}

// Lines of a postal address, formatted the same way renderAddressBlock does
// for a partner's own addresses -- street line(s), then city/state/zip,
// then country -- but as plain strings rather than that function's
// labelled <div>, since the back cover has no section heading to attach to.
function formatAddressLines(address) {
  if (!address) return [];
  const lines = [address.addressLine1, address.addressLine2].filter(Boolean);
  const cityLine = [address.city, address.stateProvinceRegion, address.postalCode].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (address.country) lines.push(address.country);
  return lines;
}

// Closing page, always last — simpler than the front cover by design (every
// reference booklet layout this template set drew from treats the back
// cover as a plain sign-off, never a repeat of the front cover): the
// church's logo, name, mailing address, phone and website -- contact
// information for whoever wants to get in touch after reading, not a
// restatement of the church's public tagline/about text (that's cover-page
// or website material, and repeating it here read as filler). A church
// with none of these configured gets a plain closing page with only the
// decorative shapes, which is honest about there being nothing to put
// there rather than inventing text.
function buildBackCoverHtml({ churchName, logo, address, phone, websiteLink, accent }) {
  const addressLines = formatAddressLines(address);
  return `
    <section class="booklet-cover booklet-back-cover" style="--accent:${accent}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      ${logo?.url ? `<img class="booklet-back-logo" src="${escapeHtml(logo.url)}" alt="" />` : ""}
      ${churchName ? `<p class="booklet-back-church">${escapeHtml(churchName)}</p>` : ""}
      ${addressLines.length ? `<p class="booklet-back-address">${addressLines.map(escapeHtml).join("<br />")}</p>` : ""}
      ${
        phone || websiteLink
          ? `<p class="booklet-back-contact">${[phone, websiteLink].filter(Boolean).map(escapeHtml).join(" · ")}</p>`
          : ""
      }
      ${pageNumberMarkup()}
    </section>`;
}

function buildMissionaryPageHtml(m, index, fields, maxPrayerRequests) {
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
      ${fields.showPrayerRequests ? renderPrayerRequestsBlock(m, maxPrayerRequests) : ""}
      <div class="booklet-footer">${escapeHtml(m.displayName)}</div>
      ${pageNumberMarkup()}
    </section>`;
}

const TEMPLATE_OPTIONS = [
  {
    value: "classic",
    label: "Classic",
    description: "Warm accent-colored circles, a soft tinted callout, a circular photo — the original look.",
  },
  {
    value: "modern",
    label: "Modern",
    description:
      "Clean and structured — no decorative shapes, bold rules, a rectangular photo, condensed sans-serif headers.",
  },
  {
    value: "traditional",
    label: "Traditional",
    description:
      "Understated and formal — a thin bordered page frame, a small centered portrait, serif type throughout.",
  },
  {
    value: "keepsake",
    label: "Keepsake",
    description:
      "Warm and personal — a polaroid-framed, slightly tilted photo, a handwritten-note callout, soft cream background.",
  },
  {
    value: "portfolio",
    label: "Portfolio",
    description:
      "Photo-led and minimal — a large full-width photo, high-contrast dark header, light caption-style text.",
  },
  {
    value: "friendly",
    label: "Friendly",
    description:
      "Bright and casual — a bold color-block header, a large circular photo, rounded pill-style info rows.",
  },
];

function buildBookletHtml({
  missionaries,
  organizations = [],
  includeOrganizations = false,
  title,
  subtitle,
  fields,
  maxPrayerRequests = 4,
  template = "classic",
  churchName,
  logo,
  address,
  phone,
  websiteLink,
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
      ${pageNumberMarkup()}
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
      ${pageNumberMarkup()}
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
        const detailPage = buildMissionaryPageHtml(m, i, fields, maxPrayerRequests);
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
            .map((o) => `<li>${escapeHtml(o.displayName)} — ${escapeHtml(o.orgType)}</li>`)
            .join("")}
        </ul>
        ${pageNumberMarkup()}
      </section>`;
    orgSection += orgIndex;
    pageCount += 1;

    const buildOrgPages = (orgs) =>
      orgs
        .map((o, i) => {
          const palette = PALETTE[i % PALETTE.length];
          pageCount += 1;
          const detailPage = buildOrganizationPageHtml(o, i, maxPrayerRequests);
          let notesPage = "";
          if (withNotes) {
            pageCount += 1;
            notesPage = buildNotesPageHtml(o.displayName, palette.accent);
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

  const backCover = buildBackCoverHtml({
    churchName,
    logo,
    address,
    phone,
    websiteLink,
    accent: PALETTE[0].accent,
  });

  const assembled = `<div class="tpl-${template}">${cover}${index}${pages}${orgSection}${backCover}</div>`;

  // One pass, numbering every PAGE_NUM placeholder in the order it
  // actually appears in the document -- see the constant's own comment for
  // why this replaces a hand-maintained running counter.
  let pageNumber = 0;
  return assembled.replaceAll(PAGE_NUM, () => String(++pageNumber));
}

const FIELD_OPTIONS = [
  ["showPhoto", "Photo"],
  ["showOverview", "Ministry Overview"],
  ["showServingLocation", "Serving Location"],
  ["showMailing", "Mailing & Contact Address"],
  ["showAdults", "Family: Adults & Anniversary"],
  ["showChildren", "Family: Include Children"],
  ["showSendingParty", "Sending Church/Org"],
  [
    "showPrayerRequests",
    "Prayer Requests",
    'Only strategic requests marked both "Show on public profile" and "Include in printed booklet" -- capped per partner below.',
  ],
  ["showNotesPage", "Notes & Prayer Page (facing page per entry)"],
];

export default function AdminBooklet() {
  const [partners, setPartners] = useState([]);
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
    showPrayerRequests: true,
    showNotesPage: true,
  });
  const [title, setTitle] = useState("Missionary Partners");
  const [subtitle, setSubtitle] = useState("Prayer & Support Directory");
  const [maxPrayerRequests, setMaxPrayerRequests] = useState(4);
  const [template, setTemplate] = useState("classic");
  const {
    partnerTermPlural,
    usePartnerTermInAdmin,
    loading: settingsLoading,
    churchName,
    logo,
  } = useSettings();
  // address/phone/websiteLink are withheld from the shared public-settings
  // payload on purpose (SettingsContext is read even by logged-out
  // visitors) -- fetched here specifically for the back cover, which is
  // only ever rendered on this admin-only page.
  const [churchContact, setChurchContact] = useState({});

  // The booklet lays out each partner's family, addresses, sending party
  // and prayer requests, so this is the one page that asks for the full
  // record set rather than summary rows.
  useEffect(() => {
    fetchPartners({ include: "full" }).then(setPartners).catch(console.error);
    fetchChurchSettings()
      .then((s) => setChurchContact({ address: s.address, phone: s.phone, websiteLink: s.websiteLink }))
      .catch(console.error);
  }, []);

  const missionaries = useMemo(() => partners.filter((p) => p.kind === "missionary"), [partners]);
  const organizations = useMemo(() => partners.filter((p) => p.kind === "organization"), [partners]);

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

  // Synchronous now that paged.js is gone -- building the HTML string is
  // just string concatenation, so there's no reason to gate it behind a
  // button the way the old async pagedjs render was. Depends on
  // churchContact (an object, replaced wholesale by its own effect above)
  // rather than its individual fields, which is fine: it's never mutated
  // in place, only ever replaced.
  const previewHtml = useMemo(() => {
    const filtered = missionaries.filter((m) => {
      const archivedOk = !m.archived || includeArchived;
      const restrictedOk = !m.isRestricted || includeRestricted;
      return archivedOk && restrictedOk;
    });
    const includedOrgs = organizations.filter((o) => !o.archived || includeArchived);
    return buildBookletHtml({
      missionaries: filtered,
      organizations: includedOrgs,
      includeOrganizations,
      title,
      subtitle,
      fields,
      maxPrayerRequests,
      template,
      churchName,
      logo,
      ...churchContact,
    });
  }, [
    missionaries,
    organizations,
    includeArchived,
    includeRestricted,
    includeOrganizations,
    title,
    subtitle,
    fields,
    maxPrayerRequests,
    template,
    churchName,
    logo,
    churchContact,
  ]);

  // `.booklet-preview` below renders previewHtml directly -- same origin,
  // same document, ordinary root-relative image URLs that resolve
  // normally, native @page/break-after pagination instead of a polyfill.
  // Printing it is an ordinary window.print() with nothing else on the
  // page: index.css already hides everything but .booklet-preview on
  // print (the same rule Reports relies on), so there's no second render
  // pass and no third-party script in the loop at all.
  function handlePrint() {
    window.print();
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
                  <span style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                    {t.description}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="admin-section">
            <h3>Who's Included</h3>
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                />
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
              {FIELD_OPTIONS.map(([key, label, tooltip]) => (
                <label key={key} title={tooltip}>
                  <input type="checkbox" checked={fields[key]} onChange={() => toggleField(key)} />
                  {label}
                </label>
              ))}
            </div>
            {fields.showPrayerRequests && (
              <label
                style={{ marginTop: "0.75rem", maxWidth: "16rem" }}
                title="Even a partner with many eligible requests only shows this many, most recent first, so the section doesn't crowd out the rest of their page."
              >
                Max prayer requests per partner
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={maxPrayerRequests}
                  onChange={(e) => setMaxPrayerRequests(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            )}
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
            <button className="btn" onClick={handlePrint}>
              Print Booklet
            </button>
          </div>
        </div>
      </div>

      <div className="booklet-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
    </>
  );
}
