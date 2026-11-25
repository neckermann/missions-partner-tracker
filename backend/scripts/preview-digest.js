// Renders the admin and public digest email templates against fixture data and writes plain
// HTML, so a human can see what each audience's email looks like without sending one through
// Postmark. Pure template rendering: no database, network or API key.
//
// The fixture rows are DispatchRecord-shaped and run through the same buildBlurb()
// (dispatchBlurbs.js) every real channel calls, so the preview tracks the real pipeline.
//
// Usage:
//   npm run preview:digest
// Writes admin-digest-preview.html and public-digest-preview.html to scripts/output/
// (gitignored).
const fs = require("fs");
const path = require("path");
const { buildBlurb } = require("../src/utils/dispatchBlurbs");
const { buildAdminEmailDispatchContent } = require("../src/utils/adminEmailDispatchContent");
const { buildPublicEmailDispatchContent } = require("../src/utils/publicEmailDispatchContent");
const { buildEmailDispatchMessage } = require("../src/utils/emailDispatchShell");
const { silhouetteFor } = require("../src/utils/silhouette");
const { missionaryHouseholdCategory } = require("../src/utils/maskData");

// Set before anything calls appBaseUrl() (dispatchBlurbs.js and emailDispatchShell.js read it
// lazily) so the admin preview renders a "Read the source" button, and partnerTileDetails'
// silhouette image (routes/silhouette.js is public and generic) resolves instead of rendering
// broken. The source link itself uses fixture ids and won't resolve; nothing clicks it.
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

// One row per event type the app records: a prayer request, a one-time need at creation and at
// decision, and a newsletter with a title (dispatchBlurbs.js newsletterCreated case).
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

// Mirrors isEligibleForChannel's structural rule for the public digest (dispatchEligibility.js):
// only prayer-request types are ever eligible. Filtering here keeps the preview honest about
// which rows the public audience would see.
function eligibleForAudience(row, audience) {
  if (audience === "admin") return true;
  return row.type === "prayerRequestCreated" || row.type === "prayerRequestAnswered";
}

// A trimmed stand-in for emailDispatchShell.js's partnerTileDetails. That function uses a live
// /api/silhouette/*.svg URL when APP_BASE_URL is set (right for real email), but this script's
// output is a static file opened from disk, where Chromium blocks a cross-origin image
// (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin). The data: URI from silhouetteFor() avoids that.
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
  // "#" as a placeholder unsubscribe link; no real token is built.
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
