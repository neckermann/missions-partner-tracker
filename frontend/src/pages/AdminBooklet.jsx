import { methodLabel } from "../utils/contactMethods.js";
import React, { useEffect, useMemo, useState } from "react";
import { formatPhone } from "../utils/phone.js";
import { fetchPartners } from "../api/client.js";
import "../styles/booklet.css";
import { useSettings } from "../context/SettingsContext.jsx";
import useChurchSettings from "../hooks/useChurchSettings.js";
import { formatDateLong } from "../utils/format.js";
import { addressByType } from "../utils/addresses.js";
import {
  TEMPLATE_OPTIONS,
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  resolveAccent,
  templateWrapperMarkup,
} from "../booklet/templates.js";

// Every page-producing template ends with this placeholder. buildBookletHtml makes one pass
// over the finished document and replaces each occurrence, in order, with that page's number,
// so numbering can't drift from what is actually in the HTML (no parallel page counter).
const PAGE_NUM = "@@BOOKLET_PAGE_NUM@@";
function pageNumberMarkup() {
  return `<div class="booklet-page-number">${PAGE_NUM}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// Date-only fields are UTC-midnight ISO strings: build the Date from Y/M/D components, not
// new Date(isoString), to avoid a timezone off-by-one-day.

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

// Adults and children are separate DB tables but display as one "Family" unit.
// `fields.showAdults`/`fields.showChildren` gate each half independently.
function renderFamilyBlock(m, fields) {
  const rows = [];
  if (fields.showAdults) {
    if (m.anniversary)
      rows.push(
        `<p><strong>Anniversary:</strong> ${escapeHtml(formatDateLong(m.anniversary, { fallback: "" }))}</p>`
      );
    // A partner NOT safe to contact must not have their phone, email or preferred method
    // printed in a handed-out booklet. Names still print; staff-only special instructions
    // (which may say why) never do.
    const withhold = m.contactLevel === "no_direct";
    const primary = (m.adults || []).find((a) => a.isPrimaryContact) || (m.adults || [])[0];
    if (withhold) {
      rows.push("<p><strong>Contact:</strong> Details withheld.</p>");
    } else if (primary?.contactMethod) {
      rows.push(
        `<p><strong>Preferred Contact:</strong> ${escapeHtml(methodLabel(primary.contactMethod, primary.contactMethodNote))}</p>`
      );
    }
    (m.adults || []).forEach((a) => {
      const parts = withhold ? [] : [formatPhone(a.phone1), a.email].filter(Boolean).map(escapeHtml);
      const name = [a.firstName, a.lastName].filter(Boolean).join(" ");
      rows.push(`<p>${escapeHtml(name)}${parts.length ? ` — ${parts.join(" · ")}` : ""}</p>`);
    });
  }
  if (fields.showChildren) {
    (m.children || []).forEach((c) => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
      rows.push(
        `<p><em>Child</em> — ${escapeHtml(name)}${c.birthday ? ` — ${escapeHtml(formatDateLong(c.birthday, { fallback: "" }))}` : ""}</p>`
      );
    });
  }
  if (!rows.length) return "";
  return `<div class="booklet-block"><h3>Family</h3>${rows.join("")}</div>`;
}

// The booklet is printed and handed out, so this starts from the public site's visibility rule
// (strategic + explicitly public), not the admin list, which includes private requests.
// includeInBooklet narrows further; maxPerPartner caps how many print (most recent, the API's
// own ordering). No "ongoing"/"untracked" callout, as in PublicPartnerDetail.jsx.
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

// contactFirstName/contactLastName are composed into one display string here, at render time.
function contactFullName(entity) {
  return [entity?.contactFirstName, entity?.contactLastName].filter(Boolean).join(" ");
}

// `withhold` (partner not safe to contact): the church or organization's name still prints,
// but not its contact person or phone, which would be a way to reach the partner.
function renderSendingPartyBlock(m, withhold = false) {
  const parts = [];
  if (m.sendingChurch?.name) {
    const bits = withhold
      ? []
      : [contactFullName(m.sendingChurch), formatPhone(m.sendingChurch.phone)]
          .filter(Boolean)
          .map(escapeHtml);
    parts.push(
      `<p><strong>Sending Church:</strong> ${escapeHtml(m.sendingChurch.name)}${bits.length ? ` — ${bits.join(" · ")}` : ""}</p>`
    );
  }
  if (m.sendingOrg?.name) {
    const bits = withhold
      ? []
      : [contactFullName(m.sendingOrg), formatPhone(m.sendingOrg.phone)].filter(Boolean).map(escapeHtml);
    parts.push(
      `<p><strong>Sending Org:</strong> ${escapeHtml(m.sendingOrg.name)}${bits.length ? ` — ${bits.join(" · ")}` : ""}</p>`
    );
  }
  if (!parts.length) return "";
  return `<div class="booklet-block"><h3>Sending Church / Org</h3>${parts.join("")}</div>`;
}

function renderOrgContactBlock(o) {
  const rows = [];
  const contactName = contactFullName(o);
  if (contactName) rows.push(`<p><strong>Contact:</strong> ${escapeHtml(contactName)}</p>`);
  if (o.contactPhone) rows.push(`<p><strong>Phone:</strong> ${escapeHtml(formatPhone(o.contactPhone))}</p>`);
  if (o.contactEmail) rows.push(`<p><strong>Email:</strong> ${escapeHtml(o.contactEmail)}</p>`);
  const website = (o.links || []).find((l) => l.type === "website")?.url;
  if (website) rows.push(`<p><strong>Website:</strong> ${escapeHtml(website)}</p>`);
  if (!rows.length) return "";
  return `<div class="booklet-block"><h3>Contact Info</h3>${rows.join("")}</div>`;
}

// A facing page for the entry's prayer requests, then ruled lines for handwritten notes.
// Inserted right after the entry's detail page so the detail layout never changes.
function buildNotesPageHtml(entity, accent, showPrayerRequests, maxPrayerRequests) {
  return `
    <section class="booklet-page booklet-notes-page" style="--accent:${accent}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      <h2 class="booklet-notes-heading">Notes &amp; Prayer Requests</h2>
      <p class="booklet-notes-subheading">${escapeHtml(entity.displayName)}</p>
      ${showPrayerRequests ? renderPrayerRequestsBlock(entity, maxPrayerRequests) : ""}
      <div class="booklet-notes-lines"></div>
      ${pageNumberMarkup()}
    </section>`;
}

// A blank page used only to fix print alignment (see pad() in buildBookletHtml); labeled so it
// doesn't look like a printing error.
function buildBlankPageHtml() {
  return `
    <section class="booklet-page booklet-blank-page">
      <p>This page is intentionally left blank.</p>
      ${pageNumberMarkup()}
    </section>`;
}

// One page per organization: type/region, supporting since, contact info, overview, focus.
function buildOrganizationPageHtml(o, accent) {
  const eyebrow = [o.orgType, o.fieldDisplayName].filter(Boolean).join(" · ");

  return `
    <section class="booklet-page" style="--accent:${accent}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      <p class="booklet-eyebrow">${escapeHtml(eyebrow)}</p>
      <h2 class="booklet-name">${escapeHtml(o.displayName)}</h2>
      ${o.supportingSince ? `<p class="booklet-supporting-since">Partnering since ${escapeHtml(formatDateLong(o.supportingSince, { fallback: "" }))}</p>` : ""}
      ${renderOrgContactBlock(o)}
      ${o.overview ? `<div class="booklet-callout"><p>${escapeHtml(o.overview)}</p></div>` : ""}
      ${o.focusArea ? `<div class="booklet-block"><h3>Focus Area</h3><p>${escapeHtml(o.focusArea)}</p></div>` : ""}
      <div class="booklet-footer">${escapeHtml(o.displayName)}</div>
      ${pageNumberMarkup()}
    </section>`;
}

// A divider page (cover styling) starting the Local or National organizations section.
function buildSectionDivider(title, accent) {
  return `
    <section class="booklet-cover" style="--accent:${accent}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      <h1 class="booklet-cover-title" style="font-size: 36pt;">${escapeHtml(title)}</h1>
      ${pageNumberMarkup()}
    </section>`;
}

// Address lines formatted like renderAddressBlock, but as plain strings (the back cover has
// no section heading).
function formatAddressLines(address) {
  if (!address) return [];
  const lines = [address.addressLine1, address.addressLine2].filter(Boolean);
  const cityLine = [address.city, address.stateProvinceRegion, address.postalCode].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (address.country) lines.push(address.country);
  return lines;
}

// Closing page, always last: the church's logo, name, mailing address, phone and website,
// deliberately not a repeat of the tagline/about text. With none configured it is just the
// decorative shapes.
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

function buildMissionaryPageHtml(m, accent, fields) {
  const physical = addressByType(m.addresses, "physical");
  const mailing = addressByType(m.addresses, "mailing");
  // A partner not safe to contact prints no address either, nor their sending party's contact
  // details; the name and the family's names still print.
  const unsafe = m.contactLevel === "no_direct";

  return `
    <section class="booklet-page" style="--accent:${accent}">
      <div class="booklet-shape shape-a"></div>
      <div class="booklet-shape shape-b"></div>
      ${fields.showPhoto && m.photos?.[0]?.url ? `<img class="booklet-photo" src="${escapeHtml(m.photos[0].rawUrl || m.photos[0].url)}" alt="" />` : ""}
      <p class="booklet-eyebrow">${escapeHtml(m.fieldDisplayName || "")}</p>
      <h2 class="booklet-name">${escapeHtml(m.displayName)}</h2>
      ${fields.showOverview && m.overview ? `<div class="booklet-callout"><p>${escapeHtml(m.overview)}</p></div>` : ""}
      ${fields.showServingLocation && !unsafe ? renderAddressBlock("Serving Location", physical) : ""}
      ${fields.showMailing && !unsafe ? renderAddressBlock("Mailing & Contact Address", mailing) : ""}
      ${renderFamilyBlock(m, fields)}
      ${fields.showSendingParty ? renderSendingPartyBlock(m, unsafe) : ""}
      <div class="booklet-footer">${escapeHtml(m.displayName)}</div>
      ${pageNumberMarkup()}
    </section>`;
}

function buildBookletHtml({
  missionaries,
  organizations = [],
  includeOrganizations = false,
  title,
  subtitle,
  fields,
  maxPrayerRequests = 4,
  template = DEFAULT_TEMPLATE_ID,
  primaryColor,
  churchName,
  logo,
  address,
  phone,
  websiteLink,
}) {
  const templateObj = getTemplate(template);
  const generatedDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const cover = `
    <section class="booklet-cover" style="--accent:${resolveAccent(templateObj, primaryColor, 0)}">
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

  // Duplex booklet printing folds sheets, so only pages (2,3), (4,5)... face each other.
  // For a detail page to face its notes page, the pair must start on an even page number:
  // pageCount tracks the logical count and pad() inserts a blank page when it is even,
  // right before a run of pairs. Assumes each page renders as one physical page; overflowing
  // content would shift later pages, and HTML/CSS can't fix page heights without truncating data.
  let pageCount = 0;
  // Prayer requests only render on the notes page. The UI forces showNotesPage whenever
  // showPrayerRequests is on; this guards the invariant for other callers too.
  const withNotes = !!(fields.showNotesPage || fields.showPrayerRequests);
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
        const accent = resolveAccent(templateObj, primaryColor, i);
        pageCount += 1;
        const detailPage = buildMissionaryPageHtml(m, accent, fields);
        let notesPage = "";
        if (withNotes) {
          pageCount += 1;
          notesPage = buildNotesPageHtml(m, accent, fields.showPrayerRequests, maxPrayerRequests);
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
          const accent = resolveAccent(templateObj, primaryColor, i);
          pageCount += 1;
          const detailPage = buildOrganizationPageHtml(o, accent);
          let notesPage = "";
          if (withNotes) {
            pageCount += 1;
            notesPage = buildNotesPageHtml(o, accent, fields.showPrayerRequests, maxPrayerRequests);
          }
          return detailPage + notesPage;
        })
        .join("");

    if (localOrgs.length) {
      orgSection += buildSectionDivider("Local Organizations", resolveAccent(templateObj, primaryColor, 1));
      pageCount += 1;
      orgSection += pad();
      orgSection += buildOrgPages(localOrgs);
    }
    if (nationalOrgs.length) {
      orgSection += buildSectionDivider(
        "National Organizations",
        resolveAccent(templateObj, primaryColor, 2)
      );
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
    accent: resolveAccent(templateObj, primaryColor, 0),
  });

  // The template catalog's token set (booklet/templates.js) drives this wrapper's data-*
  // attributes and --tpl-* properties, which booklet.css reads.
  const { attrString, styleString } = templateWrapperMarkup(templateObj);
  const assembled = `<div class="booklet-doc" ${attrString} style="${styleString}">${cover}${index}${pages}${orgSection}${backCover}</div>`;

  // Number every PAGE_NUM placeholder in document order (see the constant).
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
    'Printed at the top of each entry\'s Notes & Prayer page, which this turns on too. Only ministry requests marked both "Show on public profile" and "Include in printed booklet" -- capped per partner below.',
  ],
  ["showNotesPage", "Notes & Prayer Page (facing page per entry)"],
];

