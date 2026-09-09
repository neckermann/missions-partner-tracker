// Demo/example data generator — fills an empty database with realistic,
// varied missionary and organization partners so the site's features (map
// pins, restricted masking, archiving, furlough, church visits, support
// history, trip capacity, etc.) all have something to show. Every field is
// randomly generated from curated pools below, not hand-written per record,
// so re-running produces a fresh (larger) set rather than editing this file
// per record. Run with `npm run seed` from backend/.
require("dotenv").config({ quiet: true });
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const {
  personSilhouette,
  coupleSilhouette,
  familySilhouette,
  buildingSilhouette,
} = require("../src/utils/silhouette");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Overridable via env for deployments that want a different amount of
// seed data (e.g. a public demo) without forking this file.
const MISSIONARY_COUNT = Number(process.env.SEED_MISSIONARY_COUNT) || 35;
const ORGANIZATION_COUNT = Number(process.env.SEED_ORGANIZATION_COUNT) || 12;

// --- tiny random helpers ---
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickN(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function chance(p) {
  return Math.random() < p;
}
function dateYearsAgo(years, monthsJitter = 6) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setMonth(d.getMonth() - randInt(0, monthsJitter));
  d.setDate(1);
  return d;
}
function dateBetween(startYearsAgo, endYearsAgo) {
  return dateYearsAgo(randInt(endYearsAgo, startYearsAgo));
}
function fakePhone() {
  return `(${randInt(200, 999)}) 555-${String(randInt(0, 9999)).padStart(4, "0")}`;
}
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// --- name pools ---
// Deliberately generic/fictional-sounding — none of these should coincide
// with real partner families' names. If you notice an overlap with an
// actual partner, swap it out; the point of demo data is that it's
// obviously not anyone real.
const FIRST_M = [
  "Aaron", "Bill", "Bob", "Bobby", "Charles", "Craig", "David", "Dan", "Eric", "Frank",
  "Gary", "Greg", "Henry", "Jack", "James", "Jason", "Jeff", "John", "Josh", "Kevin",
  "Mark", "Matt", "Michael", "Nathan", "Paul", "Peter", "Phil", "Rick", "Robert", "Ryan",
  "Sam", "Scott", "Steve", "Tim", "Tom", "Tyler", "Wayne", "Andrew", "Brian", "Chris",
  "Derek", "Ethan", "Gavin", "Ian", "Jared", "Lucas", "Marcus", "Owen",
];
const FIRST_F = [
  "Amanda", "Amy", "Angela", "Anna", "Barbara", "Beth", "Carol", "Cathy", "Christy", "Debbie",
  "Diane", "Elizabeth", "Emily", "Emma", "Erin", "Grace", "Hannah", "Jenny", "Julie", "Karen",
  "Katie", "Kim", "Laura", "Linda", "Lisa", "Lori", "Mary", "Melissa", "Michelle", "Nancy",
  "Rachel", "Rebecca", "Sandy", "Sarah", "Stephanie", "Susan", "Tammy", "Tracy", "Wendy", "Kathy",
  "Alyssa", "Brooke", "Danielle", "Faith", "Heather", "Jasmine", "Megan", "Olivia",
];
const LAST = [
  "Whitfield", "Ashworth", "Callahan", "Delacroix", "Everhart", "Fairweather", "Gallagher", "Hensley",
  "Ironside", "Jorgensen", "Kavanagh", "Lindholm", "Marchetti", "Norwood", "Ostrander", "Prescott",
  "Quintero", "Ravenscroft", "Sinclair", "Thackeray", "Underhill", "Vandermeer", "Wexford", "Yardley",
  "Zelinski", "Abernathy", "Bramwell", "Castellano", "Draycott", "Ellsworth", "Farnsworth", "Greenfield",
  "Isherwood", "Kirkland", "Larrabee", "Moreland", "Nettleton", "Oakleigh", "Pemberton", "Radcliffe",
  "Stanhope", "Tillman", "Wentworth", "Ashby", "Blackwood", "Chessington", "Dunmore", "Holloway",
];

// --- mission fields (city/country/coords/FIPS) ---
const FIELDS = [
  { field: "Northern Uganda", city: "Koboko", country: "Uganda", fips: "UG", lat: 3.4, lng: 30.97 },
  { field: "Central Kenya", city: "Nairobi", country: "Kenya", fips: "KE", lat: -1.286, lng: 36.817 },
  { field: "Northern Tanzania", city: "Arusha", country: "Tanzania", fips: "TZ", lat: -3.386, lng: 36.683 },
  { field: "Southern Zambia", city: "Livingstone", country: "Zambia", fips: "ZA", lat: -17.85, lng: 25.85 },
  { field: "Northern Thailand", city: "Chiang Mai", country: "Thailand", fips: "TH", lat: 18.79, lng: 98.98 },
  { field: "Cambodia", city: "Phnom Penh", country: "Cambodia", fips: "CB", lat: 11.56, lng: 104.92 },
  { field: "Metro Manila", city: "Manila", country: "Philippines", fips: "RP", lat: 14.6, lng: 120.98 },
  { field: "Osaka Region", city: "Osaka", country: "Japan", fips: "JA", lat: 34.69, lng: 135.5 },
  { field: "West Java", city: "Jakarta", country: "Indonesia", fips: "ID", lat: -6.2, lng: 106.8 },
  { field: "Northern Vietnam", city: "Hanoi", country: "Vietnam", fips: "VM", lat: 21.03, lng: 105.85 },
  { field: "South India", city: "Hyderabad", country: "India", fips: "IN", lat: 17.38, lng: 78.48 },
  { field: "Kathmandu Valley", city: "Kathmandu", country: "Nepal", fips: "NP", lat: 27.72, lng: 85.32 },
  { field: "Mongolia", city: "Ulaanbaatar", country: "Mongolia", fips: "MG", lat: 47.89, lng: 106.91 },
  { field: "Oaxaca Region", city: "Oaxaca", country: "Mexico", fips: "MX", lat: 17.06, lng: -96.73 },
  { field: "Western Guatemala", city: "Quetzaltenango", country: "Guatemala", fips: "GT", lat: 14.83, lng: -91.52 },
  { field: "Honduras", city: "Tegucigalpa", country: "Honduras", fips: "HO", lat: 14.07, lng: -87.19 },
  { field: "Cusco Region", city: "Cusco", country: "Peru", fips: "PE", lat: -13.53, lng: -71.97 },
  { field: "Andean Ecuador", city: "Quito", country: "Ecuador", fips: "EC", lat: -0.18, lng: -78.47 },
  { field: "Bolivia", city: "La Paz", country: "Bolivia", fips: "BL", lat: -16.5, lng: -68.15 },
  { field: "Amazon Basin", city: "Manaus", country: "Brazil", fips: "BR", lat: -3.1, lng: -60.02 },
  { field: "Transylvania Region", city: "Cluj-Napoca", country: "Romania", fips: "RO", lat: 46.77, lng: 23.6 },
  { field: "Western Ukraine", city: "Lviv", country: "Ukraine", fips: "UP", lat: 49.84, lng: 24.03 },
  { field: "Albania", city: "Tirana", country: "Albania", fips: "AL", lat: 41.33, lng: 19.82 },
  { field: "Catalonia", city: "Barcelona", country: "Spain", fips: "SP", lat: 41.39, lng: 2.17 },
  { field: "Southern Germany", city: "Munich", country: "Germany", fips: "GM", lat: 48.14, lng: 11.58 },
  { field: "Rhône-Alpes", city: "Lyon", country: "France", fips: "FR", lat: 45.76, lng: 4.83 },
  { field: "Papua New Guinea Highlands", city: "Mount Hagen", country: "Papua New Guinea", fips: "PP", lat: -5.86, lng: 144.23 },
  { field: "Southwest China", city: "Kunming", country: "China", fips: "CH", lat: 25.04, lng: 102.71 },
];

