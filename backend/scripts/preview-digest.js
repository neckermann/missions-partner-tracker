// Renders the admin and public digest email templates against fixture
// data and writes the result to disk as plain HTML, so a human can
// actually look at what either audience's email looks like without
// sending a real one through Postmark. Pure template rendering -- no
// database, no network, no API key needed.
//
// The fixture rows are DispatchRecord-shaped and run through the same
// buildBlurb() every real channel calls (dispatchBlurbs.js), not
// hand-written blurb objects -- so this stays honest about what the
// real pipeline actually produces instead of drifting from it the
// first time buildBlurb's output shape changes.
//
// Usage:
//   npm run preview:digest
// Writes admin-digest-preview.html and public-digest-preview.html to
// scripts/output/ (gitignored).
const fs = require("fs");
const path = require("path");
const { buildBlurb } = require("../src/utils/dispatchBlurbs");
const { buildAdminEmailDispatchContent } = require("../src/utils/adminEmailDispatchContent");
const { buildPublicEmailDispatchContent } = require("../src/utils/publicEmailDispatchContent");
const { buildEmailDispatchMessage } = require("../src/utils/emailDispatchShell");
const { silhouetteFor } = require("../src/utils/silhouette");
const { missionaryHouseholdCategory } = require("../src/utils/maskData");

// Set before anything calls appBaseUrl() (dispatchBlurbs.js,
// emailDispatchShell.js both read it lazily) so the admin preview actually
// renders a "Read the source" button -- without this, sourceLinkUrl
// resolves to null and the one real visual difference #221/#222 asked
// about (admin gets source links, public structurally never does)
// wouldn't show up in the preview at all. Pointed at the real live demo
// rather than a placeholder domain so partnerTileDetails' silhouette
// image (emailDispatchShell.js -- routes/silhouette.js is public, generic,
// category-only, no partner data) actually resolves in a screenshot
// instead of rendering as a broken image; the "Read the source" link
// itself still won't resolve to a real file (fixture ids), which is
// fine -- nothing clicks it, it's a rendered email preview.
process.env.APP_BASE_URL = process.env.APP_BASE_URL || "https://missions-partner-tracker.onrender.com";

const OUTPUT_DIR = path.join(__dirname, "output");

const CHURCH_SETTINGS = {
  churchName: "Hillside Community Church",
  primaryColor: "#2a5d3c",
  headerColor: "#2c2a28",
  highlightColor: "#a6540f",
  partnerTermPlural: "Missionaries",
  partnerTermSingular: "Missionary",
  emailDispatchSignature: "Grateful for your partnership,\nPastor Dave",
};

const PARTNERS = {
  johnson: {
    id: "fixture-johnson",
    displayName: "The Johnson Family",
    isRestricted: false,
    kind: "missionary",
    fieldDisplayName: "East Africa",
    supportingSince: "2019-03-01",
    overviewShort: "Church planting and leadership training.",
    adults: [{}, {}],
    children: [{}, {}],
  },
  martinez: {
    id: "fixture-martinez",
    displayName: "The Martinez Family",
    isRestricted: false,
    kind: "missionary",
    fieldDisplayName: "Southeast Asia",
    supportingSince: "2016-09-01",
    overviewShort: "Bible translation and community development.",
    adults: [{}, {}],
    children: [],
  },
  osei: {
    id: "fixture-osei",
    displayName: "The Osei Family",
    isRestricted: false,
    kind: "missionary",
    fieldDisplayName: "West Africa",
    supportingSince: "2021-06-01",
    overviewShort: "Medical clinic ministry.",
    adults: [{}],
    children: [],
  },
};

const PARTNERS_BY_ID = new Map(Object.values(PARTNERS).map((p) => [p.id, p]));