export default function AdminBooklet() {
  const [partners, setPartners] = useState([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  // Off by default: a restricted partner prints with their real name and details, so including them is a choice.
  const [includeRestricted, setIncludeRestricted] = useState(false);
  const [includeOrganizations, setIncludeOrganizations] = useState(true);
  const [fields, setFields] = useState({
    showPhoto: true,
    showOverview: true,
    showServingLocation: true,
    showMailing: true,
    showAdults: true,
    showChildren: true,
    showSendingParty: true,
    showPrayerRequests: false,
    showNotesPage: false,
  });
  const [title, setTitle] = useState("Missionary Partners");
  const [subtitle, setSubtitle] = useState("Prayer & Support Directory");
  const [maxPrayerRequests, setMaxPrayerRequests] = useState(4);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE_ID);
  const {
    partnerTermPlural,
    usePartnerTermInAdmin,
    loading: settingsLoading,
    churchName,
    logo,
    primaryColor,
  } = useSettings();
  // address/phone/websiteLink are withheld from the public-settings payload on purpose
  // (SettingsContext is read by logged-out visitors); fetched here for the back cover,
  // which only renders on this admin-only page.
  const [churchContact, setChurchContact] = useState({});

  // The booklet needs family, addresses, sending party and prayer requests: the full record set.
  useEffect(() => {
    fetchPartners({ include: "full" }).then(setPartners).catch(console.error);
  }, []);
  const { settings: churchSettings } = useChurchSettings();
  useEffect(() => {
    if (churchSettings) {
      setChurchContact({
        // ChurchSettings address fields are flat columns; rebuild the nested shape
        // formatAddressLines/buildBackCoverHtml expect.
        address: {
          addressLine1: churchSettings.addressLine1,
          addressLine2: churchSettings.addressLine2,
          city: churchSettings.city,
          stateProvinceRegion: churchSettings.stateProvinceRegion,
          postalCode: churchSettings.postalCode,
          country: churchSettings.country,
        },
        phone: churchSettings.phone,
        websiteLink: churchSettings.websiteLink,
      });
    }
  }, [churchSettings]);

  const missionaries = useMemo(() => partners.filter((p) => p.kind === "missionary"), [partners]);
  const organizations = useMemo(() => partners.filter((p) => p.kind === "organization"), [partners]);

  // Settings load asynchronously: swap in the custom term once ready, but only if the title
  // is still untouched.
  useEffect(() => {
    if (!settingsLoading && usePartnerTermInAdmin) {
      setTitle((current) => (current === "Missionary Partners" ? partnerTermPlural : current));
    }
  }, [settingsLoading, usePartnerTermInAdmin, partnerTermPlural]);

  function toggleField(key) {
    setFields((f) => {
      const next = { ...f, [key]: !f[key] };
      // Prayer requests only print on the Notes & Prayer page, so turning them on brings that
      // page with it (the checkbox is disabled while on, so the states can't diverge).
      if (key === "showPrayerRequests" && next.showPrayerRequests) next.showNotesPage = true;
      return next;
    });
  }

  // How many restricted partners the booklet would print with the box ticked, under the other choices.
  const restrictedCount =
    missionaries.filter((m) => m.isRestricted && (!m.archived || includeArchived)).length +
    (includeOrganizations
      ? organizations.filter((o) => o.isRestricted && (!o.archived || includeArchived)).length
      : 0);

  // Depends on churchContact (replaced wholesale by its effect, never mutated) rather than
  // its individual fields.
  const previewHtml = useMemo(() => {
    const filtered = missionaries.filter((m) => {
      const archivedOk = !m.archived || includeArchived;
      const restrictedOk = !m.isRestricted || includeRestricted;
      return archivedOk && restrictedOk;
    });
    const includedOrgs = organizations.filter((o) => {
      const archivedOk = !o.archived || includeArchived;
      const restrictedOk = !o.isRestricted || includeRestricted;
      return archivedOk && restrictedOk;
    });
    return buildBookletHtml({
      missionaries: filtered,
      organizations: includedOrgs,
      includeOrganizations,
      title,
      subtitle,
      fields,
      maxPrayerRequests,
      template,
      primaryColor,
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
    primaryColor,
    churchName,
    logo,
    churchContact,
  ]);

  // `.booklet-preview` renders previewHtml directly; printing is a plain window.print().
  // index.css hides everything but .booklet-preview on print (same rule Reports uses).
  function handlePrint() {
    window.print();
  }

  // Two-pane layout (.booklet-layout, index.css): controls left, live preview pinned right.
  // Only .booklet-controls carries `no-print`; the preview must stay outside that wrapper
  // because it is what Print Booklet prints.
  return (
    <div className="admin-shell booklet-admin-shell">
      <div className="booklet-layout">
        <div className="booklet-controls no-print">
          <h2>Missionary Booklet</h2>
          <p className="booklet-admin-intro">
            Choose a template, pick who and what's included, then print or save as a PDF. The preview updates
            as you go.
          </p>

          <div className="admin-form">
            <div className="admin-section">
              <h3>Look &amp; Feel</h3>
              <div className="booklet-template-picker">
                {TEMPLATE_OPTIONS.map((t) => {
                  // A visual hint driven by the same tokens as templates.js/booklet.css
                  // (shapeStyle/photoShape/frameStyle); accent uses resolveAccent() so it
                  // reflects the church's brand color.
                  const tpl = getTemplate(t.value);
                  const accent = resolveAccent(tpl, primaryColor, 0);
                  const selected = template === t.value;
                  return (
                    <label key={t.value} className={`booklet-template-card${selected ? " selected" : ""}`}>
                      <div
                        className="booklet-template-swatch"
                        style={{ "--accent": accent }}
                        data-shape-style={tpl.tokens.shapeStyle}
                        data-photo-shape={tpl.tokens.photoShape}
                        data-frame-style={tpl.tokens.frameStyle}
                        aria-hidden="true"
                      >
                        <span className="booklet-template-swatch-shape" />
                        <span className="booklet-template-swatch-photo" />
                        <span className="booklet-template-swatch-rule" />
                        <span className="booklet-template-swatch-lines">
                          <span />
                          <span />
                          <span />
                        </span>
                      </div>
                      <span className="booklet-template-card-title">
                        <input
                          type="radio"
                          name="booklet-template"
                          checked={selected}
                          onChange={() => setTemplate(t.value)}
                        />
                        {t.label}
                      </span>
                      <span className="booklet-template-card-desc">{t.description}</span>
                    </label>
                  );
                })}
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
              {includeRestricted && (
                <p role="status" style={{ color: "var(--warn)", fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
                  {restrictedCount === 1
                    ? "1 restricted-access partner is included."
                    : `${restrictedCount} restricted-access partners are included.`}{" "}
                  They print with their real names and details, so hand this booklet only to people who may
                  see them.
                </p>
              )}
            </div>

            <div className="admin-section">
              <h3>What Shows on Each Page</h3>
              <div className="booklet-field-grid">
                {FIELD_OPTIONS.map(([key, label, tooltip]) => {
                  // Prayer requests print on the Notes & Prayer page, so it can't be turned
                  // off while they show.
                  const lockedOn = key === "showNotesPage" && fields.showPrayerRequests;
                  const on = fields[key];
                  return (
                    <label
                      key={key}
                      className={`booklet-field-chip${on ? " on" : ""}${lockedOn ? " locked" : ""}`}
                      title={lockedOn ? "Required while Prayer Requests is on" : tooltip}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={lockedOn}
                        onChange={() => toggleField(key)}
                      />
                      <span className="booklet-field-chip-dot" aria-hidden="true" />
                      {label}
                    </label>
                  );
                })}
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
          </div>

          <div className="booklet-print-bar">
            <button className="btn" onClick={handlePrint}>
              Print Booklet
            </button>
          </div>
        </div>

        <div className="booklet-preview-pane">
          <div className="booklet-preview-scroll">
            <div className="booklet-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      </div>
    </div>
  );
}