const FOCUS_POOL = [
  "church planting", "discipleship training", "Bible translation", "leadership development",
  "orphan and widow care", "medical outreach", "evangelism", "VBS and children's ministry",
  "pastor training", "community development", "literacy education", "clean water projects",
  "women's ministry", "youth ministry", "refugee ministry", "prison ministry",
  "radio broadcasting", "Bible college teaching", "campus ministry", "sports outreach",
];

const CLOSING_SENTENCES = [
  "Their ministry has grown to include training local leaders to carry the work forward.",
  "They partner closely with national believers to see the Gospel take root in unreached communities.",
  "God has used their faithfulness to see several new congregations planted in the region.",
  "They continue to see fruit through relationships built over years of consistent presence.",
  "Their work increasingly focuses on equipping the next generation of local leaders.",
  "They remain committed to seeing a self-sustaining, indigenous church movement take hold.",
  "Recent years have brought new opportunities for partnership with local ministries.",
  "They are grateful for the doors God has opened for ministry among an unreached people group.",
  "Language study and cultural immersion remain an ongoing part of their work.",
  "They've watched a handful of local believers step into leadership roles of their own.",
  "Partnership with short-term teams has been a key part of sustaining momentum.",
  "They're often quick to say the real work is done by the local believers they serve alongside.",
  "A recent season of transition has opened fresh opportunities they're still exploring.",
  "Their days are a mix of language learning, relationship building, and ministry planning.",
];

// Several differently-worded paragraph shapes, not just one fill-in-the-
// blank sentence, so the generated bios don't all read identically.
function joinFocus(list) {
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}
// `fam` (isFamily) picks the verb form — a couple gets "have"/"spend", a
// solo missionary gets "has"/"spends", so the bios read grammatically
// correct either way.
const OVERVIEW_TEMPLATES = [
  (name, f, focusList, year, fam) => `${name} ${fam ? "have" : "has"} served in ${f.field} since ${year}, focusing on ${joinFocus(focusList)}. ${pick(CLOSING_SENTENCES)}`,
  (name, f, focusList, year, fam) => `Since ${year}, ${name} ${fam ? "have" : "has"} called ${f.city}, ${f.country} home, investing ${fam ? "their lives" : "their life"} in ${joinFocus(focusList)}. ${pick(CLOSING_SENTENCES)}`,
  (name, f, focusList, year) => `${name} moved to ${f.field} in ${year} with a vision for ${joinFocus(focusList)}. ${pick(CLOSING_SENTENCES)}`,
  (name, f, focusList, year, fam) => `For ${Math.max(1, new Date().getFullYear() - year)} years, ${name} ${fam ? "have" : "has"} poured ${fam ? "their lives" : "their life"} into ${f.field}, especially ${joinFocus(focusList)}. ${pick(CLOSING_SENTENCES)}`,
  (name, f, focusList, year, fam) => `${name} first arrived in ${f.country} in ${year} and ${fam ? "have" : "has"} devoted themselves to ${joinFocus(focusList)} ever since. ${pick(CLOSING_SENTENCES)}`,
  (name, f, focusList, year, fam) => `Based in ${f.city} since ${year}, ${name} ${fam ? "spend" : "spends"} most of their time on ${joinFocus(focusList)}. ${pick(CLOSING_SENTENCES)}`,
];
const SHORT_TEMPLATES = [
  (f, focusList, year) => `Serving in ${f.field} since ${year}, focused on ${focusList[0]}.`,
  (f, focusList, year) => `In ${f.field} since ${year} — ${focusList[0]}.`,
  (f, focusList, year) => `${f.field} since ${year}: ${joinFocus(focusList.slice(0, 2))}.`,
  (f, focusList, year) => `Based in ${f.city} since ${year}, focused on ${focusList[0]}.`,
];

const TRIP_TYPES = [
  "Construction", "Medical/Dental", "VBS/Children's Ministry", "Evangelism/Outreach",
  "Teaching/Discipleship", "Prayer", "General Labor", "Sports Ministry", "Music/Worship", "Administrative/Support",
];
const TRIP_ROLES = ["Team Leader", "Construction", "Medical", "Translator", "Photographer", "Youth Ministry", "Cook", "Logistics"];
const LANGUAGES_POOL = [
  "Spanish", "Portuguese", "French", "Swahili", "Thai", "Japanese", "Mandarin", "Khmer",
  "Amharic", "Luganda", "Quechua", "Tagalog", "Vietnamese", "Hindi", "Romanian", "Mongolian",
];
const SENDING_ORGS = [
  "ABWE", "SEND International", "Josiah Venture", "WorldVenture", "TEAM", "Pioneers",
  "International Mission Board", "OMF International", "Wycliffe Bible Translators",
];
// Fallback for SendingChurch when Church Settings hasn't been configured
// yet — per the README's setup order (migrate -> seed -> createAdmin),
// that's the common case, so this can't rely on churchSettings existing.
const FALLBACK_CHURCH_NAMES = [
  "Grace Community Church", "First Baptist Church", "Crossroads Fellowship",
  "Hillside Community Church", "Faith Community Church", "Riverside Chapel",
];
const CONTACT_METHODS = ["Email", "Phone", "WhatsApp", "Signal"];