// One row per real event type the app actually records -- a prayer
// request, a one-time need at both its creation and decision, and a
// newsletter with a title (see #222/dispatchBlurbs.js's
// newsletterCreated case for why the title matters here).
const ROWS = [
  {
    id: "fixture-1",
    type: "prayerRequestCreated",
    partnerId: PARTNERS.johnson.id,
    dispatchReviewedAt: null,
    dispatchReviewedText: null,
    payload: {
      partnerName: PARTNERS.johnson.displayName,
      requestText: "Pray for safety as our family travels to a remote village for a two-week outreach trip.",
      sourceFileId: 101,
    },
  },
  {
    id: "fixture-2",
    type: "supportNeedCreated",
    partnerId: PARTNERS.martinez.id,
    dispatchReviewedAt: null,
    dispatchReviewedText: null,
    payload: {
      partnerName: PARTNERS.martinez.displayName,
      description: "Our vehicle's transmission failed and needs replacing before the rainy season starts.",
      requestedAmount: 1450,
      sourceFileId: null,
    },
  },
  {
    id: "fixture-3",
    type: "supportNeedDecided",
    partnerId: PARTNERS.martinez.id,
    dispatchReviewedAt: null,
    dispatchReviewedText: null,
    payload: {
      partnerName: PARTNERS.martinez.displayName,
      description: "Our vehicle's transmission failed and needs replacing before the rainy season starts.",
      requestedAmount: 1450,
      approvedAmount: 1450,
      decisionNote: "Approved from the discretionary fund at this month's elder meeting.",
      sourceFileId: null,
    },
  },
  {
    id: "fixture-4",
    type: "newsletterCreated",
    partnerId: PARTNERS.osei.id,
    dispatchReviewedAt: null,
    dispatchReviewedText: null,
    payload: {
      partnerName: PARTNERS.osei.displayName,
      title: "Spring Update: New Believers and a Building Project",
      newsletterId: 202,
    },
  },
];

// Mirrors isEligibleForChannel's own structural rule for the public
// digest (dispatchEligibility.js): only prayer-request types are
// ever eligible there. Filtering here, not just relying on
// publicEmailDispatchContent.js's narrow renderItemHtml signature, keeps this
// preview honest about *which rows* the public audience would ever see
// in the first place, not just how the ones it does see get rendered.
function eligibleForAudience(row, audience) {
  if (audience === "admin") return true;
  return row.type === "prayerRequestCreated" || row.type === "prayerRequestAnswered";
}

// A trimmed, local stand-in for emailDispatchShell.js's own partnerTileDetails --
// that function resolves the photo to a live /api/silhouette/*.svg URL
// whenever APP_BASE_URL is set (the right choice for a real email, where
// most clients refuse a data: URI), but this script's own output is a
// static HTML file opened straight from disk, and Chromium blocks a
// file://-origin page from loading a cross-origin image at all
// (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin) -- confirmed while building this
// script. Using the data: URI silhouetteFor() already returns sidesteps
// that entirely and needs no network either way.
function tileFor(partner) {
  const category = partner.kind === "organization" ? "organization" : missionaryHouseholdCategory(partner);
  return {
    fieldDisplayName: partner.fieldDisplayName || null,
    supportingSinceYear: partner.supportingSince ? new Date(partner.supportingSince).getFullYear() : null,
    overviewShort: partner.overviewShort || null,
    photoSrc: silhouetteFor(category),
  };
}

function render(audience) {
  const blurbs = ROWS.filter((row) => eligibleForAudience(row, audience))
    .map((row) => buildBlurb(row, PARTNERS_BY_ID.get(row.partnerId)))
    .filter(Boolean);

  const partnerDetailsById = new Map([...PARTNERS_BY_ID.entries()].map(([id, p]) => [id, tileFor(p)]));

  const content =
    audience === "admin"
      ? buildAdminEmailDispatchContent(blurbs, partnerDetailsById, CHURCH_SETTINGS)
      : buildPublicEmailDispatchContent(blurbs, partnerDetailsById, CHURCH_SETTINGS);

  const recipient = { email: "preview@example.org", name: "Preview", kind: audience, cadence: "monthly" };
  // "#" as a placeholder unsubscribe link -- just enough for the footer
  // to render realistically, not a real token (no SESSION_SECRET needed
  // since we never call buildUnsubscribeToken/buildSubscriberUnsubscribeToken).
  return buildEmailDispatchMessage(recipient, content, CHURCH_SETTINGS, "#");
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const audience of ["admin", "public"]) {
    const outPath = path.join(OUTPUT_DIR, `${audience}-digest-preview.html`);
    fs.writeFileSync(outPath, render(audience).HtmlBody, "utf8");
    console.log(`Wrote ${outPath}`);
  }
}

main();
