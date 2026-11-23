import React, { useEffect, useMemo, useState } from "react";
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

// Accent color resolution (ChurchSettings.primaryColor as the default,
// falling back to a fixed rotation only when no brand color is set) now
// lives in booklet/templates.js's resolveAccent() -- see its own comment
// for why, and for the fallback list itself (#322).

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

// #257/#271 Finding 4: contactFirstName/contactLastName replace the old
// single contactName field -- composed back into one display string
// only here, at render time.
function contactFullName(entity) {
  return [entity?.contactFirstName, entity?.contactLastName].filter(Boolean).join(" ");
}

function renderSendingPartyBlock(m) {
  const parts = [];
  if (m.sendingChurch?.name) {
    const bits = [contactFullName(m.sendingChurch), m.sendingChurch.phone].filter(Boolean).map(escapeHtml);
    parts.push(
      `<p><strong>Sending Church:</strong> ${escapeHtml(m.sendingChurch.name)}${bits.length ? ` — ${bits.join(" · ")}` : ""}</p>`
    );
  }
  if (m.sendingOrg?.name) {
    const bits = [contactFullName(m.sendingOrg), m.sendingOrg.phone].filter(Boolean).map(escapeHtml);
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
  if (o.contactPhone) rows.push(`<p><strong>Phone:</strong> ${escapeHtml(o.contactPhone)}</p>`);
  if (o.contactEmail) rows.push(`<p><strong>Email:</strong> ${escapeHtml(o.contactEmail)}</p>`);
  const website = (o.links || []).find((l) => l.type === "website")?.url;
  if (website) rows.push(`<p><strong>Website:</strong> ${escapeHtml(website)}</p>`);
  if (!rows.length) return "";
  return `<div class="booklet-block"><h3>Contact Info</h3>${rows.join("")}</div>`;
}

// A dedicated facing page: the entry's current prayer requests up top (the
// same block that used to sit on the detail page itself -- see
// buildBookletHtml, which now only ever calls renderPrayerRequestsBlock
// from here), then ruled, spaced lines for handwriting notes and any
// further requests that come up during prayer. Inserted immediately after
// an entry's detail page rather than squeezed alongside it, so the detail
// page's own layout never changes and, once printed/bound, each entry gets
// its own facing page for this.
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

function buildMissionaryPageHtml(m, accent, fields) {
  const physical = addressByType(m.addresses, "physical");
  const mailing = addressByType(m.addresses, "mailing");

  return `
    <section class="booklet-page" style="--accent:${accent}">
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
  // Prayer requests only ever render on the notes page now (see
  // buildNotesPageHtml) -- the UI forces showNotesPage on whenever
  // showPrayerRequests is, but this guards the invariant here too, so a
  // caller that only sets showPrayerRequests doesn't silently lose that
  // content.
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

  // The template catalog's token set (booklet/templates.js) drives this
  // wrapper's data-* attributes and --tpl-* custom properties; booklet.css
  // reads those on every page/section beneath it instead of a per-template
  // tpl-${template} CSS block (see that file's own header comment).
  const { attrString, styleString } = templateWrapperMarkup(templateObj);
  const assembled = `<div class="booklet-doc" ${attrString} style="${styleString}">${cover}${index}${pages}${orgSection}${backCover}</div>`;

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
    'Printed at the top of each entry\'s Notes & Prayer page, which this turns on too. Only strategic requests marked both "Show on public profile" and "Include in printed booklet" -- capped per partner below.',
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
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE_ID);
  const {
    partnerTermPlural,
    usePartnerTermInAdmin,
    loading: settingsLoading,
    churchName,
    logo,
    primaryColor,
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
  }, []);
  const { settings: churchSettings } = useChurchSettings();
  useEffect(() => {
    if (churchSettings) {
      setChurchContact({
        // #271 Finding 3: ChurchSettings' address fields are flat columns
        // now -- reassembled into the nested shape formatAddressLines/
        // buildBackCoverHtml below already expect, rather than changing
        // either of those.
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

  // Settings load asynchronously, after this component's initial state is
  // already set — swap in the custom term as soon as it's ready, but only
  // if the title is still untouched (don't clobber someone's own edit).
  useEffect(() => {
    if (!settingsLoading && usePartnerTermInAdmin) {
      setTitle((current) => (current === "Missionary Partners" ? partnerTermPlural : current));
    }
  }, [settingsLoading, usePartnerTermInAdmin, partnerTermPlural]);

  function toggleField(key) {
    setFields((f) => {
      const next = { ...f, [key]: !f[key] };
      // Prayer requests only ever print on the Notes & Prayer page now (see
      // buildNotesPageHtml) -- there's nowhere else left for them to show
      // up, so turning this on has to bring that page with it. The
      // checkbox below is disabled while this is on, so there's no way
      // back into the inconsistent state from that side either.
      if (key === "showPrayerRequests" && next.showPrayerRequests) next.showNotesPage = true;
      return next;
    });
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

  // Two-pane layout (.booklet-layout, index.css): controls on the left,
  // the live preview pinned on the right so it's visible without
  // scrolling past every control first -- see AdminReport.jsx/
  // backend/src/reporting/ for the "configure, see a live result"
  // precedent this follows, adapted into a side-by-side pane since a
  // print preview (fixed 8.5in page width) doesn't fit FilterBar's
  // horizontal-row shape the way a report's filters do. Only
  // .booklet-controls carries `no-print` -- the preview itself must stay
  // outside that wrapper (it's what the Print Booklet button actually
  // prints, via the .booklet-preview reveal rule in index.css), which is
  // why this isn't nested inside a single "admin-shell no-print" div the
  // way a plain settings page would be.
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
                  // A lightweight visual hint, not a live render of the real
                  // template -- plain CSS shapes driven by the same token
                  // object templates.js/booklet.css already use
                  // (shapeStyle/photoShape/frameStyle), so a future
                  // template's swatch is correct for free rather than
                  // needing its own hand-drawn entry here. accent reuses
                  // resolveAccent() (ChurchSettings.primaryColor, same as
                  // the real booklet) so the swatch reflects the church's
                  // actual brand color, not a hardcoded hex.
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
            </div>

            <div className="admin-section">
              <h3>What Shows on Each Page</h3>
              <div className="booklet-field-grid">
                {FIELD_OPTIONS.map(([key, label, tooltip]) => {
                  // Prayer requests now print at the top of the Notes &
                  // Prayer page itself, so that page can't be turned off
                  // while they're showing -- there'd be nowhere left to
                  // print them.
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