const SEASON_NOTES = [
  "Best visited outside the rainy season, typically May–September.",
  "Cooler months (November–February) make for the most comfortable team trips.",
  "Avoid the monsoon season; the dry season from June–October is ideal.",
  "Any time of year works, though local school holidays are best for children's programs.",
  "Summer months line up with school break, which is best for youth-focused trips.",
];
const LOGISTICS_NOTES = [
  "Team housing available on-site; airport pickup can be arranged.",
  "Local guesthouse can host up to a dozen team members comfortably.",
  "Recommend arriving a day early to adjust before ministry begins.",
  "Ground transportation and translators can be arranged in advance.",
  "Simple dorm-style housing on-site; bring your own bedding.",
];
const TRIP_NOTES = [
  "Great trip — strong relationships built with the local team.",
  "One of our most fruitful trips yet; several follow-up visits already planned.",
  "Smaller team than usual, but a meaningful trip all around.",
  "Weather made travel tricky, but the team adapted well.",
  "Local church leaders specifically requested a return trip next year.",
];
const CHURCH_VISIT_NOTES = [
  "Shared during Sunday service and Go Team dinner.",
  "Gave an update during the missions moment in both services.",
  "Met with the missions committee and shared photos from the field.",
  "Hosted a Q&A with the youth group during their visit.",
  "Brought a short video update to share during the potluck.",
];

const NEWSLETTER_SUBJECTS = ["Ministry Update", "Prayer Letter", "Quarterly Newsletter", "Field Update", "Year-End Update"];
const NEWSLETTER_SEASONS = ["Winter", "Spring", "Summer", "Fall"];
const NEWSLETTER_OPENERS = [
  "Thank you for your continued prayers and support",
  "We wanted to share a quick update on what God has been doing",
  "It's been a full season, and we're grateful for a chance to catch you up",
  "As always, we're thankful for this church family standing behind us",
];

// A fraction of generated newsletters/documents get a prayer request
// and/or one-time need woven in, so a fresh seed/demo reset always has
// something real for the AI request-scanning feature (see
// backend/src/utils/extraction.js) to actually find -- otherwise every
// newsletter is generic "thanks for your support" filler with nothing to
// extract, and the feature looks broken on a brand-new instance.
const PRAYER_REQUEST_LINES = [
  "Please pray for safety as I travel to the field next month.",
  "Please continue praying for wisdom as we plan next steps for the ministry here.",
  "Pray for our team as we prepare for the upcoming outreach event.",
  "Please keep praying for open doors as we build relationships in the community.",
  "Pray for good health and stamina during this busy season of ministry.",
  "Please pray for our kids as they adjust to a new season of transition.",
  "We'd covet your prayers for a difficult family situation back home that has been weighing on us.",
  "Please pray for clarity as we discern what our next assignment should look like.",
  "Pray for the local believers we're discipling, that they'd grow in confidence sharing their faith.",
  "Please keep lifting up a close friend here who is walking through a serious illness.",
];
const ONE_TIME_NEED_LINES = [
  (amount) => `Our vehicle needs significant repairs, and we're asking for help covering the $${amount} cost.`,
  (amount) => `We have an unexpected medical bill of $${amount} and would be grateful for any support toward it.`,
  (amount) => `We're hoping to raise $${amount} to replace ministry equipment that broke down recently.`,
  (amount) => `A specific need has come up -- we're asking for help with $${amount} in visa renewal fees.`,
  (amount) => `We're believing God for provision toward a $${amount} need to repair storm damage to our home here.`,
  () => `We're trusting God for provision to cover an unexpected need this month -- if you feel led to help, please reach out.`,
];

// Independent odds -- most newsletters get neither (realistic; most updates
// are just updates), some get one, a few get both.
function scannableExtras() {
  const parts = [];
  if (chance(0.4)) parts.push(`Prayer requests:\n${pick(PRAYER_REQUEST_LINES)}`);
  if (chance(0.2)) {
    const line = pick(ONE_TIME_NEED_LINES);
    const amount = randInt(2, 20) * 100; // round hundreds, like a real ask
    parts.push(`One-time need:\n${line(amount)}`);
  }
  return parts.join("\n\n");
}

// Uploaded as .eml (a plain-text "saved email") rather than a generated
// PDF — trivially valid with no binary structure to get wrong, and matches
// one of the file types the Newsletter feature already explicitly supports
// (see routes/newsletters.js's resolveExt).
function buildFakeEml(fromName, fromSlug, subject, field) {
  const extras = scannableExtras();
  const body = `${pick(NEWSLETTER_OPENERS)} as we serve in ${field}. This season has brought both challenges and encouragement, and we're excited to share a bit of both with you.${extras ? `\n\n${extras}` : ""}\n\nThank you for partnering with us.\n\nIn Him,\n${fromName}`;
  const eml = [
    `From: ${fromName} <${fromSlug}@example.com>`,
    `To: missions@example.org`,
    `Subject: ${subject}`,
    `Date: ${dateBetween(1, 0).toUTCString()}`,
    `Content-Type: text/plain; charset="utf-8"`,
    ``,
    body,
    ``,
  ].join("\r\n");
  return Buffer.from(eml, "utf-8");
}

