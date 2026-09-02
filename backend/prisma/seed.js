// Demo/example data generator — fills an empty database with realistic,
// varied missionary and organization partners so the site's features (map
// pins, restricted masking, archiving, furlough, church visits, support
// history, trip capacity, etc.) all have something to show. Every field is
// randomly generated from curated pools below, not hand-written per record,
// so re-running produces a fresh (larger) set rather than editing this file
// per record. Run with `npm run seed` from backend/.
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { uploadPrivateFileToS3 } = require("../src/utils/s3");
const prisma = new PrismaClient();

const MISSIONARY_COUNT = 35;
const ORGANIZATION_COUNT = 12;

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

// Uploaded as .eml (a plain-text "saved email") rather than a generated
// PDF — trivially valid with no binary structure to get wrong, and matches
// one of the file types the Newsletter feature already explicitly supports
// (see routes/newsletters.js's resolveExt).
function buildFakeEml(fromName, fromSlug, subject, field) {
  const body = `${pick(NEWSLETTER_OPENERS)} as we serve in ${field}. This season has brought both challenges and encouragement, and we're excited to share a bit of both with you.\n\nThank you for partnering with us.\n\nIn Him,\n${fromName}`;
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
  const ownerId = missionaryId || organizationId;
  const key = `newsletters/${ownerId}/${Date.now()}-update.eml`;
  await uploadPrivateFileToS3(buffer, key, "message/rfc822");
  await prisma.newsletter.create({
    data: {
      missionaryId: missionaryId || undefined,
      organizationId: organizationId || undefined,
      title: subject,
      receivedDate: dateBetween(1, 0),
      fileKey: key,
      fileName: "update.eml",
      contentType: "message/rfc822",
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

// Plain flat silhouette icons, generated as inline SVG data URIs — no
// external image service at all, so there's zero risk of an inappropriate
// or unavailable image (unlike a random-real-photo pool, or depending on a
// third-party API staying up). Shape reflects household composition (solo,
// couple, or family with kids); background color is just for variety.
const SILHOUETTE_COLORS = ["2a5d3c", "1d4e89", "8a3324", "6b4c9a", "b45309", "0f766e", "7c2d12", "4338ca"];

function svgDataUri(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
function personSilhouette(bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><circle cx="100" cy="80" r="35" fill="#fff"/><path d="M40 170 Q40 110 100 110 Q160 110 160 170 Z" fill="#fff"/></svg>`;
}
function coupleSilhouette(bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><circle cx="75" cy="75" r="28" fill="#fff"/><path d="M30 165 Q30 115 75 115 Q120 115 120 165 Z" fill="#fff"/><circle cx="130" cy="80" r="26" fill="#ffffffcc"/><path d="M88 168 Q88 122 130 122 Q172 122 172 168 Z" fill="#ffffffcc"/></svg>`;
}
function familySilhouette(bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><circle cx="60" cy="70" r="24" fill="#fff"/><path d="M25 165 Q25 122 60 122 Q95 122 95 165 Z" fill="#fff"/><circle cx="140" cy="70" r="24" fill="#ffffffcc"/><path d="M105 165 Q105 122 140 122 Q175 122 175 165 Z" fill="#ffffffcc"/><circle cx="100" cy="112" r="16" fill="#ffffffee"/><path d="M76 168 Q76 142 100 142 Q124 142 124 168 Z" fill="#ffffffee"/></svg>`;
}
function buildingSilhouette(bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><path d="M100 30 L170 72 L30 72 Z" fill="#fff"/><rect x="38" y="78" width="12" height="78" fill="#fff"/><rect x="66" y="78" width="12" height="78" fill="#fff"/><rect x="94" y="78" width="12" height="78" fill="#fff"/><rect x="122" y="78" width="12" height="78" fill="#fff"/><rect x="150" y="78" width="12" height="78" fill="#fff"/><rect x="25" y="158" width="150" height="14" fill="#fff"/></svg>`;
}

function missionaryPhoto(isFamily, childCount) {
  const bg = pick(SILHOUETTE_COLORS);
  const svg = childCount > 0 ? familySilhouette(bg) : isFamily ? coupleSilhouette(bg) : personSilhouette(bg);
  return svgDataUri(svg);
}
function orgLogo() {
  return svgDataUri(buildingSilhouette(pick(SILHOUETTE_COLORS)));
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
        photos: { create: { url: missionaryPhoto(isFamily, childCount), receivedDate: dateBetween(1, 0) } },
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
        sendingChurch: {
          create: sentByOurChurch
            ? {
                name: churchSettings.churchName,
                contactName: churchSettings.contactName,
                contactEmail: churchSettings.contactEmail,
                websiteLink: churchSettings.websiteLink,
                phone: churchSettings.phone,
                mailingAddress: churchSettings.address || {},
              }
            : {
                name: fallbackChurchName,
                contactName: `${pick(FIRST_M.concat(FIRST_F))} ${pick(LAST)}`,
                contactEmail: chance(0.6) ? `missions@${slugify(fallbackChurchName)}.example.org` : null,
                websiteLink: chance(0.5) ? `https://${slugify(fallbackChurchName)}.example.org` : null,
                phone: chance(0.5) ? fakePhone() : null,
              },
        },
        sendingOrg: {
          create: {
            name: sendingOrgName,
            contactName: `${pick(FIRST_M.concat(FIRST_F))} ${pick(LAST)}`,
            contactEmail: chance(0.7) ? `partnercare@${slugify(sendingOrgName)}.example.org` : null,
            websiteLink: chance(0.6) ? `https://${slugify(sendingOrgName)}.example.org` : null,
            phone: chance(0.5) ? fakePhone() : null,
          },
        },
        ...attribution,
      },
    });

    await maybeAddNewsletter({ missionaryId: createdMissionary.id, name: displayName, slug: last.toLowerCase(), field: fieldInfo.field });
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
        photos: { create: { url: orgLogo(), receivedDate: dateBetween(1, 0) } },
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
        ...attribution,
      },
    });

    await maybeAddNewsletter({ organizationId: created.id, name, slug: slugify(name), field: fieldInfo.field });
  }

  const finalMissionaries = await prisma.missionary.count();
  const finalOrgs = await prisma.organization.count();
  console.log(`Done. Missionaries: ${finalMissionaries}, Organizations: ${finalOrgs}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