async function maybeAddNewsletter({ missionaryId, organizationId, name, slug, field }) {
  if (!chance(0.3)) return;
  const subject = `${pick(NEWSLETTER_SUBJECTS)} — ${pick(NEWSLETTER_SEASONS)} ${randInt(2023, 2026)}`;
  const buffer = buildFakeEml(name, slug, subject, field);
  await prisma.newsletter.create({
    data: {
      missionaryId: missionaryId || undefined,
      organizationId: organizationId || undefined,
      title: subject,
      receivedDate: dateBetween(1, 0),
      bytes: buffer,
      fileName: "update.eml",
      contentType: "message/rfc822",
      fileSize: buffer.length,
    },
  });
}

// Titles per Document category — see backend/src/routes/documents.js's
// CATEGORIES for what these keys mean. "other" pairs a title with its own
// free-typed customCategory, same as a real admin would fill in.
const DOCUMENT_TITLES = {
  survey_response: ["Annual Field Survey Response", "Mid-Year Check-In Survey", "Partner Satisfaction Survey"],
  signed_policy: ["Signed Child Protection Policy", "Signed Code of Conduct", "Signed Financial Accountability Agreement"],
  office_document: ["Ministry Budget Overview", "Field Report", "Travel Itinerary"],
  email: ["Re: Prayer Request Update", "Follow-up from Field Visit", "Question about Support Timeline"],
};
const OTHER_DOCUMENT_TITLES = ["Background Check Results", "Reference Letter", "Passport Copy"];
const OTHER_DOCUMENT_CATEGORIES = ["Background Check", "Reference", "Travel Document"];
const DOCUMENT_NOTES = [
  "On file per policy.",
  "Kept for records.",
  "Shared for planning purposes.",
  "Received during the fall check-in cycle.",
];

// ~90 chars fits comfortably at 11pt Helvetica within a 612pt-wide page's
// margins -- rough estimate (no real text-metrics), fine for seed-data
// placeholder text rather than production typesetting.
function wrapText(text, maxChars = 90) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// A real, structurally-valid single-page PDF (byte-accurate xref table and
// all) with the title (and, for a fraction of documents, a prayer request
// and/or one-time need -- see scannableExtras) rendered as text, not just
// the "%PDF-" magic bytes. An earlier version of this only wrote the magic
// bytes, which passed routes/documents.js's upload-time signature check but
// produced a file that opened to nothing. Built by hand rather than pulling
// in a PDF library, since it's a handful of fixed lines of Helvetica text
// on one page.
function buildFakePdf(title, extraText) {
  const escape = (s) => s.replace(/([()\\])/g, "\\$1");
  const bodyLines = extraText
    ? extraText.split("\n").flatMap((line) => (line ? wrapText(line) : [""]))
    : ["Seed data placeholder -- not a real document."];
  const content = [
    "BT",
    "/F1 18 Tf",
    `72 700 Td (${escape(title)}) Tj`,
    "/F1 11 Tf",
    "0 -32 Td",
    ...bodyLines.map((line) => `0 -15 Td (${escape(line)}) Tj`),
    "ET",
  ].join("\n");
  const contentBytes = Buffer.byteLength(content, "latin1");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${contentBytes} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0]; // object 0 is the reserved free-list head, not a real object
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

async function maybeAddDocument({ missionaryId, organizationId, name, slug, field }) {
  if (!chance(0.35)) return;
  const category = pick(["survey_response", "signed_policy", "office_document", "email", "other"]);
  const isOther = category === "other";
  const title = isOther ? pick(OTHER_DOCUMENT_TITLES) : pick(DOCUMENT_TITLES[category]);
  const customCategory = isOther ? pick(OTHER_DOCUMENT_CATEGORIES) : null;

  let buffer, fileName, contentType;
  if (category === "email") {
    buffer = buildFakeEml(name, slug, title, field);
    fileName = "email.eml";
    contentType = "message/rfc822";
  } else {
    // Only for categories where a prayer request/need mention is plausible
    // content -- a signed policy or background-check result wouldn't
    // realistically contain one.
    const extraText = category === "office_document" || category === "survey_response" ? scannableExtras() : "";
    buffer = buildFakePdf(title, extraText);
    fileName = "document.pdf";
    contentType = "application/pdf";
  }

  await prisma.document.create({
    data: {
      missionaryId: missionaryId || undefined,
      organizationId: organizationId || undefined,
      category,
      customCategory,
      title,
      receivedDate: dateBetween(1, 0),
      notes: chance(0.5) ? pick(DOCUMENT_NOTES) : null,
      bytes: buffer,
      fileName,
      contentType,
      fileSize: buffer.length,
    },
  });
}

const ORG_TYPES = ["Local", "National"];
const ORG_NAME_TEMPLATES = [
  (f) => `${f.city} Bible Institute`,
  (f) => `New Life ${f.country} Ministries`,
  (f) => `${f.country} Church Planting Network`,
  (f) => `Hope for ${f.city}`,
  (f) => `${f.city} Christian Fellowship`,
  (f) => `${f.country} Theological Seminary`,
  (f) => `Grace Community ${f.city}`,
  (f) => `${f.city} Orphan Care Alliance`,
  (f) => `Living Water ${f.country}`,
  (f) => `${f.country} Bible Translation Society`,
  (f) => `${f.city} Medical Mission`,
  (f) => `Radiant Hope ${f.country}`,
];

function personName() {
  const isCouple = chance(0.7);
  const last = pick(LAST);
  if (isCouple) {
    return { displayName: `${pick(FIRST_M)} and ${pick(FIRST_F)} ${last}`, last, isFamily: true };
  }
  const solo = chance(0.5) ? pick(FIRST_M) : pick(FIRST_F);
  return { displayName: `${solo} ${last}`, last, isFamily: false };
}

// Shape builders live in src/utils/silhouette.js (shared with maskData.js,
// which uses them with a fixed neutral color for restricted-partner public
// photos) — here they're used with a randomly-picked color per record,
// purely for demo-data variety when Pexels isn't configured.
const SILHOUETTE_COLORS = ["2a5d3c", "1d4e89", "8a3324", "6b4c9a", "b45309", "0f766e", "7c2d12", "4338ca"];

// Returns { bytes, contentType } -- same shape as downloadAndUploadPhoto's
// real-photo path below, so resolveMissionaryPhoto/resolveOrgLogo can
// treat "got a real Pexels photo" and "fell back to a silhouette" the
// same way.
function missionaryPhoto(isFamily, childCount) {
  const bg = pick(SILHOUETTE_COLORS);
  const svg = childCount > 0 ? familySilhouette(bg) : isFamily ? coupleSilhouette(bg) : personSilhouette(bg);
  return { bytes: Buffer.from(svg, "utf-8"), contentType: "image/svg+xml" };
}
function orgLogo() {
  return { bytes: Buffer.from(buildingSilhouette(pick(SILHOUETTE_COLORS)), "utf-8"), contentType: "image/svg+xml" };
}

// --- Real stock photos via Pexels (optional) ---
// Entirely optional: if PEXELS_API_KEY isn't set, or a request fails, every
// function below falls back to the generated SVG silhouettes above, so
// seeding never hard-fails over a third-party API being unavailable.
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

// Keys match missionaryPhotoCategory()'s return values below. The
// couple/family queries use specific relationship terms rather than
// generic ones like "couple" or "parents" -- stock photo libraries tag
// these terms more consistently with a matching two-adult portrait, which
// lines up with how personName() above builds a paired household. Pexels
// has no content-matching guarantee beyond its own tagging, so this is a
// best effort, not a hard guarantee.
const PEXELS_MISSIONARY_QUERIES = {
  single_adult: ["portrait of adult smiling", "young professional headshot"],
  couple: ["husband and wife portrait smiling", "man and woman couple portrait outdoor"],
  family_with_kids: ["mother father and children portrait", "mom dad kids family outdoor portrait"],
  large_family: ["mom dad grandparents family group portrait", "parents children large family portrait"],
};
const PEXELS_ORG_LOGO_QUERIES = ["abstract logo design", "minimalist brand logo", "nonprofit organization logo"];

// Mirrors exactly how `adults`/`children` are built above: one adult with
// no children is "single_adult", two adults with no children is "couple",
// and from there it's just how many kids.
function missionaryPhotoCategory(isFamily, childCount) {
  if (!isFamily) return "single_adult";
  if (childCount === 0) return "couple";
  if (childCount <= 2) return "family_with_kids";
  return "large_family";
}

async function fetchPexelsPhotos(query, perPage = 15) {
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=square`;
    const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
    if (!res.ok) {
      console.warn(`  Pexels search failed for "${query}": HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    // .large (~940px) rather than .medium (~350px) -- still a small JPEG,
    // but holds up on the partner detail page's larger hero photo, not
    // just card-sized thumbnails.
    return (data.photos || []).map((p) => p.src.large);
  } catch (err) {
    console.warn(`  Pexels search errored for "${query}":`, err.message);
    return [];
  }
}

// Fisher-Yates shuffle, once per pool -- photos are then handed out in this
// fixed (but randomized) order, wrapping around if a category runs out, so
// a run of 50 missionaries doesn't just repeat the same handful of photos
// in the same order every time.
function shuffled(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Called once at the start of a seed run -- a handful of Pexels search
// calls total (one per query above), not per-missionary/organization, so a
// full reseed stays comfortably under Pexels' free-tier rate limit even
// run several times in the same hour during local testing.
async function buildPhotoPools() {
  if (!PEXELS_API_KEY) {
    console.log("PEXELS_API_KEY not set -- using generated silhouette avatars instead of stock photos.");
    return null;
  }
  console.log("Fetching stock photos from Pexels...");
  const pools = {};
  for (const [category, queries] of Object.entries(PEXELS_MISSIONARY_QUERIES)) {
    let urls = [];
    for (const q of queries) urls = urls.concat(await fetchPexelsPhotos(q));
    pools[category] = { urls: shuffled(urls), next: 0 };
    console.log(`  ${category}: ${urls.length} photos`);
  }
  let orgUrls = [];
  for (const q of PEXELS_ORG_LOGO_QUERIES) orgUrls = orgUrls.concat(await fetchPexelsPhotos(q));
  pools.org = { urls: shuffled(orgUrls), next: 0 };
  console.log(`  org: ${orgUrls.length} photos`);
  return pools;
}

function nextFromPool(pool) {
  if (!pool || pool.urls.length === 0) return null;
  const url = pool.urls[pool.next % pool.urls.length];
  pool.next += 1;
  return url;
}

// Downloads the actual image bytes from Pexels' own CDN (not rate-limited
// the way the search API above is), exactly like a real admin's upload
// would end up stored -- never a hotlink to an external URL that could
// change, disappear, or fail CSP. Returns the same { bytes, contentType }
// shape as the silhouette fallbacks above.
async function downloadAndUploadPhoto(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: "image/jpeg" };
  } catch (err) {
    console.warn("  Failed to download a Pexels photo:", err.message);
    return null;
  }
}

async function resolveMissionaryPhoto(pools, isFamily, childCount) {
  const category = missionaryPhotoCategory(isFamily, childCount);
  const pexelsUrl = pools && nextFromPool(pools[category]);
  const downloaded = pexelsUrl && (await downloadAndUploadPhoto(pexelsUrl));
  return downloaded || missionaryPhoto(isFamily, childCount);
}

async function resolveOrgLogo(pools) {
  const pexelsUrl = pools && nextFromPool(pools.org);
  const downloaded = pexelsUrl && (await downloadAndUploadPhoto(pexelsUrl));
  return downloaded || orgLogo();
}

function buildOverview(name, fieldInfo, focusList, year, isFamily = true) {
  const overview = pick(OVERVIEW_TEMPLATES)(name, fieldInfo, focusList, year, isFamily);
  const overviewShort = pick(SHORT_TEMPLATES)(fieldInfo, focusList, year);
  return { overview, overviewShort };
}

function buildTrips(participantNamePool) {
  const count = randInt(0, 2);
  const trips = [];
  for (let i = 0; i < count; i++) {
    const start = dateBetween(4, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + randInt(5, 12));
    const participants = pickN(participantNamePool, randInt(2, 5)).map((name, idx) => ({
      name,
      role: pick(TRIP_ROLES),
      isLeader: idx === 0,
      phone: chance(0.5) ? fakePhone() : null,
      email: chance(0.5) ? `${name.toLowerCase().replace(/\s+/g, ".")}@example.com` : null,
    }));
    trips.push({
      startDate: start,
      endDate: end,
      tripType: pick(TRIP_TYPES),
      description: `Team served alongside the field, focusing on ${pick(FOCUS_POOL)}.`,
      notes: chance(0.4) ? pick(TRIP_NOTES) : null,
      participants: { create: participants },
    });
  }
  return trips;
}

function buildSupportEntries() {
  const base = randInt(12, 64) * 25; // $300 - $1600, in $25 increments
  const entries = [{ amount: base, effectiveDate: dateBetween(1, 0), notes: null }];
  if (chance(0.5)) {
    entries.push({ amount: Math.max(200, base - randInt(1, 6) * 25), effectiveDate: dateBetween(3, 1), notes: "Adjusted after annual budget review." });
  }
  return entries;
}

const SITUATIONAL_PRAYER_REQUESTS = [
  "Safe travel during the upcoming trip to the capital",
  "Good health for the family during flu season",
  "Wisdom for an upcoming meeting with local leaders",
  "Safety during a short-term team's visit next month",
  "A smooth visa renewal process",
  "Strength during a busy season of ministry travel",
];
const STRATEGIC_PRAYER_REQUESTS = [
  "Open doors to share the Gospel in an unreached community nearby",
  "A team of local believers to help carry the ministry forward",
  "Provision for a permanent ministry center",
  "Breakthrough in a long-standing language barrier with the community",
  "Continued favor with local government for ministry registration",
  "Spiritual growth and unity among the small group of new believers",
];
const ANSWERED_NOTES = [
  "A local family stepped up to help lead the work.",
  "The paperwork was approved faster than expected.",
  "Several people from the community put their faith in Christ.",
  "Funding came through from an unexpected source.",
  "The relationship healed after months of prayer.",
];

// Not every missionary/org gets one -- seeing some records with none and
// some with several better represents real usage than a guaranteed 1-3
// every time. Mirrors buildNeedRequests()'s shape (an array for a direct
// `{ create: [...] }`), but status is deliberately NOT weighted toward
// "answered" -- most real prayer requests are still open at any given
// moment, and seed data should look like that rather than like a
// showcase of resolved ones. See the PrayerRequest model comment in
// schema.prisma for why "ongoing" isn't treated as a lesser outcome here.
function buildPrayerRequests() {
  const count = chance(0.6) ? randInt(1, 3) : 0;
  return Array.from({ length: count }, () => {
    const category = chance(0.5) ? "strategic" : "situational";
    const isStrategic = category === "strategic";
    const requestText = pick(isStrategic ? STRATEGIC_PRAYER_REQUESTS : SITUATIONAL_PRAYER_REQUESTS);
    // Situational requests are rarely worth tracking for a formal answer;
    // strategic ones are usually still open at any given snapshot in time.
    const status = isStrategic ? pick(["ongoing", "ongoing", "ongoing", "answered"]) : pick(["untracked", "untracked", "ongoing"]);
    const answered = status === "answered";
    const isPublic = isStrategic && chance(0.7);
    return {
      category,
      requestText,
      dateReceived: dateBetween(2, 0),
      isPublic,
      // Booklet space is capped per partner (see AdminBooklet.jsx), so not
      // every public request needs to be booklet-eligible -- a little over
      // half of the public ones, so a seeded partner with several has a
      // realistic mix rather than either all-in or all-out.
      includeInBooklet: isPublic && chance(0.6),
      status,
      dateAnswered: answered ? dateBetween(0, 0) : null,
      answeredNote: answered && chance(0.7) ? pick(ANSWERED_NOTES) : null,
      notes: chance(0.15) ? "Shared during a support-team update call." : null,
    };
  });
}

function buildNeedRequests() {
  if (!chance(0.35)) return [];
  const requested = randInt(4, 40) * 50;
  const decided = chance(0.65);
  let approvedAmount = null;
  let approvedDate = null;
  if (decided) {
    approvedDate = dateBetween(1, 0);
    const outcome = pick(["full", "partial", "declined"]);
    approvedAmount = outcome === "full" ? requested : outcome === "partial" ? Math.round(requested * 0.5) : 0;
  }
  return [
    {
      description: pick([
        "Replacement laptop for translation work",
        "Vehicle repairs for field travel",
        "Medical expenses for family member",
        "Roof repair on mission house",
        "Emergency evacuation costs",
        "New water filtration system",
        "Motorbike for rural visits",
      ]),
      requestedAmount: requested,
      requestDate: dateBetween(1, 0),
      approvedAmount,
      approvedDate,
      notes: chance(0.3) ? pick(["Discussed with the missions committee before approval.", "Time-sensitive — needed before the next field visit.", "Follow-up request from a previous conversation."]) : null,
    },
  ];
}

function buildChurchVisits() {
  const count = chance(0.55) ? randInt(1, 2) : 0;
  const visits = [];
  for (let i = 0; i < count; i++) {
    visits.push({ visitDate: dateBetween(3, 0), notes: chance(0.3) ? pick(CHURCH_VISIT_NOTES) : null });
  }
  return { create: visits };
}

async function main() {
  const existingMissionaries = await prisma.missionary.count();
  const existingOrgs = await prisma.organization.count();
  if (existingMissionaries > 0 || existingOrgs > 0) {
    console.log(`Found ${existingMissionaries} missionaries and ${existingOrgs} organizations already on file — seeding will add more on top of these, not replace them.`);
  }

  const churchSettings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  const admin = await prisma.user.findFirst({ where: { role: "admin" } });
  const attribution = admin ? { createdById: admin.id, updatedById: admin.id } : {};
  const photoPools = await buildPhotoPools();

  console.log(`Seeding ${MISSIONARY_COUNT} missionaries...`);
  for (let i = 0; i < MISSIONARY_COUNT; i++) {
    const { displayName, last, isFamily } = personName();
    const fieldInfo = pick(FIELDS);
    const yearsSince = randInt(1, 22);
    const year = new Date().getFullYear() - yearsSince;
    const focusList = pickN(FOCUS_POOL, randInt(2, 3));
    const { overview, overviewShort } = buildOverview(displayName, fieldInfo, focusList, year, isFamily);

    const isPublic = chance(0.85);
    const isRestricted = isPublic && chance(0.12);
    const archived = i < 2; // first couple are archived, to demo the feature
    // Every missionary (unlike an organization, which has no sending
    // church/org relation at all) always gets both a SendingChurch and a
    // SendingOrg record — the schema has no constraint making these mutually
    // exclusive, and every seeded record should demonstrate both parts of
    // the data model rather than leaving either blank. sentByOurChurch just
    // decides whether that SendingChurch happens to be us (using our real
    // Church Settings) or another church (fictional fallback name) — it
    // doesn't gate whether the record exists at all anymore.
    const sentByOurChurch = churchSettings && chance(0.3);
    const fallbackChurchName = pick(FALLBACK_CHURCH_NAMES);
    const sendingOrgName = pick(SENDING_ORGS);

    const participantPool = [`${pick(FIRST_M)} ${pick(LAST)}`, `${pick(FIRST_F)} ${pick(LAST)}`, `${pick(FIRST_M)} ${pick(LAST)}`, `${pick(FIRST_F)} ${pick(LAST)}`, `${pick(FIRST_M)} ${pick(LAST)}`, `${pick(FIRST_F)} ${pick(LAST)}`];

    // Every missionary gets at least one Adult record (themselves) — a solo
    // missionary isn't just an empty household, and this is the only place
    // their own phone/email live separate from the top-level contact fields.
    const adults = isFamily
      ? [
          {
            name: `${displayName.split(" and ")[0]} ${last}`,
            phone1: fakePhone(),
            phone2: chance(0.25) ? fakePhone() : null,
            email: `${slugify(displayName.split(" and ")[0])}.${slugify(last)}@example.com`,
            birthday: dateBetween(60, 28),
          },
          {
            name: displayName.split(" and ")[1],
            phone1: fakePhone(),
            phone2: null,
            email: `${slugify(displayName.split(" and ")[1])}@example.com`,
            birthday: dateBetween(58, 26),
          },
        ]
      : [
          {
            name: displayName,
            phone1: fakePhone(),
            phone2: chance(0.15) ? fakePhone() : null,
            email: `${slugify(displayName)}@example.com`,
            birthday: dateBetween(55, 25),
          },
        ];
    const childCount = isFamily && chance(0.6) ? randInt(1, 4) : 0;
    const children = Array.from({ length: childCount }, () => ({
      name: `${pick(FIRST_M.concat(FIRST_F))} ${last}`,
      birthday: dateBetween(17, 1),
    }));

    const furloughs = chance(0.2)
      ? [chance(0.3)
          ? { startDate: dateBetween(0, 0), endDate: null, notes: "Currently stateside for home assignment." }
          : { startDate: dateBetween(3, 1), endDate: dateBetween(1, 0), notes: "Completed home assignment, deputation, and medical checkups." }]
      : [];

    const photo = await resolveMissionaryPhoto(photoPools, isFamily, childCount);

    const createdMissionary = await prisma.missionary.create({
      data: {
        displayName,
        fieldDisplayName: fieldInfo.field,
        fipsCountryCode: fieldInfo.fips,
        isPublic,
        isRestricted,
        archived,
        archivedAt: archived ? dateBetween(0, 0) : null,
        contactSafe: chance(0.85),
        preferredContactMethod: pick(CONTACT_METHODS),
        sentByOurChurch: !!sentByOurChurch,
        overview,
        overviewShort,
        focusArea: `Primary focus: ${focusList.join(", ")}.`,
        supportingSince: new Date(year, 0, 1),
        anniversary: isFamily ? dateBetween(35, 5) : null,
        languagesSpoken: pickN(LANGUAGES_POOL, randInt(0, 2)),
        tripTeamSizeMin: chance(0.7) ? randInt(2, 6) : null,
        tripTeamSizeMax: chance(0.7) ? randInt(8, 15) : null,
        tripTypesSupported: pickN(TRIP_TYPES, randInt(1, 3)),
        tripSeasonNotes: chance(0.5) ? pick(SEASON_NOTES) : null,
        tripLogisticsNotes: chance(0.5) ? pick(LOGISTICS_NOTES) : null,
        websiteLink: chance(0.4) ? `https://${last.toLowerCase()}family.example.com` : null,
        supportLink: chance(0.5) ? `https://give.example.com/${last.toLowerCase()}` : null,
        newsletterSignup: chance(0.35) ? `https://newsletter.example.com/${last.toLowerCase()}` : null,
        facebook: chance(0.5) ? `https://facebook.com/${last.toLowerCase()}family` : null,
        twitter: chance(0.2) ? `https://twitter.com/${last.toLowerCase()}family` : null,
        instagram: chance(0.4) ? `https://instagram.com/${last.toLowerCase()}family` : null,
        linkedin: chance(0.15) ? `https://linkedin.com/in/${last.toLowerCase()}` : null,
        photos: {
          create: { bytes: photo.bytes, contentType: photo.contentType, receivedDate: dateBetween(1, 0) },
        },
        emergencyContact: chance(0.5)
          ? { name: `${pick(FIRST_M.concat(FIRST_F))} ${pick(LAST)}`, phone: fakePhone(), email: null }
          : {},
        adults: { create: adults },
        children: { create: children },
        addresses: {
          create: [
            { type: "physical", city: fieldInfo.city, country: fieldInfo.country, gpsLat: fieldInfo.lat + (Math.random() - 0.5) * 0.3, gpsLng: fieldInfo.lng + (Math.random() - 0.5) * 0.3 },
            { type: "mailing", addressLine1: `PO Box ${randInt(100, 9999)}`, city: "Rock Island", stateProvinceRegion: "IL", postalCode: "61201", country: "USA", receiveMail: true, receivePackages: chance(0.5) },
          ],
        },
        missionTrips: { create: buildTrips(participantPool) },
        furloughs: { create: furloughs },
        churchVisits: buildChurchVisits(),
        supportEntries: { create: buildSupportEntries() },
        needRequests: { create: buildNeedRequests() },
        prayerRequests: { create: buildPrayerRequests() },
        // SendingParty rows store the mailing address as flat columns (see
        // schema.prisma), so churchSettings.address (still the old nested
        // JSON shape from ChurchSettings) is spread directly rather than
        // assigned to a `mailingAddress` key.
        sendingParties: {
          create: [
            sentByOurChurch
              ? {
                  type: "church",
                  name: churchSettings.churchName,
                  contactName: churchSettings.contactName,
                  contactEmail: churchSettings.contactEmail,
                  websiteLink: churchSettings.websiteLink,
                  phone: churchSettings.phone,
                  ...(churchSettings.address || {}),
                }
              : {
                  type: "church",
                  name: fallbackChurchName,
                  contactName: `${pick(FIRST_M.concat(FIRST_F))} ${pick(LAST)}`,
                  contactEmail: chance(0.6) ? `missions@${slugify(fallbackChurchName)}.example.org` : null,
                  websiteLink: chance(0.5) ? `https://${slugify(fallbackChurchName)}.example.org` : null,
                  phone: chance(0.5) ? fakePhone() : null,
                },
            {
              type: "org",
              name: sendingOrgName,
              contactName: `${pick(FIRST_M.concat(FIRST_F))} ${pick(LAST)}`,
              contactEmail: chance(0.7) ? `partnercare@${slugify(sendingOrgName)}.example.org` : null,
              websiteLink: chance(0.6) ? `https://${slugify(sendingOrgName)}.example.org` : null,
              phone: chance(0.5) ? fakePhone() : null,
            },
          ],
        },
        ...attribution,
      },
    });

    await maybeAddNewsletter({ missionaryId: createdMissionary.id, name: displayName, slug: last.toLowerCase(), field: fieldInfo.field });
    await maybeAddDocument({ missionaryId: createdMissionary.id, name: displayName, slug: last.toLowerCase(), field: fieldInfo.field });
  }

  console.log(`Seeding ${ORGANIZATION_COUNT} organizations...`);
  for (let i = 0; i < ORGANIZATION_COUNT; i++) {
    const fieldInfo = pick(FIELDS);
    const name = pick(ORG_NAME_TEMPLATES)(fieldInfo);
    const orgType = pick(ORG_TYPES);
    const yearsSince = randInt(1, 18);
    const year = new Date().getFullYear() - yearsSince;
    const focusList = pickN(FOCUS_POOL, randInt(2, 3));
    const { overview, overviewShort } = buildOverview(name, fieldInfo, focusList, year, false);

    const isPublic = chance(0.85);
    const isRestricted = isPublic && chance(0.1);
    const archived = i === 0; // one archived org, to demo the feature

    const participantPool = [`${pick(FIRST_M)} ${pick(LAST)}`, `${pick(FIRST_F)} ${pick(LAST)}`, `${pick(FIRST_M)} ${pick(LAST)}`, `${pick(FIRST_F)} ${pick(LAST)}`];

    const logo = await resolveOrgLogo(photoPools);

    const created = await prisma.organization.create({
      data: {
        name,
        orgType,
        fieldDisplayName: fieldInfo.field,
        fipsCountryCode: fieldInfo.fips,
        isPublic,
        isRestricted,
        archived,
        archivedAt: archived ? dateBetween(0, 0) : null,
        overview,
        overviewShort,
        focusArea: `Primary focus: ${focusList.join(", ")}.`,
        supportingSince: new Date(year, 0, 1),
        contactName: `${pick(FIRST_M.concat(FIRST_F))} ${pick(LAST)}`,
        contactPhone: fakePhone(),
        contactEmail: `info@${slugify(name)}.example.org`,
        preferredContactMethod: pick(CONTACT_METHODS),
        websiteLink: chance(0.5) ? `https://${slugify(name)}.example.org` : null,
        supportLink: chance(0.5) ? `https://give.example.com/${slugify(name)}` : null,
        newsletterSignup: chance(0.3) ? `https://newsletter.example.com/${slugify(name)}` : null,
        facebook: chance(0.4) ? `https://facebook.com/${slugify(name)}` : null,
        twitter: chance(0.15) ? `https://twitter.com/${slugify(name)}` : null,
        instagram: chance(0.3) ? `https://instagram.com/${slugify(name)}` : null,
        linkedin: chance(0.2) ? `https://linkedin.com/company/${slugify(name)}` : null,
        tripTeamSizeMin: chance(0.7) ? randInt(4, 8) : null,
        tripTeamSizeMax: chance(0.7) ? randInt(10, 20) : null,
        tripTypesSupported: pickN(TRIP_TYPES, randInt(1, 3)),
        tripSeasonNotes: chance(0.5) ? pick(SEASON_NOTES) : null,
        tripLogisticsNotes: chance(0.5) ? pick(LOGISTICS_NOTES) : null,
        photos: {
          create: { bytes: logo.bytes, contentType: logo.contentType, receivedDate: dateBetween(1, 0) },
        },
        addresses: {
          create: [
            { type: "physical", city: fieldInfo.city, country: fieldInfo.country, gpsLat: fieldInfo.lat + (Math.random() - 0.5) * 0.3, gpsLng: fieldInfo.lng + (Math.random() - 0.5) * 0.3 },
            ...(chance(0.4)
              ? [{ type: "mailing", addressLine1: `PO Box ${randInt(100, 9999)}`, city: fieldInfo.city, country: fieldInfo.country, receiveMail: true, receivePackages: chance(0.5) }]
              : []),
          ],
        },
        orgTrips: { create: buildTrips(participantPool) },
        churchVisits: buildChurchVisits(),
        supportEntries: { create: buildSupportEntries() },
        needRequests: { create: buildNeedRequests() },
        prayerRequests: { create: buildPrayerRequests() },
        ...attribution,
      },
    });

    await maybeAddNewsletter({ organizationId: created.id, name, slug: slugify(name), field: fieldInfo.field });
    await maybeAddDocument({ organizationId: created.id, name, slug: slugify(name), field: fieldInfo.field });
  }

  const finalMissionaries = await prisma.missionary.count();
  const finalOrgs = await prisma.organization.count();
  console.log(`Done. Missionaries: ${finalMissionaries}, Organizations: ${finalOrgs}.`);
}

// Guarded so this file can be safely require()'d elsewhere (e.g. to reuse
// buildFakePdf/buildFakeEml for a quick manual check) without silently
// re-running the whole seed against whatever DATABASE_URL happens to be
// active -- found the hard way while verifying this file's own changes.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { buildFakePdf, buildFakeEml, scannableExtras };
