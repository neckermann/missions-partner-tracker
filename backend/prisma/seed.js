// Demo/example data generator: fills an empty database with varied missionary and organization
// partners, all randomly generated from the pools below, so every feature has something to show.
// Run with `npm run seed` from backend/.
require("dotenv").config({ quiet: true });
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const {
  personSilhouette,
  coupleSilhouette,
  familySilhouette,
  buildingSilhouette,
} = require("../src/utils/silhouette");
const { generateShareToken } = require("../src/utils/tripAccessToken");
const { demoDisabledFeatureFlags } = require("../src/utils/demoMode");
const { replaceQuestions, replaceRequirementItems, answerRows } = require("../src/utils/tripTemplates");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Overridable via env. Checks presence rather than using `||`, which would treat an explicit 0
// as unset.
const MISSIONARY_COUNT = process.env.SEED_MISSIONARY_COUNT ? Number(process.env.SEED_MISSIONARY_COUNT) : 35;
const ORGANIZATION_COUNT = process.env.SEED_ORGANIZATION_COUNT
  ? Number(process.env.SEED_ORGANIZATION_COUNT)
  : 12;
// Off for route-test/CI databases: those suites assert on InboundEmail/DispatchRecord/User
// tables assuming only their own fixtures exist (CONTRIBUTING.md § Local development data). CI's
// e2e job and scripts/test-db.js set it to "false".
const SEED_DEMO_EXTRAS = process.env.SEED_DEMO_EXTRAS !== "false";

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
// A date `years` ago, give or take a few months, on a random day of that month. Built in UTC:
// these columns are @db.Date, so Prisma stores the UTC calendar date, and building it in local
// time shifted every date a day after about 7pm US Eastern.
function dateYearsAgo(years, monthsJitter = 6) {
  const now = new Date();
  const year = now.getUTCFullYear() - years;
  // Date.UTC rolls a negative month back a year, so no wrap-around arithmetic is needed.
  const month = now.getUTCMonth() - randInt(0, monthsJitter);
  // Day 0 of the following month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, randInt(1, daysInMonth)));
}

function daysAfter(start, days) {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}
function dateBetween(startYearsAgo, endYearsAgo) {
  return dateYearsAgo(randInt(endYearsAgo, startYearsAgo));
}
function fakePhone() {
  return `(${randInt(200, 999)}) 555-${String(randInt(0, 9999)).padStart(4, "0")}`;
}

const US_CITY_POOL = [
  { city: "Rock Island", state: "IL", zip: "61201" },
  { city: "Davenport", state: "IA", zip: "52801" },
  { city: "Moline", state: "IL", zip: "61265" },
  { city: "Bettendorf", state: "IA", zip: "52722" },
  { city: "Peoria", state: "IL", zip: "61602" },
  { city: "Springfield", state: "IL", zip: "62701" },
  { city: "Cedar Rapids", state: "IA", zip: "52401" },
  { city: "Dubuque", state: "IA", zip: "52001" },
  { city: "Kansas City", state: "MO", zip: "64105" },
  { city: "St. Louis", state: "MO", zip: "63101" },
  { city: "Columbus", state: "OH", zip: "43215" },
  { city: "Indianapolis", state: "IN", zip: "46204" },
];
const STREET_SUFFIXES = ["Street", "Avenue", "Court", "Drive", "Lane", "Way", "Boulevard"];
const STREET_NAMES = [
  "Maple",
  "Oak",
  "Birch",
  "Sycamore",
  "Cedar",
  "Elm",
  "Hawthorn",
  "Willow",
  "Sunset",
  "Fairview",
  "Hillcrest",
  "Meadow",
];
function fakeUsAddress() {
  const place = pick(US_CITY_POOL);
  return {
    addressLine1: `${randInt(10, 9999)} ${pick(STREET_NAMES)} ${pick(STREET_SUFFIXES)}`,
    city: place.city,
    stateProvinceRegion: place.state,
    postalCode: place.zip,
    country: "USA",
  };
}
// A plausible emergency contact who is not the participant: a family member sharing their last
// name.
function fakeEmergencyContact(participantLastName) {
  const firstName = pick(FIRST_M.concat(FIRST_F));
  const lastName = participantLastName || pick(LAST);
  const emailLocal = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, "");
  return {
    emergencyContactFirstName: firstName,
    emergencyContactLastName: lastName,
    emergencyContactPhone: fakePhone(),
    emergencyContactEmail: `${emailLocal}@example.com`,
  };
}
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Deliberately fictional names; none should coincide with a real partner family.
const FIRST_M = [
  "Aaron",
  "Bill",
  "Bob",
  "Bobby",
  "Charles",
  "Craig",
  "David",
  "Dan",
  "Eric",
  "Frank",
  "Gary",
  "Greg",
  "Henry",
  "Jack",
  "James",
  "Jason",
  "Jeff",
  "John",
  "Josh",
  "Kevin",
  "Mark",
  "Matt",
  "Michael",
  "Nathan",
  "Paul",
  "Peter",
  "Phil",
  "Rick",
  "Robert",
  "Ryan",
  "Sam",
  "Scott",
  "Steve",
  "Tim",
  "Tom",
  "Tyler",
  "Wayne",
  "Andrew",
  "Brian",
  "Chris",
  "Derek",
  "Ethan",
  "Gavin",
  "Ian",
  "Jared",
  "Lucas",
  "Marcus",
  "Owen",
];
const FIRST_F = [
  "Amanda",
  "Amy",
  "Angela",
  "Anna",
  "Barbara",
  "Beth",
  "Carol",
  "Cathy",
  "Christy",
  "Debbie",
  "Diane",
  "Elizabeth",
  "Emily",
  "Emma",
  "Erin",
  "Grace",
  "Hannah",
  "Jenny",
  "Julie",
  "Karen",
  "Katie",
  "Kim",
  "Laura",
  "Linda",
  "Lisa",
  "Lori",
  "Mary",
  "Melissa",
  "Michelle",
  "Nancy",
  "Rachel",
  "Rebecca",
  "Sandy",
  "Sarah",
  "Stephanie",
  "Susan",
  "Tammy",
  "Tracy",
  "Wendy",
  "Kathy",
  "Alyssa",
  "Brooke",
  "Danielle",
  "Faith",
  "Heather",
  "Jasmine",
  "Megan",
  "Olivia",
];
const LAST = [
  "Whitfield",
  "Ashworth",
  "Callahan",
  "Delacroix",
  "Everhart",
  "Fairweather",
  "Gallagher",
  "Hensley",
  "Ironside",
  "Jorgensen",
  "Kavanagh",
  "Lindholm",
  "Marchetti",
  "Norwood",
  "Ostrander",
  "Prescott",
  "Quintero",
  "Ravenscroft",
  "Sinclair",
  "Thackeray",
  "Underhill",
  "Vandermeer",
  "Wexford",
  "Yardley",
  "Zelinski",
  "Abernathy",
  "Bramwell",
  "Castellano",
  "Draycott",
  "Ellsworth",
  "Farnsworth",
  "Greenfield",
  "Isherwood",
  "Kirkland",
  "Larrabee",
  "Moreland",
  "Nettleton",
  "Oakleigh",
  "Pemberton",
  "Radcliffe",
  "Stanhope",
  "Tillman",
  "Wentworth",
  "Ashby",
  "Blackwood",
  "Chessington",
  "Dunmore",
  "Holloway",
];

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
  {
    field: "Western Guatemala",
    city: "Quetzaltenango",
    country: "Guatemala",
    fips: "GT",
    lat: 14.83,
    lng: -91.52,
  },
  { field: "Honduras", city: "Tegucigalpa", country: "Honduras", fips: "HO", lat: 14.07, lng: -87.19 },
  { field: "Cusco Region", city: "Cusco", country: "Peru", fips: "PE", lat: -13.53, lng: -71.97 },
  { field: "Andean Ecuador", city: "Quito", country: "Ecuador", fips: "EC", lat: -0.18, lng: -78.47 },
  { field: "Bolivia", city: "La Paz", country: "Bolivia", fips: "BL", lat: -16.5, lng: -68.15 },
  { field: "Amazon Basin", city: "Manaus", country: "Brazil", fips: "BR", lat: -3.1, lng: -60.02 },
  {
    field: "Transylvania Region",
    city: "Cluj-Napoca",
    country: "Romania",
    fips: "RO",
    lat: 46.77,
    lng: 23.6,
  },
  { field: "Western Ukraine", city: "Lviv", country: "Ukraine", fips: "UP", lat: 49.84, lng: 24.03 },
  { field: "Albania", city: "Tirana", country: "Albania", fips: "AL", lat: 41.33, lng: 19.82 },
  { field: "Catalonia", city: "Barcelona", country: "Spain", fips: "SP", lat: 41.39, lng: 2.17 },
  { field: "Southern Germany", city: "Munich", country: "Germany", fips: "GM", lat: 48.14, lng: 11.58 },
  { field: "Rhône-Alpes", city: "Lyon", country: "France", fips: "FR", lat: 45.76, lng: 4.83 },
  {
    field: "Papua New Guinea Highlands",
    city: "Mount Hagen",
    country: "Papua New Guinea",
    fips: "PP",
    lat: -5.86,
    lng: 144.23,
  },
  { field: "Southwest China", city: "Kunming", country: "China", fips: "CH", lat: 25.04, lng: 102.71 },
];

const FOCUS_POOL = [
  "church planting",
  "discipleship training",
  "Bible translation",
  "leadership development",
  "orphan and widow care",
  "medical outreach",
  "evangelism",
  "VBS and children's ministry",
  "pastor training",
  "community development",
  "literacy education",
  "clean water projects",
  "women's ministry",
  "youth ministry",
  "refugee ministry",
  "prison ministry",
  "radio broadcasting",
  "Bible college teaching",
  "campus ministry",
  "sports outreach",
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

function joinFocus(list) {
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}
const OVERVIEW_TEMPLATES = [
  (name, f, focusList, year, fam) =>
    `${name} ${fam ? "have" : "has"} served in ${f.field} since ${year}, focusing on ${joinFocus(focusList)}. ${pick(CLOSING_SENTENCES)}`,
  (name, f, focusList, year, fam) =>
    `Since ${year}, ${name} ${fam ? "have" : "has"} called ${f.city}, ${f.country} home, investing ${fam ? "their lives" : "their life"} in ${joinFocus(focusList)}. ${pick(CLOSING_SENTENCES)}`,
  (name, f, focusList, year) =>
    `${name} moved to ${f.field} in ${year} with a vision for ${joinFocus(focusList)}. ${pick(CLOSING_SENTENCES)}`,
  (name, f, focusList, year, fam) =>
    `For ${Math.max(1, new Date().getFullYear() - year)} years, ${name} ${fam ? "have" : "has"} poured ${fam ? "their lives" : "their life"} into ${f.field}, especially ${joinFocus(focusList)}. ${pick(CLOSING_SENTENCES)}`,
  (name, f, focusList, year, fam) =>
    `${name} first arrived in ${f.country} in ${year} and ${fam ? "have" : "has"} devoted themselves to ${joinFocus(focusList)} ever since. ${pick(CLOSING_SENTENCES)}`,
  (name, f, focusList, year, fam) =>
    `Based in ${f.city} since ${year}, ${name} ${fam ? "spend" : "spends"} most of their time on ${joinFocus(focusList)}. ${pick(CLOSING_SENTENCES)}`,
];
const SHORT_TEMPLATES = [
  (f, focusList, year) => `Serving in ${f.field} since ${year}, focused on ${focusList[0]}.`,
  (f, focusList, year) => `In ${f.field} since ${year} — ${focusList[0]}.`,
  (f, focusList, year) => `${f.field} since ${year}: ${joinFocus(focusList.slice(0, 2))}.`,
  (f, focusList, year) => `Based in ${f.city} since ${year}, focused on ${focusList[0]}.`,
];

// Default e-signature requirement text, shared with the first-run setup path (routes/auth.js) so
// dev-demo gets the same starting point as a new fork.
const { readPackFile, importPackFile } = require("../src/utils/packFiles");
const STARTER_REQUIREMENTS = readPackFile("trip-requirements-starter").data.tripRequirementTemplate;
const LIABILITY_RELEASE_TEXT = STARTER_REQUIREMENTS[0].bodyText;
const MINOR_RELEASE_TEXT = STARTER_REQUIREMENTS[1].bodyText;

const PASSPORT_OPTIONS = [
  "Yes, I have a passport that will be valid for at least 6 months from the time the trip starts",
  "No, I do not have a passport, but there is enough time to get one before the deadline",
  "No, and there is not enough time to get one before the deadline",
];

// Application questions are real rows. The seed writes them as lists (the shape the API takes)
// and answers as { questionId: answer }, which these helpers turn into rows.
const SEED_TEMPLATE_QUESTIONS = [
  {
    id: "tmpl2",
    type: "select",
    label: "Are you willing to raise the funds needed for this trip and meet payment deadlines?",
    required: true,
    options: ["Yes", "No"],
  },
  {
    id: "tmpl3",
    type: "select",
    label:
      "Do you agree to follow the team's code of conduct during the trip? If accepted, you will be required to sign a full copy of the code of conduct.",
    required: true,
    options: ["Yes", "No"],
  },
  {
    id: "tmpl6",
    type: "textarea",
    label: "Tell us about your faith journey and how you came to follow Jesus.",
    required: false,
  },
  {
    id: "tmpl7",
    type: "textarea",
    label: "What are your expectations for this trip?",
    required: false,
  },
  {
    id: "tmpl8",
    type: "text",
    label: "Health insurance company and policy/group number",
    required: false,
  },
];
const SEED_LIBRARY_QUESTIONS = [
  {
    id: "lib4",
    type: "select",
    label: "Do you have a valid passport, or could you get one before the trip departs?",
    required: true,
    options: PASSPORT_OPTIONS,
  },
  {
    id: "lib5",
    type: "select",
    label: "Are you comfortable with texting as a way for the team to reach you?",
    required: false,
    options: ["Yes", "No"],
  },
  { id: "lib6", type: "text", label: "Occupation", required: false },
  {
    id: "lib7",
    type: "select",
    label: "Marital status",
    required: false,
    options: ["Single", "Married"],
  },
];
const SEED_OPEN_TRIP_QUESTIONS = [
  { id: "q1", label: "Do you have any dietary restrictions?", required: false },
  {
    id: "q3",
    type: "select",
    label: "Do you have a valid passport?",
    required: true,
    options: PASSPORT_OPTIONS,
  },
  {
    id: "q4",
    type: "checkboxes",
    label: "Which skills could you contribute to this trip? (check all that apply)",
    required: false,
    options: [
      "Construction",
      "Medical/Nursing",
      "Teaching/Children's ministry",
      "Translation",
      "Cooking/Hospitality",
      "Worship/Music",
    ],
  },
];
const SEED_RESTRICTED_TRIP_QUESTIONS = [
  {
    id: "q1",
    type: "select",
    label: "Do you have a valid passport?",
    required: true,
    options: PASSPORT_OPTIONS,
  },
];

// The seed's readable ids ("tmpl2", "q1") become real ids on save; this keeps the way back.
async function seedQuestionList(scope, tripId, items) {
  const saved = await replaceQuestions(prisma, scope, tripId, items);
  return { saved, ids: new Map(items.map((q, n) => [q.id, saved[n].id])) };
}

// Answers given in the seed's literals, held until their application exists (keyed by email).
const SEED_RESPONSES = new Map();
function stripResponses(data) {
  if (data.responses) {
    SEED_RESPONSES.set(data.email, data.responses);
    delete data.responses;
  }
  for (const app of data.applications?.create || []) stripResponses(app);
  return data;
}
async function attachSeedAnswers(tripId, sets) {
  const ids = new Map(sets.flatMap((set) => [...set.ids]));
  const questions = sets.flatMap((set) => set.saved);
  const apps = await prisma.tripApplication.findMany({
    where: { tripId },
    select: { id: true, email: true },
  });
  for (const app of apps) {
    const responses = SEED_RESPONSES.get(app.email);
    if (!responses) continue;
    const remapped = Object.fromEntries(Object.entries(responses).map(([k, v]) => [ids.get(k) ?? k, v]));
    await prisma.tripApplicationAnswer.createMany({
      data: answerRows(questions, remapped).map((row) => ({ ...row, applicationId: app.id })),
    });
  }
}

const TRIP_TYPES = [
  "Construction",
  "Medical/Dental",
  "VBS/Children's Ministry",
  "Evangelism/Outreach",
  "Teaching/Discipleship",
  "Prayer",
  "General Labor",
  "Sports Ministry",
  "Music/Worship",
  "Administrative/Support",
];
const TRIP_ROLES = [
  "Team Leader",
  "Construction",
  "Medical",
  "Translator",
  "Photographer",
  "Youth Ministry",
  "Cook",
  "Logistics",
];
const LANGUAGES_POOL = [
  "Spanish",
  "Portuguese",
  "French",
  "Swahili",
  "Thai",
  "Japanese",
  "Mandarin",
  "Khmer",
  "Amharic",
  "Luganda",
  "Quechua",
  "Tagalog",
  "Vietnamese",
  "Hindi",
  "Romanian",
  "Mongolian",
];
const PROFICIENCY_LEVELS = ["0", "0+", "1", "1+", "2", "2+", "3", "3+", "4", "4+", "5"];
function buildLanguages() {
  return pickN(LANGUAGES_POOL, randInt(0, 2)).map((language) => ({
    language,
    proficiency: chance(0.7) ? pick(PROFICIENCY_LEVELS) : null,
  }));
}

function buildLinks(slug) {
  const candidates = [
    chance(0.4) ? { type: "website", url: `https://${slug}.example.com` } : null,
    chance(0.5) ? { type: "support", url: `https://give.example.com/${slug}` } : null,
    chance(0.35) ? { type: "newsletterSignup", url: `https://newsletter.example.com/${slug}` } : null,
    chance(0.5) ? { type: "facebook", url: `https://facebook.com/${slug}` } : null,
    chance(0.2) ? { type: "twitter", url: `https://twitter.com/${slug}` } : null,
    chance(0.4) ? { type: "instagram", url: `https://instagram.com/${slug}` } : null,
    chance(0.15) ? { type: "linkedin", url: `https://linkedin.com/in/${slug}` } : null,
  ];
  return candidates.filter(Boolean);
}
const SENDING_ORGS = [
  "ABWE",
  "SEND International",
  "Josiah Venture",
  "WorldVenture",
  "TEAM",
  "Pioneers",
  "International Mission Board",
  "OMF International",
  "Wycliffe Bible Translators",
];
// Fallback for SendingChurch: Church Settings is usually not configured yet when the seed runs
// (migrate -> seed -> createAdmin).
const FALLBACK_CHURCH_NAMES = [
  "Grace Community Church",
  "First Baptist Church",
  "Crossroads Fellowship",
  "Hillside Community Church",
  "Faith Community Church",
  "Riverside Chapel",
];
const CONTACT_METHODS = ["email", "call", "whatsapp", "signal", "text"];

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

const NEWSLETTER_SUBJECTS = [
  "Ministry Update",
  "Prayer Letter",
  "Quarterly Newsletter",
  "Field Update",
  "Year-End Update",
];
const NEWSLETTER_SEASONS = ["Winter", "Spring", "Summer", "Fall"];
const NEWSLETTER_OPENERS = [
  "Thank you for your continued prayers and support",
  "We wanted to share a quick update on what God has been doing",
  "It's been a full season, and we're grateful for a chance to catch you up",
  "As always, we're thankful for this church family standing behind us",
];

// Some newsletters/documents get a prayer request and/or one-time need so the AI request scanner
// (utils/extraction.js) has something to find on a fresh instance.
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
  (amount) =>
    `Our vehicle needs significant repairs, and we're asking for help covering the $${amount} cost.`,
  (amount) =>
    `We have an unexpected medical bill of $${amount} and would be grateful for any support toward it.`,
  (amount) => `We're hoping to raise $${amount} to replace ministry equipment that broke down recently.`,
  (amount) => `A specific need has come up -- we're asking for help with $${amount} in visa renewal fees.`,
  (amount) =>
    `We're believing God for provision toward a $${amount} need to repair storm damage to our home here.`,
  () =>
    `We're trusting God for provision to cover an unexpected need this month -- if you feel led to help, please reach out.`,
];

function scannableExtras() {
  const parts = [];
  if (chance(0.4)) parts.push(`Prayer requests:\n${pick(PRAYER_REQUEST_LINES)}`);
  if (chance(0.2)) {
    const line = pick(ONE_TIME_NEED_LINES);
    const amount = randInt(2, 20) * 100;
    parts.push(`One-time need:\n${line(amount)}`);
  }
  return parts.join("\n\n");
}

// Uploaded as .eml: trivially valid, and a file type Newsletters & Docs already supports
// (routes/partnerFiles.js resolveExt).
function buildFakeEml(fromName, fromSlug, subject, field) {
  const extras = scannableExtras();
  const body = `${pick(NEWSLETTER_OPENERS)} as we serve in ${field}. This season has brought both challenges and encouragement, and we're excited to share a bit of both with you.${extras ? `\n\n${extras}` : ""}\n\nThank you for partnering with us.\n\nIn Him,\n${fromName}`;
  const eml = [
    `From: ${fromName} <${fromSlug}@example.com>`,
    `To: receive@updates.missionspartnertracker.com`,
    `Subject: ${subject}`,
    `Date: ${dateBetween(1, 0).toUTCString()}`,
    `Content-Type: text/plain; charset="utf-8"`,
    ``,
    body,
    ``,
  ].join("\r\n");
  return Buffer.from(eml, "utf-8");
}

async function maybeAddNewsletter({ partnerId, name, slug, field }) {
  if (!chance(0.3)) return;
  const subject = `${pick(NEWSLETTER_SUBJECTS)} — ${pick(NEWSLETTER_SEASONS)} ${randInt(2023, 2026)}`;
  const buffer = buildFakeEml(name, slug, subject, field);
  await prisma.partnerFile.create({
    data: {
      partnerId,
      kind: "newsletter",
      title: subject,
      receivedDate: dateBetween(1, 0),
      bytesRow: { create: { bytes: buffer } },
      fileName: "update.eml",
      contentType: "message/rfc822",
      fileSize: buffer.length,
    },
  });
}

// Titles per document kind; keys are routes/fileKinds.js's FILE_KINDS.
const DOCUMENT_TITLES = {
  survey_response: [
    "Annual Field Survey Response",
    "Mid-Year Check-In Survey",
    "Partner Satisfaction Survey",
  ],
  signed_policy: [
    "Signed Child Protection Policy",
    "Signed Code of Conduct",
    "Signed Financial Accountability Agreement",
  ],
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

// ~90 chars fits within the page margins at 11pt Helvetica (a rough estimate, fine for
// placeholder text).
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

// A structurally valid single-page PDF (byte-accurate xref table) with the title and any
// scannable extras rendered as text, so it passes routes/documents.js's signature check and
// opens to something. Built by hand to avoid a PDF library.
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

async function maybeAddDocument({ partnerId, name, slug, field }) {
  if (!chance(0.35)) return;
  const kind = pick(["survey_response", "signed_policy", "office_document", "email", "other"]);
  const isOther = kind === "other";
  const title = isOther ? pick(OTHER_DOCUMENT_TITLES) : pick(DOCUMENT_TITLES[kind]);
  const customKind = isOther ? pick(OTHER_DOCUMENT_CATEGORIES) : null;

  let buffer, fileName, contentType;
  if (kind === "email") {
    buffer = buildFakeEml(name, slug, title, field);
    fileName = "email.eml";
    contentType = "message/rfc822";
  } else {
    const extraText = kind === "office_document" || kind === "survey_response" ? scannableExtras() : "";
    buffer = buildFakePdf(title, extraText);
    fileName = "document.pdf";
    contentType = "application/pdf";
  }

  await prisma.partnerFile.create({
    data: {
      partnerId,
      kind,
      customKind,
      title,
      receivedDate: dateBetween(1, 0),
      notes: chance(0.5) ? pick(DOCUMENT_NOTES) : null,
      bytesRow: { create: { bytes: buffer } },
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

// Shape builders live in src/utils/silhouette.js (shared with maskData.js); here a random color
// per record gives variety when Pexels isn't configured.
const SILHOUETTE_COLORS = ["2a5d3c", "1d4e89", "8a3324", "6b4c9a", "b45309", "0f766e", "7c2d12", "4338ca"];

// Returns { bytes, contentType }, the same shape as downloadAndUploadPhoto's real-photo path.
function missionaryPhoto(isFamily, childCount) {
  const bg = pick(SILHOUETTE_COLORS);
  const svg = childCount > 0 ? familySilhouette(bg) : isFamily ? coupleSilhouette(bg) : personSilhouette(bg);
  return { bytes: Buffer.from(svg, "utf-8"), contentType: "image/svg+xml" };
}
function orgLogo() {
  return {
    bytes: Buffer.from(buildingSilhouette(pick(SILHOUETTE_COLORS)), "utf-8"),
    contentType: "image/svg+xml",
  };
}

// Real stock photos via Pexels (optional): without PEXELS_API_KEY, or on a failed request,
// everything falls back to the silhouettes above, so seeding never fails over a third-party
// outage.
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

// Keys match missionaryPhotoCategory()'s return values. Pexels has no content-matching guarantee
// beyond its own tagging, so results are best effort.
const PEXELS_MISSIONARY_QUERIES = {
  single_adult: ["portrait of adult smiling", "young professional headshot"],
  couple: ["husband and wife portrait smiling", "man and woman couple portrait outdoor"],
  family_with_kids: ["mother father and children portrait", "mom dad kids family outdoor portrait"],
  large_family: ["mom dad grandparents family group portrait", "parents children large family portrait"],
};
// Deliberately not "logo"/"brand" terms: stock libraries tag unrelated, sometimes inappropriate
// product photography with them. These ask for church/missions photography instead.
const PEXELS_ORG_QUERIES = [
  "church building exterior",
  "mission trip volunteers serving community",
  "world map globe",
];

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
    // .large (~940px), not .medium, so it holds up on the partner detail hero photo.
    return (data.photos || []).map((p) => p.src.large);
  } catch (err) {
    console.warn(`  Pexels search errored for "${query}":`, err.message);
    return [];
  }
}

// Fisher-Yates shuffle once per pool; photos are handed out in that order, wrapping around, so a
// run of 50 missionaries doesn't repeat the same few photos.
function shuffled(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Called once per seed run: one search per query, not per partner, to stay under Pexels'
// free-tier rate limit.
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
  for (const q of PEXELS_ORG_QUERIES) orgUrls = orgUrls.concat(await fetchPexelsPhotos(q));
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

// Downloads the image bytes from Pexels' CDN and stores them like a real upload (never a hotlink
// that could change or fail CSP).
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

const ALBUM_PROVIDERS = ["google_photos", "icloud", "other"];

function buildTrips(participantNamePool) {
  const count = randInt(0, 3);
  const trips = [];
  for (let i = 0; i < count; i++) {
    const start = dateBetween(4, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + randInt(5, 12));
    const participants = pickN(participantNamePool, randInt(2, 5)).map((name) => {
      const [firstName, ...rest] = name.split(" ");
      const lastName = rest.join(" ") || null;
      return {
        firstName,
        lastName,
        role: pick(TRIP_ROLES),
        phone: fakePhone(),
        email: chance(0.5) ? `${name.toLowerCase().replace(/\s+/g, ".")}@example.com` : null,
        dateOfBirth: dateBetween(65, 22),
        ...fakeUsAddress(),
        ...fakeEmergencyContact(lastName),
      };
    });
    const hasAlbum = chance(0.3);
    trips.push({
      status: "completed",
      startDate: start,
      endDate: end,
      type: pick(TRIP_TYPES),
      description: `Team served alongside the field, focusing on ${pick(FOCUS_POOL)}.`,
      notes: chance(0.4) ? pick(TRIP_NOTES) : null,
      albumProvider: hasAlbum ? pick(ALBUM_PROVIDERS) : null,
      albumUrl: hasAlbum ? "https://photos.example.com/album/trip" : null,
      participants: { create: participants },
    });
  }
  return trips;
}

function buildSupportEntries() {
  const base = randInt(12, 64) * 25; // $300 - $1600, in $25 increments
  const entries = [{ amount: base, effectiveDate: dateBetween(1, 0), notes: null }];
  if (chance(0.5)) {
    entries.push({
      amount: Math.max(200, base - randInt(1, 6) * 25),
      effectiveDate: dateBetween(3, 1),
      notes: "Adjusted after annual budget review.",
    });
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

// Not every partner gets one. status is deliberately not weighted toward "answered": most real
// prayer requests are still open.
function buildPrayerRequests() {
  const count = chance(0.6) ? randInt(1, 3) : 0;
  return Array.from({ length: count }, () => {
    const category = chance(0.5) ? "strategic" : "situational";
    const isStrategic = category === "strategic";
    const requestText = pick(isStrategic ? STRATEGIC_PRAYER_REQUESTS : SITUATIONAL_PRAYER_REQUESTS);
    const status = isStrategic
      ? pick(["ongoing", "ongoing", "ongoing", "answered"])
      : pick(["untracked", "untracked", "ongoing"]);
    const answered = status === "answered";
    const isPublic = isStrategic && chance(0.7);
    return {
      category,
      requestText,
      dateReceived: dateBetween(2, 0),
      isPublic,
      includeInBooklet: isPublic && chance(0.6),
      status,
      dateAnswered: answered ? dateBetween(0, 0) : null,
      answeredNote: answered && chance(0.7) ? pick(ANSWERED_NOTES) : null,
      notes: chance(0.15) ? "Shared during a support-team update call." : null,
    };
  });
}

const NEED_DECISION_NOTES = {
  full: [
    "Approved in full at the last missions committee meeting.",
    "Covered entirely from this quarter's designated giving.",
    "Full funding approved -- a clear, time-sensitive need.",
  ],
  partial: [
    "Partially funded from the general missions budget; the rest is being raised separately.",
    "Approved at half the requested amount, pending additional designated gifts.",
    "Partial funding approved this cycle, to be revisited next quarter.",
  ],
  declined: [
    "Declined this cycle -- outside what the missions budget can cover right now.",
    "Not approved; committee asked for more detail before reconsidering.",
    "Declined -- already covered through another source.",
  ],
};

function buildNeedRequests() {
  if (!chance(0.55)) return [];
  const count = chance(0.25) ? 2 : 1;
  return Array.from({ length: count }, () => {
    const requested = randInt(4, 40) * 50;
    const decided = chance(0.65);
    let approvedAmount = null;
    let approvedDate = null;
    let decisionNote = null;
    if (decided) {
      approvedDate = dateBetween(1, 0);
      const outcome = pick(["full", "partial", "declined"]);
      approvedAmount =
        outcome === "full" ? requested : outcome === "partial" ? Math.round(requested * 0.5) : 0;
      decisionNote = chance(0.75) ? pick(NEED_DECISION_NOTES[outcome]) : null;
    }
    return {
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
      decisionNote,
      notes: chance(0.3)
        ? pick([
            "Discussed with the missions committee before approval.",
            "Time-sensitive — needed before the next field visit.",
            "Follow-up request from a previous conversation.",
          ])
        : null,
    };
  });
}

function buildChurchVisits() {
  const count = chance(0.55) ? randInt(1, 2) : 0;
  const visits = [];
  for (let i = 0; i < count; i++) {
    visits.push({ visitDate: dateBetween(3, 0), notes: chance(0.3) ? pick(CHURCH_VISIT_NOTES) : null });
  }
  return { create: visits };
}

const UNMATCHED_EMAIL_SENDERS = [
  { name: "Pastor Mike Reynolds", email: "mike.reynolds@gracefellowship.example.org" },
  { name: "Linda Thompson", email: "linda.thompson@example.com" },
  { name: "ABWE Partner Care", email: "partnercare@abwe.example.org" },
  { name: "David Okafor", email: "d.okafor@example.com" },
  { name: "Wycliffe Finance Office", email: "finance@wycliffe.example.org" },
];
const UNMATCHED_EMAIL_SUBJECTS = [
  "Question about our giving statement",
  "New missionary family looking for a sending church",
  "Update on partnership opportunity",
  "Re: Field visit next spring",
  "Checking in -- it's been a while!",
];
const UNMATCHED_EMAIL_OPENERS = [
  "Just wanted to reach out and reconnect.",
  "Wondering if you could help point us in the right direction.",
  "Following up on our conversation from a few weeks back.",
];

// Seeds the Unmatched Emails queue (routes/inboundEmail.js), which nothing else fills.
// fromAddress is deliberately unrelated to any seeded partner.
async function seedUnmatchedEmails() {
  const count = randInt(3, 5);
  console.log(`Seeding ${count} unmatched inbound emails...`);
  for (let i = 0; i < count; i++) {
    const sender = pick(UNMATCHED_EMAIL_SENDERS);
    const subject = pick(UNMATCHED_EMAIL_SUBJECTS);
    const receivedAt = new Date(Date.now() - randInt(1, 21) * 24 * 60 * 60 * 1000);
    const body = `Hi,\n\nI hope this finds you well. ${pick(UNMATCHED_EMAIL_OPENERS)}\n\nThanks,\n${sender.name}`;
    const eml = [
      `From: ${sender.name} <${sender.email}>`,
      `To: receive@updates.missionspartnertracker.com`,
      `Subject: ${subject}`,
      `Date: ${receivedAt.toUTCString()}`,
      `Content-Type: text/plain; charset="utf-8"`,
      ``,
      body,
      ``,
    ].join("\r\n");
    const buffer = Buffer.from(eml, "utf-8");
    await prisma.inboundEmail.create({
      data: {
        fromAddress: sender.email,
        subject,
        bytesRow: { create: { bytes: buffer } },
        fileName: "email.eml",
        receivedAt,
      },
    });
  }
}

const ADDITIONAL_USERS = [
  {
    firstName: "Pat",
    lastName: "Reynolds",
    role: "editor",
    cadence: null,
    active: true,
    mfaSetupRequired: false,
  },
  {
    firstName: "Jordan",
    lastName: "Lee",
    role: "editor",
    cadence: null,
    active: true,
    mfaSetupRequired: true,
  },
  {
    firstName: "Casey",
    lastName: "Nguyen",
    role: "viewer",
    cadence: null,
    active: true,
    mfaSetupRequired: false,
  },
  {
    firstName: "Morgan",
    lastName: "Patel",
    role: "admin",
    cadence: null,
    active: false,
    mfaSetupRequired: false,
  },
];

// More users across roles, active state and MFA-required, so Manage Users has variety.
// mfaSetupRequired, not mfaEnabled: mfaEnabled with no real TOTP secret would lock the account
// out. Random, unknown password (unusablePasswordHash): these accounts only populate the list. None get a
// cadence: their @example.org addresses (RFC 2606) are non-deliverable, and a demo reset must
// never attempt a digest send.
//
// Trips demo data: hand-crafted trips layered on the partners buildTrips() already used: one
// actively recruiting (public) trip with a pending application and partial team, one closed, and
// one restricted-partner trip using the private-link mechanism. Share tokens are generated
// regardless of ChurchSettings.allowPublicSupportRaisingLinks/allowPrivateApplicationLinks (both
// off by default); an admin turns those on to use them.
async function seedTripsDemo() {
  console.log("Seeding Trips (#252) demo data...");
  const [openPartner, closedPartner, restrictedPartner, planningPartner] = await Promise.all([
    prisma.partner.findFirst({
      where: { archived: false, isRestricted: false },
      orderBy: { displayName: "asc" },
    }),
    prisma.partner.findFirst({
      where: { archived: false, isRestricted: false },
      orderBy: { displayName: "desc" },
    }),
    prisma.partner.findFirst({ where: { archived: false, isRestricted: true } }),
    // A third, distinct partner for the planning-stage trip (skip: 1 avoids the first and
    // last).
    prisma.partner.findFirst({
      where: { archived: false, isRestricted: false },
      orderBy: { displayName: "asc" },
      skip: 1,
    }),
  ]);
  if (!openPartner || !closedPartner) return;

  const admin = await prisma.user.findFirst({ where: { role: "admin" } });

  const openStart = dateBetween(-1, -2);
  const openEnd = new Date(openStart);
  openEnd.setDate(openEnd.getDate() + randInt(5, 10));
  const closedStart = dateBetween(-2, -3);
  const closedEnd = new Date(closedStart);
  closedEnd.setDate(closedEnd.getDate() + randInt(5, 10));

  // Flight segments: a two-leg connection for the whole team plus a segment for just two
  // people flying from elsewhere.
  const outboundLeg1Depart = new Date(openStart);
  outboundLeg1Depart.setHours(8, 15, 0, 0);
  const outboundLeg1Arrive = new Date(outboundLeg1Depart.getTime() + 14.5 * 60 * 60 * 1000);
  const outboundLeg2Depart = new Date(outboundLeg1Arrive.getTime() + 2 * 60 * 60 * 1000);
  const outboundLeg2Arrive = new Date(outboundLeg2Depart.getTime() + 5.5 * 60 * 60 * 1000);
  const soloDepart = new Date(openStart);
  soloDepart.setHours(6, 40, 0, 0);
  const soloArrive = new Date(soloDepart.getTime() + 19 * 60 * 60 * 1000);

  const templateSet = await seedQuestionList("template", null, SEED_TEMPLATE_QUESTIONS);
  await seedQuestionList("library", null, SEED_LIBRARY_QUESTIONS);
  // The demo imports the example requirement pack, like a church importing it from Settings.
  await replaceRequirementItems(prisma, "template", []);
  await importPackFile("trip-requirements-starter");
  await replaceRequirementItems(prisma, "library", []);

  const openTrip = await prisma.trip.create({
    data: stripResponses({
      partnerId: openPartner.id,
      name: `${openPartner.displayName.split(" ")[0]}'s Summer Team`,
      status: "accepting_applications",
      isPublic: true,
      type: pick(TRIP_TYPES),
      description: `Join a short-term team serving alongside ${openPartner.displayName}.`,
      startDate: openStart,
      endDate: openEnd,
      teamSizeMin: 4,
      teamSizeMax: 10,
      supportRaisingGoal: 1200,
      // Emergency contact is not repeated here: the church-wide tripApplicationTemplate
      // covers it.
      applications: {
        create: [
          {
            firstName: "James",
            lastName: "Okonkwo",
            email: "james.okonkwo@example.org",
            phone: "555-0198",
            emergencyContactFirstName: "Grace",
            emergencyContactLastName: "Okonkwo",
            emergencyContactPhone: "555-0142",
            emergencyContactEmail: "grace.okonkwo@example.org",
            addressLine1: "482 Maple Street",
            city: "Rock Island",
            stateProvinceRegion: "IL",
            postalCode: "61201",
            country: "USA",
            dateOfBirth: new Date(Date.UTC(1991, 2, 22)),
            responses: {
              tmpl2: "Yes",
              tmpl3: "Yes",
              tmpl6:
                "I grew up going to church, but it wasn't until a mission trip in college that my faith became my own.",
              tmpl7:
                "I'm hoping to serve wherever there's a need and come back with a deeper dependence on God.",
              tmpl8: "Blue Cross Blue Shield, Policy #BC-48213",
              q1: "Vegetarian, no peanuts.",
              q3: "Yes",
              q4: ["Construction", "Cooking/Hospitality"],
            },
          },
          // A declined application, with a declinedReason.
          {
            firstName: "Derek",
            lastName: "Palmquist",
            email: "derek.palmquist@example.org",
            phone: "555-0176",
            emergencyContactFirstName: "Wendy",
            emergencyContactLastName: "Palmquist",
            emergencyContactPhone: "555-0177",
            addressLine1: "19 Birch Court",
            city: "Davenport",
            stateProvinceRegion: "IA",
            postalCode: "52801",
            country: "USA",
            status: "declined",
            declinedReason: "Team is already at capacity for this trip's focus area.",
            reviewedAt: dateBetween(5, 1),
            dateOfBirth: new Date(Date.UTC(1987, 10, 2)),
            responses: {
              tmpl2: "Yes",
              tmpl3: "Yes",
              tmpl6:
                "I've been part of my church's missions committee for three years and wanted to finally go myself.",
              tmpl7: "I expect it to be physically demanding, and I'm ready for that.",
              tmpl8: "Aetna, Group #AE-90217",
              q1: "No restrictions.",
              q3: "No",
              q4: ["Teaching/Children's ministry"],
            },
          },
        ],
      },
      // Budget deliberately doesn't sum to supportRaisingGoal (1200), to show the "differs
      // from your goal" hint.
      budgetLines: {
        create: [
          { label: "Round-trip flights", estimatedAmount: 650 },
          { label: "Lodging", estimatedAmount: 220 },
          { label: "In-country transport", estimatedAmount: 90 },
          { label: "Visa fees", estimatedAmount: 75 },
          { label: "Travel insurance", estimatedAmount: 45 },
        ],
      },
      // Flight segments are created below, once Priya/John exist: the per-participant
      // segment needs their ids.
      // Same e-signature requirement as tripRequirementTemplate below, added directly
      // because this trip is seeded before the template applies. All three TripRequirement
      // kinds are represented, with some participants fulfilling each and others not, so
      // "outstanding" shows beside "done".
      requirements: {
        create: [
          {
            label: "Signed Liability Release and Code of Conduct",
            kind: "esignature",
            bodyText: LIABILITY_RELEASE_TEXT,
          },
          { label: "Passport photo page", kind: "document" },
          { label: "Attended orientation call", kind: "task" },
        ],
      },
    }),
  });
  const openTripSet = await seedQuestionList("trip", openTrip.id, SEED_OPEN_TRIP_QUESTIONS);
  const priya = await prisma.tripParticipant.create({
    data: {
      trip: { connect: { id: openTrip.id } },
      firstName: "Priya",
      lastName: "Krishnan",
      email: "priya.krishnan@example.org",
      role: "Team Lead",
      supportRaisingGoal: 1200,
      shareToken: generateShareToken(),
      story: "I'm excited to serve this summer and would love your support!",
      contributions: {
        create: [
          {
            trip: { connect: { id: openTrip.id } },
            donorName: "Family friend",
            // Only shown when ChurchSettings.collectDonorContactInfo is on (set
            // below).
            donorEmail: "friend.of.priya@example.org",
            donorPhone: "555-0199",
            amount: 200,
            method: "check",
            receivedDate: dateBetween(0, 0),
          },
          {
            trip: { connect: { id: openTrip.id } },
            donorName: "Grandparents",
            amount: 150,
            method: "cash",
            receivedDate: dateBetween(1, 0),
          },
        ],
      },
    },
  });

  // John: the contrast to Priya, with no shareToken, story or fulfilled requirements ("freshly
  // added").
  const john = await prisma.tripParticipant.create({
    data: {
      trip: { connect: { id: openTrip.id } },
      firstName: "John",
      lastName: "Alvarado",
      email: "john.alvarado@example.org",
      supportRaisingGoal: 1200,
    },
  });

  // John's photo, reusing the Pexels pool; with no PEXELS_API_KEY he stays photo-less.
  try {
    const photoPools = await buildPhotoPools();
    const photoUrl = photoPools && nextFromPool(photoPools.single_adult);
    if (photoUrl) {
      const photo = await downloadAndUploadPhoto(photoUrl);
      if (photo) {
        await prisma.tripParticipant.update({
          where: { id: john.id },
          data: { photoBytesRow: { create: { photo: photo.bytes } }, photoContentType: photo.contentType },
        });
      }
    }
  } catch (err) {
    console.warn("  Skipping John's seed photo:", err.message);
  }

  // David: brings the team to teamSizeMin (4). Direct-added with shareToken, story, photo and
  // some support raised, but no emergency contact. Completes only the document requirement.
  const david = await prisma.tripParticipant.create({
    data: {
      trip: { connect: { id: openTrip.id } },
      firstName: "David",
      lastName: "Kim",
      email: "david.kim@example.org",
      phone: "555-0171",
      role: "Logistics",
      supportRaisingGoal: 1200,
      shareToken: generateShareToken(),
      story: "Second time serving on a short-term team -- looking forward to this one!",
      contributions: {
        create: [
          {
            trip: { connect: { id: openTrip.id } },
            donorName: "Small group",
            amount: 400,
            method: "check",
            receivedDate: dateBetween(0, 0),
          },
        ],
      },
    },
  });
  try {
    const photoPools = await buildPhotoPools();
    const photoUrl = photoPools && nextFromPool(photoPools.single_adult);
    if (photoUrl) {
      const photo = await downloadAndUploadPhoto(photoUrl);
      if (photo) {
        await prisma.tripParticipant.update({
          where: { id: david.id },
          data: { photoBytesRow: { create: { photo: photo.bytes } }, photoContentType: photo.contentType },
        });
      }
    }
  } catch (err) {
    console.warn("  Skipping David's seed photo:", err.message);
  }

  // Amara: the participant who came through the real application-to-approval path, so address,
  // emergency contact and role arrive pre-filled and the "Application answers" section has
  // data. Mirrors PUT /api/trips/applications/:id's approval branch.
  const amaraApplication = await prisma.tripApplication.create({
    data: stripResponses({
      tripId: openTrip.id,
      firstName: "Amara",
      lastName: "Chukwu",
      email: "amara.chukwu@example.org",
      phone: "555-0163",
      status: "approved",
      reviewedAt: dateBetween(6, 2),
      reviewedById: admin?.id || null,
      addressLine1: "77 Sycamore Ave",
      addressLine2: "Apt 3B",
      city: "Moline",
      stateProvinceRegion: "IL",
      postalCode: "61265",
      country: "USA",
      emergencyContactFirstName: "Chidi",
      emergencyContactLastName: "Chukwu",
      emergencyContactPhone: "555-0164",
      emergencyContactEmail: "chidi.chukwu@example.org",
      dateOfBirth: new Date(Date.UTC(1995, 6, 19)),
      responses: {
        tmpl2: "Yes",
        tmpl3: "Yes",
        tmpl6: "I've felt called to medical missions since shadowing a clinic team on a previous short trip.",
        tmpl7: "To use my nursing background to serve the team and the local clinic staff well.",
        tmpl8: "UnitedHealthcare, Policy #UH-55820",
        q1: "Lactose intolerant.",
        q3: "Yes",
        q4: ["Medical/Nursing"],
      },
    }),
  });
  await attachSeedAnswers(openTrip.id, [templateSet, openTripSet]);
  const amara = await prisma.tripParticipant.create({
    data: {
      tripId: openTrip.id,
      applicationId: amaraApplication.id,
      firstName: amaraApplication.firstName,
      lastName: amaraApplication.lastName,
      email: amaraApplication.email,
      phone: amaraApplication.phone,
      role: "Medical",
      addressLine1: amaraApplication.addressLine1,
      addressLine2: amaraApplication.addressLine2,
      city: amaraApplication.city,
      stateProvinceRegion: amaraApplication.stateProvinceRegion,
      postalCode: amaraApplication.postalCode,
      country: amaraApplication.country,
      emergencyContactFirstName: amaraApplication.emergencyContactFirstName,
      emergencyContactLastName: amaraApplication.emergencyContactLastName,
      emergencyContactPhone: amaraApplication.emergencyContactPhone,
      emergencyContactEmail: amaraApplication.emergencyContactEmail,
      dateOfBirth: amaraApplication.dateOfBirth,
      supportRaisingGoal: 1200,
      // Raised well short of the goal: a third raised/goal state alongside Priya's
      // (well-funded) and John's ($0).
      contributions: {
        create: [
          {
            trip: { connect: { id: openTrip.id } },
            donorName: "Coworker",
            amount: 75,
            method: "other",
            receivedDate: dateBetween(0, 0),
          },
        ],
      },
    },
  });

  // Flight segments: a two-leg connection for the whole team plus one for just Priya and John
  // flying from elsewhere. Created after the participants exist because the per-participant
  // segment needs their ids.
  await prisma.tripFlightSegment.createMany({
    data: [
      {
        tripId: openTrip.id,
        airline: "Delta",
        flightNumber: "DL 123",
        departureAirport: "ATL",
        departureAt: outboundLeg1Depart,
        arrivalAirport: "ICN",
        arrivalAt: outboundLeg1Arrive,
      },
      {
        tripId: openTrip.id,
        airline: "Delta",
        flightNumber: "DL 456",
        departureAirport: "ICN",
        departureAt: outboundLeg2Depart,
        arrivalAirport: "PNH",
        arrivalAt: outboundLeg2Arrive,
      },
    ],
  });
  // createMany can't set a many-to-many relation, so this needs its own create.
  await prisma.tripFlightSegment.create({
    data: {
      tripId: openTrip.id,
      airline: "United",
      flightNumber: "UA 789",
      departureAirport: "ORD",
      departureAt: soloDepart,
      arrivalAirport: "PNH",
      arrivalAt: soloArrive,
      participants: { connect: [{ id: priya.id }, { id: john.id }] },
    },
  });

  // Fulfillment split: Priya completes everything, John nothing, Amara one of the three, so
  // all/none/partial are visible.
  const [esigReq, docReq, taskReq] = await Promise.all([
    prisma.tripRequirement.findFirst({ where: { tripId: openTrip.id, kind: "esignature" } }),
    prisma.tripRequirement.findFirst({ where: { tripId: openTrip.id, kind: "document" } }),
    prisma.tripRequirement.findFirst({ where: { tripId: openTrip.id, kind: "task" } }),
  ]);

  if (taskReq) {
    await prisma.tripRequirementStatus.create({
      data: { requirementId: taskReq.id, participantId: priya.id, completedAt: dateBetween(10, 5) },
    });
    await prisma.tripRequirementStatus.create({
      data: { requirementId: taskReq.id, participantId: amara.id, completedAt: dateBetween(2, 1) },
    });
  }

  if (docReq) {
    const passportPdf = buildFakePdf("Passport Photo Page", "Seed placeholder -- not a real passport scan.");
    await prisma.tripDocument.create({
      data: {
        tripId: openTrip.id,
        participantId: priya.id,
        requirementId: docReq.id,
        title: "Passport photo page",
        bytesRow: { create: { bytes: passportPdf } },
        fileName: "passport.pdf",
        contentType: "application/pdf",
      },
    });
    const davidPassportPdf = buildFakePdf(
      "Passport Photo Page",
      "Seed placeholder -- not a real passport scan."
    );
    await prisma.tripDocument.create({
      data: {
        tripId: openTrip.id,
        participantId: david.id,
        requirementId: docReq.id,
        title: "Passport photo page",
        bytesRow: { create: { bytes: davidPassportPdf } },
        fileName: "passport.pdf",
        contentType: "application/pdf",
      },
    });
  }

  // A real signature: the same pdfGeneration.js utility and server-computed SHA-256 hash the
  // sign route uses.
  if (esigReq && esigReq.bodyText) {
    try {
      const crypto = require("crypto");
      const { buildSignedDocumentPdf } = require("../src/utils/pdfGeneration");
      const documentText = esigReq.bodyText;
      const documentTextHash = crypto.createHash("sha256").update(documentText, "utf8").digest("hex");
      const attestedAt = dateBetween(8, 4);
      const pdfBytes = await buildSignedDocumentPdf({
        requirementLabel: esigReq.label,
        tripLabel: openTrip.name || openTrip.type || "Trip",
        participantName: `${priya.firstName} ${priya.lastName}`,
        documentText,
        signerName: `${priya.firstName} ${priya.lastName}`,
        signatureImage: null,
        attestedAt,
        documentTextHash,
        ip: "203.0.113.42",
      });
      await prisma.tripDocument.create({
        data: {
          tripId: openTrip.id,
          participantId: priya.id,
          requirementId: esigReq.id,
          title: esigReq.label,
          bytesRow: { create: { bytes: pdfBytes } },
          fileName: "signed-liability-release.pdf",
          contentType: "application/pdf",
          signerName: `${priya.firstName} ${priya.lastName}`,
          attestedAt,
          ip: "203.0.113.42",
          documentTextSnapshot: documentText,
          documentTextHash,
        },
      });
    } catch (err) {
      console.warn("  Skipping seed e-signature (non-fatal):", err.message);
    }
  }

  // A trip-wide document (participantId: null), e.g. an itinerary or packing list.
  const itineraryPdf = buildFakePdf(
    "Team Itinerary & Packing List",
    "Seed placeholder -- not a real itinerary."
  );
  await prisma.tripDocument.create({
    data: {
      tripId: openTrip.id,
      participantId: null,
      title: "Team itinerary & packing list",
      bytesRow: { create: { bytes: itineraryPdf } },
      fileName: "team-itinerary.pdf",
      contentType: "application/pdf",
    },
  });

  // Meetings: one past with its reminder stamped (reminderSentAt), one upcoming without, the
  // two states the reminder cron distinguishes. Plain day-level Date arithmetic, since
  // dateBetween works in years.
  const pastMeetingStart = new Date();
  pastMeetingStart.setDate(pastMeetingStart.getDate() - 14);
  pastMeetingStart.setHours(19, 0, 0, 0);
  const pastMeetingReminderSentAt = new Date(pastMeetingStart);
  pastMeetingReminderSentAt.setDate(pastMeetingReminderSentAt.getDate() - 1);
  await prisma.tripMeeting.create({
    data: {
      tripId: openTrip.id,
      startAt: pastMeetingStart,
      title: "Pre-Field Training",
      location: "Zoom",
      meetingLink: "https://zoom.us/j/5551234567",
      agenda: "Pre-field training -- cultural orientation and safety briefing.",
      reminderSentAt: pastMeetingReminderSentAt,
    },
  });

  const upcomingMeetingStart = new Date();
  upcomingMeetingStart.setDate(upcomingMeetingStart.getDate() + 21);
  upcomingMeetingStart.setHours(19, 0, 0, 0);
  await prisma.tripMeeting.create({
    data: {
      tripId: openTrip.id,
      startAt: upcomingMeetingStart,
      title: "Team Orientation Call",
      location: "Church fellowship hall",
      agenda: "Team orientation call -- logistics overview, Q&A, meet the rest of the team.",
    },
  });

  // A second trip with a different flavor (a domestic build trip), so flights, budget,
  // meetings, requirements and a signature show on more than one trip.
  const closedFlightDepart = new Date(closedStart);
  closedFlightDepart.setHours(7, 0, 0, 0);
  const closedFlightArrive = new Date(closedFlightDepart.getTime() + 2.5 * 60 * 60 * 1000);

  const closedTrip = await prisma.trip.create({
    data: {
      partnerId: closedPartner.id,
      name: `${closedPartner.displayName.split(" ")[0]}'s Fall Build Team`,
      status: "closed",
      type: pick(TRIP_TYPES),
      description: `The team is finalized for this trip serving with ${closedPartner.displayName}.`,
      startDate: closedStart,
      endDate: closedEnd,
      teamSizeMax: 6,
      supportRaisingGoal: 900,
      participants: {
        create: [
          {
            firstName: "Marcus",
            lastName: "Thibodeaux",
            email: "marcus.t@example.org",
            supportRaisingGoal: 900,
            shareToken: generateShareToken(),
            story: "Excited to lead this build team again this fall -- thank you for considering a gift!",
          },
          { firstName: "Sarah", lastName: "Oyelaran", email: "sarah.o@example.org" },
        ],
      },
      budgetLines: {
        create: [
          { label: "Building materials", estimatedAmount: 400 },
          { label: "Tools rental", estimatedAmount: 120 },
          { label: "Group lodging", estimatedAmount: 280 },
          { label: "Fuel / van rental", estimatedAmount: 150 },
        ],
      },
      flightSegments: {
        create: [
          {
            airline: "Southwest",
            flightNumber: "WN 2200",
            departureAirport: "DAL",
            departureAt: closedFlightDepart,
            arrivalAirport: "MCI",
            arrivalAt: closedFlightArrive,
          },
        ],
      },
      requirements: {
        create: [
          { label: "Signed Waiver", kind: "esignature", bodyText: LIABILITY_RELEASE_TEXT },
          { label: "Background check cleared", kind: "task" },
        ],
      },
    },
    include: { participants: true, requirements: true },
  });

  const marcus = closedTrip.participants.find((p) => p.firstName === "Marcus");
  const closedTaskReq = closedTrip.requirements.find((r) => r.kind === "task");
  const closedEsigReq = closedTrip.requirements.find((r) => r.kind === "esignature");

  await prisma.tripContribution.create({
    data: {
      tripId: closedTrip.id,
      participantId: marcus.id,
      donorName: "Sunday school class",
      amount: 500,
      method: "other",
      receivedDate: dateBetween(0, 0),
    },
  });

  if (closedTaskReq) {
    await prisma.tripRequirementStatus.create({
      data: { requirementId: closedTaskReq.id, participantId: marcus.id, completedAt: dateBetween(1, 0) },
    });
  }

  if (closedEsigReq && closedEsigReq.bodyText) {
    try {
      const crypto = require("crypto");
      const { buildSignedDocumentPdf } = require("../src/utils/pdfGeneration");
      const documentText = closedEsigReq.bodyText;
      const documentTextHash = crypto.createHash("sha256").update(documentText, "utf8").digest("hex");
      const attestedAt = dateBetween(1, 0);
      const pdfBytes = await buildSignedDocumentPdf({
        requirementLabel: closedEsigReq.label,
        tripLabel: closedTrip.name || closedTrip.type || "Trip",
        participantName: `${marcus.firstName} ${marcus.lastName}`,
        documentText,
        signerName: `${marcus.firstName} ${marcus.lastName}`,
        signatureImage: null,
        attestedAt,
        documentTextHash,
        ip: "203.0.113.77",
      });
      await prisma.tripDocument.create({
        data: {
          tripId: closedTrip.id,
          participantId: marcus.id,
          requirementId: closedEsigReq.id,
          title: closedEsigReq.label,
          bytesRow: { create: { bytes: pdfBytes } },
          fileName: "signed-waiver.pdf",
          contentType: "application/pdf",
          signerName: `${marcus.firstName} ${marcus.lastName}`,
          attestedAt,
          ip: "203.0.113.77",
          documentTextSnapshot: documentText,
          documentTextHash,
        },
      });
    } catch (err) {
      console.warn("  Skipping closed trip's seed e-signature (non-fatal):", err.message);
    }
  }

  const closedMeetingStart = new Date();
  closedMeetingStart.setDate(closedMeetingStart.getDate() - 7);
  closedMeetingStart.setHours(18, 30, 0, 0);
  await prisma.tripMeeting.create({
    data: {
      tripId: closedTrip.id,
      startAt: closedMeetingStart,
      title: "Final Team Meeting",
      location: "Church fellowship hall",
      agenda: "Final team meeting -- packing list review, travel logistics.",
      reminderSentAt: new Date(closedMeetingStart.getTime() - 24 * 60 * 60 * 1000),
    },
  });

  try {
    const photoPools = await buildPhotoPools();
    const photoUrl = photoPools && nextFromPool(photoPools.single_adult);
    if (photoUrl) {
      const photo = await downloadAndUploadPhoto(photoUrl);
      if (photo) {
        await prisma.tripParticipant.update({
          where: { id: marcus.id },
          data: { photoBytesRow: { create: { photo: photo.bytes } }, photoContentType: photo.contentType },
        });
      }
    }
  } catch (err) {
    console.warn("  Skipping Marcus's seed photo:", err.message);
  }

  // A trip still in "planning", not yet accepting applications.
  if (planningPartner && planningPartner.id !== openPartner.id && planningPartner.id !== closedPartner.id) {
    await prisma.trip.create({
      data: {
        partnerId: planningPartner.id,
        name: `${planningPartner.displayName.split(" ")[0]}'s Spring Team (planning)`,
        status: "planning",
        type: pick(TRIP_TYPES),
        description: `Early planning stages for a team serving with ${planningPartner.displayName} -- dates and team size still being worked out.`,
        teamSizeMin: 5,
        teamSizeMax: 8,
      },
    });
  }

  if (restrictedPartner) {
    const restrictedTrip = await prisma.trip.create({
      data: {
        partnerId: restrictedPartner.id,
        name: "Trip to a sensitive-access field",
        status: "accepting_applications",
        isPublic: false,
        applicationShareToken: generateShareToken(),
        type: pick(TRIP_TYPES),
        description: "A short-term team supporting an ongoing restricted-access ministry.",
        teamSizeMin: 3,
        teamSizeMax: 6,
        supportRaisingGoal: 1200,
        requirements: {
          create: [
            {
              label: "Signed Confidentiality Agreement",
              kind: "esignature",
              bodyText: LIABILITY_RELEASE_TEXT,
            },
          ],
        },
      },
    });
    const restrictedSet = await seedQuestionList("trip", restrictedTrip.id, SEED_RESTRICTED_TRIP_QUESTIONS);

    // Participants and applications so the masked private-link and support-raising paths of
    // this restricted-partner trip have something to click through. Approved via a real
    // application, like Amara.
    const restrictedApplication = await prisma.tripApplication.create({
      data: stripResponses({
        tripId: restrictedTrip.id,
        firstName: "Hannah",
        lastName: "Weiss",
        email: "hannah.weiss@example.org",
        phone: "555-0184",
        status: "approved",
        reviewedAt: dateBetween(1, 0),
        reviewedById: admin?.id || null,
        responses: { q1: "Yes" },
      }),
    });
    await attachSeedAnswers(restrictedTrip.id, [templateSet, restrictedSet]);
    await prisma.tripParticipant.create({
      data: {
        tripId: restrictedTrip.id,
        applicationId: restrictedApplication.id,
        firstName: restrictedApplication.firstName,
        lastName: restrictedApplication.lastName,
        email: restrictedApplication.email,
        phone: restrictedApplication.phone,
        supportRaisingGoal: restrictedTrip.supportRaisingGoal,
        shareToken: generateShareToken(),
        story: "Grateful for your support as I prepare for this trip!",
        contributions: {
          create: [
            {
              trip: { connect: { id: restrictedTrip.id } },
              donorName: "Aunt",
              amount: 100,
              method: "check",
              receivedDate: dateBetween(0, 0),
            },
          ],
        },
      },
    });
  }

  // A trip with minors: a minor's application with parent/guardian info and date of birth, and
  // the Minor Travel Release requirement (minorsOnly) signed by the parent via
  // signerRelationship. Reuses closedPartner.
  const minorsTripStart = dateBetween(-1, -2);
  const minorsTripEnd = new Date(minorsTripStart);
  minorsTripEnd.setDate(minorsTripEnd.getDate() + randInt(5, 7));
  // dateYearsAgo, not setFullYear, which would pin every minor's birthday to the day the seed
  // runs.
  const minorDob = dateYearsAgo(15, 11);

  const minorsTrip = await prisma.trip.create({
    data: {
      partnerId: closedPartner.id,
      name: `${closedPartner.displayName.split(" ")[0]}'s VBS & Family Camp Team`,
      status: "accepting_applications",
      isPublic: true,
      type: "VBS/Children's Ministry",
      description: `A family-friendly team serving alongside ${closedPartner.displayName} -- open to students and their parents.`,
      startDate: minorsTripStart,
      endDate: minorsTripEnd,
      teamSizeMin: 4,
      teamSizeMax: 10,
      supportRaisingGoal: 900,
    },
  });

  const minorApplication = await prisma.tripApplication.create({
    data: {
      tripId: minorsTrip.id,
      firstName: "Lily",
      lastName: "Thompson",
      email: "lily.thompson@example.org",
      phone: "555-0211",
      status: "approved",
      reviewedAt: dateBetween(1, 0),
      reviewedById: admin?.id || null,
      dateOfBirth: minorDob,
      addressLine1: "506 Willow Bend Drive",
      city: "Rock Island",
      stateProvinceRegion: "IL",
      postalCode: "61201",
      country: "USA",
      parentGuardianFirstName: "Karen",
      parentGuardianLastName: "Thompson",
      parentGuardianRelationship: "Mother",
      parentGuardianPhone: "555-0212",
      parentGuardianEmail: "karen.thompson@example.org",
      emergencyContactFirstName: "Karen",
      emergencyContactLastName: "Thompson",
      emergencyContactPhone: "555-0212",
      emergencyContactEmail: "karen.thompson@example.org",
    },
  });
  const lily = await prisma.tripParticipant.create({
    data: {
      tripId: minorsTrip.id,
      applicationId: minorApplication.id,
      firstName: minorApplication.firstName,
      lastName: minorApplication.lastName,
      email: minorApplication.email,
      phone: minorApplication.phone,
      dateOfBirth: minorApplication.dateOfBirth,
      addressLine1: minorApplication.addressLine1,
      city: minorApplication.city,
      stateProvinceRegion: minorApplication.stateProvinceRegion,
      postalCode: minorApplication.postalCode,
      country: minorApplication.country,
      parentGuardianFirstName: minorApplication.parentGuardianFirstName,
      parentGuardianLastName: minorApplication.parentGuardianLastName,
      parentGuardianRelationship: minorApplication.parentGuardianRelationship,
      parentGuardianPhone: minorApplication.parentGuardianPhone,
      parentGuardianEmail: minorApplication.parentGuardianEmail,
      emergencyContactFirstName: minorApplication.emergencyContactFirstName,
      emergencyContactLastName: minorApplication.emergencyContactLastName,
      emergencyContactPhone: minorApplication.emergencyContactPhone,
      emergencyContactEmail: minorApplication.emergencyContactEmail,
      supportRaisingGoal: minorsTrip.supportRaisingGoal,
      shareToken: generateShareToken(),
      story: "So excited for my first mission trip -- thank you for supporting me!",
    },
  });

  // An adult co-leader, direct-added, with a full profile.
  await prisma.tripParticipant.create({
    data: {
      tripId: minorsTrip.id,
      firstName: "Rachel",
      lastName: "Nguyen",
      email: "rachel.nguyen@example.org",
      phone: fakePhone(),
      role: "Team Lead",
      dateOfBirth: dateYearsAgo(34, 10),
      ...fakeUsAddress(),
      ...fakeEmergencyContact("Nguyen"),
      supportRaisingGoal: minorsTrip.supportRaisingGoal,
    },
  });

  // The general code-of-conduct/liability release, in addition to the minor-specific form.
  // Created by hand: this trip is made with prisma.trip.create, so it doesn't get
  // ChurchSettings.tripRequirementTemplate automatically.
  await prisma.tripRequirement.create({
    data: {
      tripId: minorsTrip.id,
      label: "Signed Liability Release and Code of Conduct",
      kind: "esignature",
      bodyText: LIABILITY_RELEASE_TEXT,
    },
  });

  // minorsOnly: inert for adult participants, as in the default template.
  const minorReleaseRequirement = await prisma.tripRequirement.create({
    data: {
      tripId: minorsTrip.id,
      label: "Minor Travel Release & Consent Form",
      kind: "esignature",
      bodyText: MINOR_RELEASE_TEXT,
      minorsOnly: true,
    },
  });

  // Signed by the parent, not the minor (signerRelationship records that), via the real
  // pdfGeneration.js mechanism.
  try {
    const crypto = require("crypto");
    const { buildSignedDocumentPdf } = require("../src/utils/pdfGeneration");
    const documentText = MINOR_RELEASE_TEXT;
    const documentTextHash = crypto.createHash("sha256").update(documentText, "utf8").digest("hex");
    const attestedAt = dateBetween(0, 0);
    const pdfBytes = await buildSignedDocumentPdf({
      requirementLabel: minorReleaseRequirement.label,
      tripLabel: minorsTrip.name,
      participantName: `${lily.firstName} ${lily.lastName}`,
      documentText,
      signerName: `${minorApplication.parentGuardianFirstName} ${minorApplication.parentGuardianLastName}`,
      signatureImage: null,
      attestedAt,
      documentTextHash,
      ip: "203.0.113.19",
    });
    await prisma.tripDocument.create({
      data: {
        tripId: minorsTrip.id,
        participantId: lily.id,
        requirementId: minorReleaseRequirement.id,
        title: minorReleaseRequirement.label,
        bytesRow: { create: { bytes: pdfBytes } },
        fileName: "minor-travel-release.pdf",
        contentType: "application/pdf",
        signerName: `${minorApplication.parentGuardianFirstName} ${minorApplication.parentGuardianLastName}`,
        signerRelationship: "parent/guardian",
        attestedAt,
        ip: "203.0.113.19",
        documentTextSnapshot: documentText,
        documentTextHash,
      },
    });
  } catch (err) {
    console.warn("  Skipping minor-release seed e-signature (non-fatal):", err.message);
  }

  // A second minors trip, already completed, to show the flow after the fact. Reuses
  // openPartner.
  const pastMinorsTripStart = dateBetween(2, 1);
  const pastMinorsTripEnd = new Date(pastMinorsTripStart);
  pastMinorsTripEnd.setDate(pastMinorsTripEnd.getDate() + randInt(6, 9));
  // Same dateYearsAgo reasoning as minorDob above.
  const pastMinorDob = dateYearsAgo(16, 11);

  const pastMinorsTrip = await prisma.trip.create({
    data: {
      partnerId: openPartner.id,
      name: `${openPartner.displayName.split(" ")[0]}'s Youth Mission Week (completed)`,
      status: "completed",
      type: "VBS/Children's Ministry",
      description: `A completed family-friendly team that served alongside ${openPartner.displayName}.`,
      startDate: pastMinorsTripStart,
      endDate: pastMinorsTripEnd,
      teamSizeMin: 4,
      teamSizeMax: 8,
      supportRaisingGoal: 850,
    },
  });

  const pastMinorApplication = await prisma.tripApplication.create({
    data: {
      tripId: pastMinorsTrip.id,
      firstName: "Noah",
      lastName: "Castellano",
      email: "noah.castellano@example.org",
      phone: "555-0233",
      status: "approved",
      reviewedAt: dateBetween(3, 2),
      reviewedById: admin?.id || null,
      dateOfBirth: pastMinorDob,
      parentGuardianFirstName: "Diane",
      parentGuardianLastName: "Castellano",
      parentGuardianRelationship: "Mother",
      parentGuardianPhone: "555-0234",
      parentGuardianEmail: "diane.castellano@example.org",
      emergencyContactFirstName: "Diane",
      emergencyContactLastName: "Castellano",
      emergencyContactPhone: "555-0234",
      emergencyContactEmail: "diane.castellano@example.org",
      addressLine1: "212 Hawthorn Lane",
      city: "Moline",
      stateProvinceRegion: "IL",
      postalCode: "61265",
      country: "USA",
    },
  });
  const noah = await prisma.tripParticipant.create({
    data: {
      tripId: pastMinorsTrip.id,
      applicationId: pastMinorApplication.id,
      firstName: pastMinorApplication.firstName,
      lastName: pastMinorApplication.lastName,
      email: pastMinorApplication.email,
      phone: pastMinorApplication.phone,
      dateOfBirth: pastMinorApplication.dateOfBirth,
      parentGuardianFirstName: pastMinorApplication.parentGuardianFirstName,
      parentGuardianLastName: pastMinorApplication.parentGuardianLastName,
      parentGuardianRelationship: pastMinorApplication.parentGuardianRelationship,
      parentGuardianPhone: pastMinorApplication.parentGuardianPhone,
      parentGuardianEmail: pastMinorApplication.parentGuardianEmail,
      emergencyContactFirstName: pastMinorApplication.emergencyContactFirstName,
      emergencyContactLastName: pastMinorApplication.emergencyContactLastName,
      emergencyContactPhone: pastMinorApplication.emergencyContactPhone,
      emergencyContactEmail: pastMinorApplication.emergencyContactEmail,
      addressLine1: pastMinorApplication.addressLine1,
      city: pastMinorApplication.city,
      stateProvinceRegion: pastMinorApplication.stateProvinceRegion,
      postalCode: pastMinorApplication.postalCode,
      country: pastMinorApplication.country,
    },
  });

  // Same general release as the other minors trip.
  await prisma.tripRequirement.create({
    data: {
      tripId: pastMinorsTrip.id,
      label: "Signed Liability Release and Code of Conduct",
      kind: "esignature",
      bodyText: LIABILITY_RELEASE_TEXT,
    },
  });

  const pastMinorReleaseRequirement = await prisma.tripRequirement.create({
    data: {
      tripId: pastMinorsTrip.id,
      label: "Minor Travel Release & Consent Form",
      kind: "esignature",
      bodyText: MINOR_RELEASE_TEXT,
      minorsOnly: true,
    },
  });

  try {
    const crypto = require("crypto");
    const { buildSignedDocumentPdf } = require("../src/utils/pdfGeneration");
    const documentText = MINOR_RELEASE_TEXT;
    const documentTextHash = crypto.createHash("sha256").update(documentText, "utf8").digest("hex");
    const attestedAt = dateBetween(3, 2);
    const pdfBytes = await buildSignedDocumentPdf({
      requirementLabel: pastMinorReleaseRequirement.label,
      tripLabel: pastMinorsTrip.name,
      participantName: `${noah.firstName} ${noah.lastName}`,
      documentText,
      signerName: `${pastMinorApplication.parentGuardianFirstName} ${pastMinorApplication.parentGuardianLastName}`,
      signatureImage: null,
      attestedAt,
      documentTextHash,
      ip: "203.0.113.55",
    });
    await prisma.tripDocument.create({
      data: {
        tripId: pastMinorsTrip.id,
        participantId: noah.id,
        requirementId: pastMinorReleaseRequirement.id,
        title: pastMinorReleaseRequirement.label,
        bytesRow: { create: { bytes: pdfBytes } },
        fileName: "minor-travel-release.pdf",
        contentType: "application/pdf",
        signerName: `${pastMinorApplication.parentGuardianFirstName} ${pastMinorApplication.parentGuardianLastName}`,
        signerRelationship: "parent/guardian",
        attestedAt,
        ip: "203.0.113.55",
        documentTextSnapshot: documentText,
        documentTextHash,
      },
    });
  } catch (err) {
    console.warn("  Skipping completed minors trip's seed e-signature (non-fatal):", err.message);
  }

  // Starter content for tripApplicationTemplate (the universal layer every trip asks) and
  // tripQuestionLibrary (a picker-only set, never live on a form by itself).
  // The 5 integration-backed toggles below are forced on only when a real key exists:
  // reset-demo-data.js upserts those credential fields before this seed runs, so they are read
  // back here, and a toggle with no key behind it does nothing or errors.
  const integrationSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      groupmeAccessToken: true,
      postmarkServerToken: true,
      emailFromAddress: true,
      inboundEmailWebhookUsername: true,
      inboundEmailWebhookPassword: true,
      anthropicApiKey: true,
      joshuaProjectApiKey: true,
    },
  });

  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: {
      // Every optional feature on, demo only: utils/features.js defaults several to off,
      // which would hide most of the nav from a first-time visitor. Keys are copied from
      // that registry; add new features here too (seed.js does not import FEATURE_KEYS on
      // purpose). groupme/outboundEmail/inboundEmail/aiExtraction/joshuaProject are on
      // only when a real key is configured, as in reset-demo-data.js.
      enabledFeatures: {
        publicDirectory: true,
        publicMap: true,
        partnerFiles: true,
        prayerRequests: true,
        oneTimeNeeds: true,
        monthlySupport: true,
        trips: true,
        careTeam: true,
        contactLog: true,
        // Key-date reminders on so the bell shows them; their email is blocked on any
        // demo by the scheduler (utils/demoMode.js).
        keyDates: true,
        // Support preferences, with an example menu and recorded choices
        // (seedSupportPreferencesDemo).
        supportPreferences: true,
        // Partner surveys, with one open survey and some answers (seedSurveysDemo). The links
        // can be emailed by hand on a demo like anywhere else (only scheduled emails are skipped there).
        surveys: true,
        // The audit log is on for a demo, with example entries (seedAuditLogDemo).
        auditTrail: true,
        // Off on a demo: it would email the fake seeded accounts. See utils/demoMode.js
        // (the reset script applies the same list).
        ...demoDisabledFeatureFlags(),
        publicTripDiscovery: true,
        booklet: true,
        reports: true,
        outboundEmail: Boolean(
          integrationSettings?.postmarkServerToken && integrationSettings?.emailFromAddress
        ),
        inboundEmail: Boolean(
          integrationSettings?.postmarkServerToken &&
          integrationSettings?.inboundEmailWebhookUsername &&
          integrationSettings?.inboundEmailWebhookPassword
        ),
        groupme: Boolean(integrationSettings?.groupmeAccessToken),
        whatsapp: true,
        publicPrayerDigest: true,
        aiExtraction: Boolean(integrationSettings?.anthropicApiKey),
        joshuaProject: Boolean(integrationSettings?.joshuaProjectApiKey),
      },
      // On for the demo (the schema default is off) so private application links and
      // participant support-raising pages appear.
      allowPrivateApplicationLinks: true,
      allowPublicSupportRaisingLinks: true,
      // On for the demo so the Financial section shows.
      enableTripBudgeting: true,
      // On for the demo: the UI gates donorEmail/donorPhone on this setting.
      collectDonorContactInfo: true,
      // Church-wide (Trip.onlineGivingUrl); without these the public "Donate" button never
      // renders.
      onlineGivingUrl: "https://give.example.org/missions",
      onlineGivingInstructions:
        'Choose "Missions Trips" as the fund, and include the team member\'s name in the memo/notes field so their support is credited correctly.',
    },
  });
}

// Phone and a short profile for the demo logins, so care team lists and the trip Team page show them.
// Fictional 555-01xx numbers.
const DEMO_USER_DETAILS = {
  "Pat Reynolds": { phone: "555-0101", profile: "Missions pastor. Easiest to reach by text, weekdays." },
  "Casey Nguyen": { phone: "555-0102", profile: "Handles partner newsletters. Email is best." },
  "Jordan Lee": { phone: "555-0103", profile: "Retired nurse; visits partners when they are in town." },
  "Dana Whitfield": { phone: "555-0104", profile: "Prays for our Asia partners. Free after 6pm." },
  "Chris Alvarez": { phone: "555-0105", profile: "Leads our summer trips. Best reached by phone." },
  "Sam Okafor": { phone: "555-0106", profile: null },
};
const userDetails = (firstName, lastName) => DEMO_USER_DETAILS[`${firstName} ${lastName}`] || {};

// The populate-the-list accounts get a password nobody knows: a random one, hashed and never printed
// or stored anywhere else. The old shared fixed password was in the repo, so anyone could have
// signed in to a seeded copy that was left running. (The two published demo logins use
// demoGuestPassword() instead, by design.) To sign in as one of these, reset its password in Manage Users.
async function unusablePasswordHash(bcrypt) {
  return bcrypt.hash(require("crypto").randomBytes(32).toString("hex"), 12);
}

async function seedAdditionalUsers() {
  console.log(`Seeding ${ADDITIONAL_USERS.length} additional admin users...`);
  const bcrypt = require("bcryptjs");
  const passwordHash = await unusablePasswordHash(bcrypt);
  for (const u of ADDITIONAL_USERS) {
    const email = `${slugify(`${u.firstName} ${u.lastName}`)}@example.org`;
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        firstName: u.firstName,
        lastName: u.lastName,
        ...userDetails(u.firstName, u.lastName),
        passwordHash,
        role: u.role,
        active: u.active,
        mfaSetupRequired: u.mfaSetupRequired,
        cadence: u.cadence,
        lastLoginAt: u.active ? dateBetween(0, 0) : null,
      },
    });
  }
}

// A curated handful of DispatchRecord rows covering the states Pending Dispatches should show: a
// sendable prayer request, an answered one, a restricted partner's request left unreviewed
// ("awaiting review"), an undecided need, a decided one and a newsletter. Uses the real notify*
// functions (dispatchRecording.js) so rows match real payloads. Nothing is sent: they only
// enqueue (isUrgent is never set), and the demo reset leaves ChurchSettings' schedule fields
// unset (reset-demo-data.js).
async function seedNotificationQueue() {
  console.log("Seeding a sample pending-dispatches queue...");
  const {
    notifyPrayerRequestCreated,
    notifyPrayerRequestAnswered,
    notifySupportNeedCreated,
    notifySupportNeedDecided,
    notifyNewsletterCreated,
  } = require("../src/utils/dispatchRecording");
  const partnerSelect = { id: true, displayName: true, isRestricted: true };

  const ongoingPrayers = await prisma.prayerRequest.findMany({
    where: { status: "ongoing", partner: { isRestricted: false } },
    take: 3,
    include: { partner: { select: partnerSelect } },
  });
  for (const pr of ongoingPrayers) await notifyPrayerRequestCreated(pr);

  const answeredPrayer = await prisma.prayerRequest.findFirst({
    where: { status: "answered", partner: { isRestricted: false } },
    include: { partner: { select: partnerSelect } },
  });
  if (answeredPrayer) await notifyPrayerRequestAnswered(answeredPrayer);

  const restrictedPrayer = await prisma.prayerRequest.findFirst({
    where: { partner: { isRestricted: true } },
    include: { partner: { select: partnerSelect } },
  });
  if (restrictedPrayer) await notifyPrayerRequestCreated(restrictedPrayer);

  const undecidedNeed = await prisma.supportNeed.findFirst({
    where: { approvedAmount: null, partner: { isRestricted: false } },
    include: { partner: { select: partnerSelect } },
  });
  if (undecidedNeed) await notifySupportNeedCreated(undecidedNeed);

  const decidedNeed = await prisma.supportNeed.findFirst({
    where: { approvedAmount: { not: null }, partner: { isRestricted: false } },
    include: { partner: { select: partnerSelect } },
  });
  if (decidedNeed) {
    await notifySupportNeedCreated(decidedNeed);
    await notifySupportNeedDecided(decidedNeed);
  }

  const newsletter = await prisma.partnerFile.findFirst({
    where: { kind: "newsletter", partner: { isRestricted: false } },
    include: { partner: { select: partnerSelect } },
  });
  if (newsletter) await notifyNewsletterCreated(newsletter);
}

// Care teams and guest accounts. Demo extras only: the route-test database assumes
// nothing but its own fixtures touched User/DispatchRecord.
//
// Two demo logins are published (demo/README.md): a care team member and a trip leader. They are
// the exception to "MFA is required for a guest": a shared, published account can't enrol an
// authenticator without locking out other visitors, so they are created with mfaSetupRequired
// off. Everything else is a populate-the-list account with an unknown random password.
// Defined once in src/utils/demoLogins.js, which the demo banner also reads.
const {
  demoCareMemberEmail,
  demoTripLeaderEmail,
  demoGuestPassword,
  demoEmailDomain,
} = require("../src/utils/demoLogins");
const DAY_MS = 24 * 60 * 60 * 1000;

async function seedCareTeamsDemo() {
  console.log("Seeding care teams and guest accounts...");
  const bcrypt = require("bcryptjs");
  const {
    notifyPrayerRequestCreated,
    notifyPrayerRequestAnswered,
    notifySupportNeedCreated,
  } = require("../src/utils/dispatchRecording");
  const publishedHash = await bcrypt.hash(demoGuestPassword(), 12);
  const fakeHash = await unusablePasswordHash(bcrypt);

  const makeGuest = (email, firstName, lastName, { published, lapsed }) =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        firstName,
        lastName,
        ...userDetails(firstName, lastName),
        passwordHash: published ? publishedHash : fakeHash,
        role: "guest",
        authProvider: "local",
        active: true,
        mfaSetupRequired: !published,
        lastLoginAt: lapsed ? null : dateBetween(0, 0),
      },
    });
  const careMember = await makeGuest(demoCareMemberEmail(), "Dana", "Whitfield", { published: true });
  const tripLeader = await makeGuest(demoTripLeaderEmail(), "Chris", "Alvarez", { published: true });
  const lapsedGuest = await makeGuest(`sam.okafor@${demoEmailDomain()}`, "Sam", "Okafor", { lapsed: true });

  // The editor and viewer seedAdditionalUsers already made: a full role can be
  // on a team too (the marker and view, never extra reach).
  const editor = await prisma.user.findFirst({ where: { firstName: "Pat", lastName: "Reynolds" } });
  const viewer = await prisma.user.findFirst({ where: { firstName: "Casey", lastName: "Nguyen" } });

  // Variety for the coverage report: covered, members-but-no-lead, no team.
  const partners = await prisma.partner.findMany({
    where: { archived: false, isRestricted: false },
    orderBy: { displayName: "asc" },
    take: 10,
    select: { id: true, displayName: true },
  });
  const team = async (partner, lead, members) => {
    if (!partner) return;
    const seats = [
      ...(lead ? [{ user: lead, isLead: true }] : []),
      ...members.map((user) => ({ user, isLead: false })),
    ];
    for (const { user, isLead } of seats.filter((x) => x.user)) {
      await prisma.careTeamMember.upsert({
        where: { partnerId_userId: { partnerId: partner.id, userId: user.id } },
        update: { isLead },
        create: { partnerId: partner.id, userId: user.id, isLead },
      });
    }
  };
  await team(partners[0], careMember, [viewer]);
  await team(partners[1], editor, [careMember]);
  await team(partners[2], careMember, []);
  await team(partners[3], null, [editor]); // members, no lead
  await team(partners[4], editor, [viewer]);
  await team(partners[5], null, [careMember]); // members, no lead
  // partners[6..9] are left with no care team, so the coverage report has gaps.

  // Trip leader: one granted trip. Expiry is derived from the trip's end date
  // + 30 days, so give them a trip that hasn't ended. The lapsed guest gets a
  // trip with an explicit past override, so the "Inactive accounts" filter has
  // a real example whatever the demo's dates are.
  const upcomingTrip = await prisma.trip.findFirst({
    where: { endDate: { gte: new Date() }, status: { not: "completed" } },
    orderBy: { startDate: "asc" },
  });
  const pastTrip = await prisma.trip.findFirst({
    where: { status: "completed" },
    orderBy: { endDate: "desc" },
  });
  if (upcomingTrip) {
    await prisma.tripAccess.upsert({
      where: { userId_tripId: { userId: tripLeader.id, tripId: upcomingTrip.id } },
      update: {},
      create: { userId: tripLeader.id, tripId: upcomingTrip.id },
    });
  }
  const lapsedTrip = pastTrip || upcomingTrip;
  if (lapsedTrip) {
    await prisma.tripAccess.upsert({
      where: { userId_tripId: { userId: lapsedGuest.id, tripId: lapsedTrip.id } },
      update: {},
      create: { userId: lapsedGuest.id, tripId: lapsedTrip.id, expiresAt: new Date(Date.now() - 5 * DAY_MS) },
    });
  }

  // A few things the care team member "entered", each with its dispatch held
  // for staff review -- so Pending Dispatches shows the approval flow. Goes
  // through the real notify* functions with requireReview, like the routes do,
  // so a seeded row is exactly what a real entry produces.
  const target = partners[0];
  if (target) {
    const include = {
      partner: { select: { id: true, displayName: true, isRestricted: true } },
      sourceFile: { select: { id: true } },
    };
    const today = new Date();
    const fresh = async (model, where) => !(await prisma[model].findFirst({ where }));
    const prayerText =
      "Their daughter starts at a new school next week and is nervous about the move. Please pray for a good first week.";
    if (await fresh("prayerRequest", { partnerId: target.id, requestText: prayerText })) {
      const created = await prisma.prayerRequest.create({
        data: {
          partnerId: target.id,
          category: "situational",
          requestText: prayerText,
          dateReceived: today,
          notes: "Heard on our Sunday call.",
        },
        include,
      });
      await notifyPrayerRequestCreated(created, null, { requireReview: true });
    }
    const answeredText = "Pray for the visa renewal to come through before the end of the month.";
    if (await fresh("prayerRequest", { partnerId: target.id, requestText: answeredText })) {
      const answered = await prisma.prayerRequest.create({
        data: {
          partnerId: target.id,
          category: "situational",
          requestText: answeredText,
          dateReceived: new Date(Date.now() - 20 * DAY_MS),
          status: "answered",
          dateAnswered: today,
          answeredNote: "The renewal was approved this week.",
        },
        include,
      });
      await notifyPrayerRequestAnswered(answered, { requireReview: true });
    }
    const needText = "Replace the laptop that was stolen on the field before the new term starts.";
    if (await fresh("supportNeed", { partnerId: target.id, description: needText })) {
      const need = await prisma.supportNeed.create({
        data: {
          partnerId: target.id,
          description: needText,
          requestedAmount: 850,
          requestDate: today,
          notes: "They asked whether the committee could help; no deadline beyond the term start.",
        },
        include,
      });
      await notifySupportNeedCreated(need, null, { requireReview: true });
    }
  }
}

// Contact log demo: a believable history for the contact card, the log, "My partners" and
// the "Partners to reach out to" alert. Runs after seedCareTeamsDemo, which creates the seats it
// reads. Demo extras only.
async function seedContactLogDemo() {
  console.log("Seeding the contact log...");
  const daysAgo = (n) => new Date(Date.now() - n * DAY_MS);
  const careMember = await prisma.user.findUnique({ where: { email: demoCareMemberEmail() } });
  const editor = await prisma.user.findFirst({ where: { firstName: "Pat", lastName: "Reynolds" } });
  const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });

  const seats = await prisma.careTeamMember.findMany({
    include: { partner: { select: { id: true, displayName: true } } },
    orderBy: [{ partner: { displayName: "asc" } }, { createdAt: "asc" }],
  });
  const byPartner = new Map();
  for (const seat of seats) {
    const list = byPartner.get(seat.partnerId) || [];
    list.push(seat);
    byPartner.set(seat.partnerId, list);
  }
  const teamPartners = [...byPartner.keys()];

  const log = (partnerId, userId, daysBack, over) =>
    prisma.contactLog.create({
      data: {
        partnerId,
        contactType: "call",
        direction: "outbound",
        topics: [],
        contactedById: userId,
        createdById: userId,
        contactDate: daysAgo(daysBack),
        ...over,
      },
    });

  // Spread across the care-team partners so each state appears: recently in
  // touch, long quiet with a follow-up that has come due, and never contacted.
  const plans = [
    // [ index into teamPartners, entries as [daysBack, extra] ]
    [
      0,
      [
        [
          4,
          {
            contactType: "video",
            direction: "inbound",
            topics: ["checkin"],
            notes: "Caught up on the move; all settled in.",
          },
        ],
        [31, { contactType: "text", topics: ["encouragement"] }],
      ],
    ],
    [
      1,
      [
        [
          124,
          {
            contactType: "call",
            topics: ["prayer"],
            notes: "Asked us to pray about the school year.",
            followUpDays: -20,
          },
        ],
      ],
    ],
    [
      2,
      [
        [
          12,
          { contactType: "card", topics: ["encouragement"], notes: "Sent a birthday card to the family." },
        ],
        [58, { contactType: "email", direction: "inbound", topics: ["update"] }],
      ],
    ],
    // teamPartners[3] is left with no contact at all (never contacted).
    [
      4,
      [[75, { contactType: "visit", topics: ["furlough"], notes: "Had them over for lunch on furlough." }]],
    ],
    [5, [[8, { contactType: "prayed", topics: ["prayer"], notes: "Prayed for them in our small group." }]]],
  ];
  for (const [idx, entries] of plans) {
    const seatList = byPartner.get(teamPartners[idx]);
    if (!seatList) continue;
    const who = seatList.find((x) => x.isLead) || seatList[0];
    for (const [daysBack, { followUpDays, ...extra }] of entries) {
      await log(who.partnerId, who.userId, daysBack, {
        ...extra,
        ...(followUpDays !== undefined ? { followUpDate: daysAgo(-followUpDays) } : {}),
      });
    }
  }

  // The published care member has a couple of their own entries, so the
  // demo opens with history under their name.
  const mine = seats.find((x) => x.userId === careMember?.id);
  if (mine) {
    await log(mine.partnerId, careMember.id, 2, {
      contactType: "text",
      direction: "inbound",
      topics: ["prayer"],
      notes: "They texted a prayer request.",
    });
  }
  // Staff-logged entries on a couple of partners nobody is assigned to.
  const others = await prisma.partner.findMany({
    where: { archived: false, isRestricted: false, id: { notIn: teamPartners } },
    orderBy: { displayName: "asc" },
    take: 3,
    select: { id: true },
  });
  for (const [i, partner] of others.entries()) {
    await log(partner.id, (i % 2 ? admin : editor)?.id || null, 10 + i * 40, { topics: ["checkin"] });
  }

  // A primary contact on the first adult of a handful of missionary families.
  const families = await prisma.partner.findMany({
    where: { kind: "missionary", archived: false, adults: { some: {} } },
    orderBy: { displayName: "asc" },
    take: 8,
    select: { id: true, adults: { orderBy: { createdAt: "asc" }, take: 2, select: { id: true } } },
  });
  for (const f of families) {
    // the second adult when there is one, so it isn't always the first
    const adult = f.adults[f.adults.length - 1];
    await prisma.adult.updateMany({ where: { partnerId: f.id }, data: { isPrimaryContact: false } });
    await prisma.adult.update({ where: { id: adult.id }, data: { isPrimaryContact: true } });
  }

  // One partner who is not safe to contact, so the card's "special
  // communication instructions" and the booklet's withholding are visible.
  const sensitive = await prisma.partner.findFirst({
    where: { kind: "missionary", archived: false, isRestricted: false, contactLevel: "normal" },
    orderBy: { displayName: "desc" },
    select: { id: true },
  });
  if (sensitive) {
    await prisma.partner.update({
      where: { id: sensitive.id },
      data: {
        contactLevel: "no_direct",
        contactInstructions:
          "Please don't call or text them. Go through their sending organization, who relay messages.",
        contactViaName: "Mission office",
        contactViaRole: "Sending organization",
        contactViaPhone: "(555) 010-0199",
        contactViaEmail: "office@sending-org.example.org",
      },
    });
  }
  // And one that is reachable, with guidelines: email only, and some words to avoid.
  const careful = await prisma.partner.findFirst({
    where: { kind: "missionary", archived: false, isRestricted: false, contactLevel: "normal" },
    orderBy: { displayName: "asc" },
    select: { id: true },
  });
  if (careful) {
    // Their family prefers email too, so the card and the guidelines agree.
    await prisma.adult.updateMany({ where: { partnerId: careful.id }, data: { contactMethod: "email" } });
    await prisma.partner.update({
      where: { id: careful.id },
      data: {
        contactLevel: "caution",
        contactChannels: ["email"],
        contactInstructions:
          'Email only, never text or call. Please don\'t use the words "church planting" or "mission" in the subject line.',
      },
    });
  }
}

// Key-date reminders demo: birthdays inside the 7-day window so the bell has something on
// reset day, and a default lead for a partner with no care team. Relative to now (a fixed date
// would go stale). Runs after the care teams and contact log. Demo extras only.
async function seedKeyDatesDemo() {
  console.log("Seeding key-date reminders...");
  const inDays = (n, yearsAgo) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear() - yearsAgo, d.getUTCMonth(), d.getUTCDate() + n));
  };
  const careMember = await prisma.user.findUnique({ where: { email: demoCareMemberEmail() } });
  const editor = await prisma.user.findFirst({ where: { firstName: "Pat", lastName: "Reynolds" } });

  // A birthday in 3 days on a partner the published care member looks after.
  const seat = careMember
    ? await prisma.careTeamMember.findFirst({
        where: { userId: careMember.id },
        orderBy: { createdAt: "asc" },
      })
    : null;
  if (seat) {
    const adult = await prisma.adult.findFirst({
      where: { partnerId: seat.partnerId },
      orderBy: { createdAt: "asc" },
    });
    if (adult) await prisma.adult.update({ where: { id: adult.id }, data: { birthday: inDays(3, 41) } });
  }

  // A team-less partner with a birthday in 5 days: it goes to the default lead.
  const teamed = await prisma.careTeamMember.findMany({ select: { partnerId: true } });
  const teamless = await prisma.partner.findFirst({
    where: {
      kind: "missionary",
      archived: false,
      isRestricted: false,
      id: { notIn: teamed.map((t) => t.partnerId) },
      adults: { some: {} },
    },
    orderBy: { displayName: "asc" },
    select: { id: true, adults: { take: 1, orderBy: { createdAt: "asc" }, select: { id: true } } },
  });
  if (teamless) {
    await prisma.adult.update({ where: { id: teamless.adults[0].id }, data: { birthday: inDays(5, 36) } });
  }

  // The missions team looks after the partners with no care team of their own.
  if (editor) {
    await prisma.user.update({ where: { id: editor.id }, data: { onMissionsTeam: true } });
  }
}

// "Last edited by" for the demo: the seed has no signed-in editor, so the Partners/Trips
// "Last updated" column would be blank. Stamp most partners, trips, prayer requests and needs
// with a demo staff member and a date spread over ten weeks, leaving about one in seven blank as
// on a real install. The care team member edits some requests and needs, since care team members
// can. Deterministic by creation order.
async function seedLastEditedDemo() {
  console.log("Stamping last-edited-by on the demo records...");
  const staff = await prisma.user.findMany({
    where: { active: true, role: { in: ["admin", "editor"] } },
    orderBy: { createdAt: "asc" },
  });
  if (!staff.length) return;
  const careMember = await prisma.user.findUnique({ where: { email: demoCareMemberEmail() } });
  const nameOf = (u) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
  const stampFor = (i, editors) => {
    if (i % 7 === 6) return null; // never edited by a signed-in person
    const u = editors[i % editors.length];
    const d = new Date();
    d.setDate(d.getDate() - ((i * 5) % 70) - (i % 3));
    d.setHours(8 + ((i * 3) % 10), (i * 11) % 60, 0, 0);
    return { lastEditedById: u.id, lastEditedByName: nameOf(u), lastEditedAt: d };
  };
  // Give each trip an "Added" date: some weeks before it starts, never in the future,
  // in start-date order so the result is stable.
  const trips = await prisma.trip.findMany({
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, startDate: true },
  });
  for (const [i, trip] of trips.entries()) {
    const start = (trip.startDate ?? new Date()).getTime();
    const added = new Date(Math.min(start - (45 + ((i * 11) % 75)) * 86400000, Date.now() - 86400000));
    added.setHours(9 + (i % 8), (i * 17) % 60, 0, 0);
    await prisma.trip.update({ where: { id: trip.id }, data: { createdAt: added } });
  }
  const orderFor = () => [{ createdAt: "asc" }, { id: "asc" }];
  let stamped = 0;
  for (const [model, editors] of [
    ["partner", staff],
    ["trip", staff],
    ["prayerRequest", careMember ? [...staff, careMember] : staff],
    ["supportNeed", careMember ? [...staff, careMember] : staff],
  ]) {
    const rows = await prisma[model].findMany({ orderBy: orderFor(), select: { id: true } });
    for (const [i, row] of rows.entries()) {
      const data = stampFor(i, editors);
      if (!data) continue;
      await prisma[model].update({ where: { id: row.id }, data });
      stamped += 1;
    }
  }
  console.log(`  stamped ${stamped} records`);
}

// Support preferences demo: the example menu and a handful of partners' choices.
// Deterministic; about a third of partners with a care team have nothing recorded, so that
// report has rows too. Demo extras only; runs after the care teams.
async function seedSupportPreferencesDemo() {
  console.log("Seeding support preferences...");
  await importPackFile("support-menu-example");
  const options = await prisma.supportOption.findMany({
    where: { active: true },
    orderBy: [{ group: "asc" }, { sortOrder: "asc" }],
  });
  if (!options.length) return;
  const editor = await prisma.user.findFirst({
    where: { active: true, role: { in: ["admin", "editor"] } },
    orderBy: { createdAt: "asc" },
  });
  const stamp = editor
    ? {
        lastEditedById: editor.id,
        lastEditedByName: [editor.firstName, editor.lastName].filter(Boolean).join(" ") || editor.email,
      }
    : {};

  const partners = await prisma.partner.findMany({
    where: { archived: false, careTeam: { some: {} } },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  let recorded = 0;
  for (const [i, partner] of partners.entries()) {
    if (i % 3 === 2) continue; // nothing recorded yet
    const rows = [];
    for (const [j, option] of options.entries()) {
      const pick = (i * 7 + j * 3) % 5; // spreads which options each partner chose
      if (option.kind === "offer") {
        if (pick < 2) {
          rows.push({
            optionId: option.id,
            selected: true,
            ...(pick === 0 && j % 4 === 0 ? { note: "Mentioned this on our last call." } : {}),
          });
        }
      } else if (option.kind === "single" && option.choices.length) {
        rows.push({
          optionId: option.id,
          selected: true,
          choice: option.choices[(i + j) % option.choices.length],
        });
      } else if (option.kind === "multiple" && option.choices.length) {
        rows.push({
          optionId: option.id,
          selected: true,
          choices: option.choices.slice(0, 1 + ((i + j) % 2)),
        });
      } else if (option.kind === "text" && i % 2 === 0) {
        rows.push({
          optionId: option.id,
          selected: true,
          text: "Prayer needs can be shared with the care team, but nothing public.",
        });
      }
    }
    if (!rows.length) continue;
    await prisma.partnerSupportPreference.createMany({
      data: rows.map((r) => ({
        partnerId: partner.id,
        ...r,
        ...stamp,
        ...(editor ? { lastEditedAt: new Date(Date.now() - ((i % 40) + 1) * 86400000) } : {}),
      })),
      skipDuplicates: true,
    });
    recorded += 1;
  }
  console.log(`  recorded support preferences for ${recorded} partners`);
}

// Partner surveys demo: one open check-in with four questions, a link sent to some partners,
// and answers from about half of them (some entered by staff). Deterministic; demo extras only;
// runs after the care teams.
async function seedSurveysDemo() {
  console.log("Seeding surveys...");
  if ((await prisma.survey.count()) > 0) return;
  const { newInviteToken } = require("../src/utils/surveys");
  const editor = await prisma.user.findFirst({
    where: { active: true, role: { in: ["admin", "editor"] } },
    orderBy: { createdAt: "asc" },
  });
  const editorName = editor
    ? [editor.firstName, editor.lastName].filter(Boolean).join(" ") || editor.email
    : null;
  const survey = await prisma.survey.create({
    data: {
      title: "Autumn check-in",
      intro: "We would love to hear how you are doing and how we can support you this season.",
      status: "open",
      questions: {
        create: [
          { position: 0, kind: "text", label: "How are you and your family doing?", required: true },
          { position: 1, kind: "yesno", label: "Are you planning to be home in the next year?" },
          {
            position: 2,
            kind: "single",
            label: "What is the best way for us to stay in touch?",
            choices: ["Email", "WhatsApp", "Video call"],
            allowOther: true,
          },
          {
            position: 3,
            kind: "multiple",
            label: "How can we help right now?",
            choices: ["Prayer", "A visit from a team", "Care package", "Help with a project"],
          },
        ],
      },
    },
    include: { questions: { orderBy: { position: "asc" } } },
  });
  const [qHow, qHome, qTouch, qHelp] = survey.questions;
  const partners = await prisma.partner.findMany({
    where: { archived: false, careTeam: { some: {} } },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: { id: true },
    take: 14,
  });
  const hows = [
    "Doing well, the school term has started and the kids are settling in.",
    "A busy season, but we are encouraged by the new believers meeting each week.",
    "Tired after a long trip, but grateful.",
  ];
  for (const [i, partner] of partners.entries()) {
    const sentAt = new Date(Date.now() - (3 + (i % 9)) * 86400000);
    const { tokenHash, expiresAt } = newInviteToken(sentAt);
    const byStaff = i % 4 === 1;
    if (!byStaff) {
      await prisma.surveyInvite.create({
        data: {
          surveyId: survey.id,
          partnerId: partner.id,
          tokenHash,
          expiresAt,
          sentAt,
          sentByName: editorName,
        },
      });
    }
    if (i % 2 === 1) continue; // still waiting
    await prisma.surveyResponse.create({
      data: {
        surveyId: survey.id,
        partnerId: partner.id,
        submittedAt: new Date(sentAt.getTime() + 86400000),
        enteredById: byStaff ? editor?.id || null : null,
        enteredByName: byStaff ? editorName : null,
        answers: {
          create: [
            {
              questionId: qHow.id,
              position: 0,
              label: qHow.label,
              kind: "text",
              value: hows[i % hows.length],
            },
            {
              questionId: qHome.id,
              position: 1,
              label: qHome.label,
              kind: "yesno",
              value: i % 3 === 0 ? "yes" : "no",
            },
            {
              questionId: qTouch.id,
              position: 2,
              label: qTouch.label,
              kind: "single",
              value: qTouch.choices[i % 3],
            },
            {
              questionId: qHelp.id,
              position: 3,
              label: qHelp.label,
              kind: "multiple",
              values: qHelp.choices.slice(0, 1 + (i % 3)),
            },
          ],
        },
      },
    });
  }
  console.log(`  seeded a survey for ${partners.length} partners`);

  // An annual update (built from the template) with answers that differ from the record, so the
  // Survey updates page has changes waiting, one of them a photo.
  const imported = await importPackFile("survey-annual-update");
  const annual = await prisma.survey.update({
    where: { id: imported.surveyId },
    data: { status: "open" },
    include: { questions: { orderBy: { position: "asc" } } },
  });
  const qBy = (label) => annual.questions.find((q) => q.label === label);
  const { proposeFromResponse } = require("../src/utils/surveyProposals");
  const withAdults = await prisma.partner.findMany({
    where: { archived: false, kind: "missionary", adults: { some: {} } },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: { id: true },
    take: 4,
  });
  const phones = ["(337) 555-0142", "(214) 555-0187", "+254 712 555 019", "(555) 010-0123"];
  for (const [i, partner] of withAdults.entries()) {
    const answers = [
      { q: qBy("Best phone number to reach you"), value: phones[i % phones.length] },
      {
        q: qBy("Emergency contact: name"),
        value: ["Dana Whitfield", "Jordan Lee", "Pat Reynolds", "Casey Nguyen"][i % 4],
      },
    ];
    if (i % 2 === 0)
      answers.push({
        q: qBy("How do you prefer to be contacted?"),
        value: ["whatsapp", "email"][(i / 2) % 2],
      });
    const response = await prisma.surveyResponse.create({
      data: {
        surveyId: annual.id,
        partnerId: partner.id,
        submittedAt: new Date(Date.now() - (i + 1) * 86400000),
        answers: {
          create: answers.map(({ q, value }) => ({
            questionId: q.id,
            position: q.position,
            label: q.label,
            kind: q.kind,
            value,
          })),
        },
      },
    });
    if (i === 1) {
      const photoQ = qBy("A recent photo of you and your family (optional)");
      const svg = familySilhouette("#7a5c2e");
      await prisma.surveyUpload.create({
        data: {
          responseId: response.id,
          partnerId: partner.id,
          questionId: photoQ.id,
          contentType: "image/svg+xml",
          fileSize: Buffer.byteLength(svg),
          bytes: Buffer.from(svg, "utf-8"),
        },
      });
      await prisma.surveyAnswer.create({
        data: {
          responseId: response.id,
          questionId: photoQ.id,
          position: photoQ.position,
          label: photoQ.label,
          kind: "photo",
          value: "Photo sent",
        },
      });
    }
    await proposeFromResponse(response.id);
  }
  console.log(`  seeded annual update answers for ${withAdults.length} partners`);

  // A support-menu survey (built from its pack) with one partner's answer waiting on Survey updates,
  // so a visitor can see a partner picking from the church's menu and the change waiting for approval.
  const menu = await prisma.supportOption.findMany({
    where: { active: true, staffOnly: false },
    orderBy: [{ group: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const offer = menu.find((o) => o.kind === "offer");
  const multiple = menu.find((o) => o.kind === "multiple" && o.choices.length >= 2);
  if (offer || multiple) {
    const importedSupport = await importPackFile("survey-support-menu");
    const supportSurvey = await prisma.survey.update({
      where: { id: importedSupport.surveyId },
      data: { status: "open" },
      include: { questions: { orderBy: { position: "asc" } } },
    });
    const supportQ = supportSurvey.questions.find((q) => q.kind === "support");
    const takenIds = withAdults.map((p) => p.id);
    const picker = await prisma.partner.findFirst({
      where: { archived: false, kind: "missionary", id: { notIn: takenIds } },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (supportQ && picker) {
      const picks = {};
      if (offer) picks[offer.id] = { selected: true };
      if (multiple) picks[multiple.id] = { choices: multiple.choices.slice(0, 2).sort() };
      const response = await prisma.surveyResponse.create({
        data: {
          surveyId: supportSurvey.id,
          partnerId: picker.id,
          submittedAt: new Date(Date.now() - 2 * 86400000),
          answers: {
            create: [
              {
                questionId: supportQ.id,
                position: supportQ.position,
                label: supportQ.label,
                kind: "support",
                value: JSON.stringify(picks),
              },
            ],
          },
        },
      });
      await proposeFromResponse(response.id);
      console.log("  seeded a support-menu survey answer");
    }
  }
}

// Trip debriefs demo: a few completed trips with a wrap-up debrief, the most recent
// inside the last two weeks so the care team's "Trips wrapped up" bell item has something to
// say. Demo extras only; deterministic (by end date, newest first).
async function seedTripDebriefsDemo() {
  console.log("Seeding trip debriefs...");
  const trips = await prisma.trip.findMany({
    where: { status: "completed", partnerId: { not: null }, endDate: { not: null } },
    orderBy: [{ endDate: "desc" }, { id: "asc" }],
    take: 6,
    select: { id: true, endDate: true },
  });
  const debriefs = [
    {
      debriefWhatWeDid: "Ran a week of children's programs and helped repaint the community hall.",
      debriefWentWell:
        "The team worked well together and the local volunteers joined in on the last two days.",
      debriefWasHard: "Heat, and a day lost to a transport strike.",
      debriefPartnerNeeds: "Another team in the spring, and help buying paint for the second building.",
    },
    {
      debriefWhatWeDid: "Medical clinic and home visits in three villages.",
      debriefWentWell: "Over two hundred people seen, and the local nurses took part throughout.",
      debriefWasHard: "Running short of some medicines by midweek.",
      debriefPartnerNeeds:
        "A supply of basic medicines, and a follow-up visit for the families we couldn't reach.",
    },
    {
      debriefWhatWeDid: "Built a roof frame for the new school classroom.",
      debriefWentWell: "Finished a day early.",
      debriefWasHard: "",
      debriefPartnerNeeds: "Funds for roofing sheets.",
    },
  ];
  for (const [i, trip] of trips.entries()) {
    // Wrapped up some days ago (never before the trip ended), so the newest are inside the
    // two-week window the care team's bell item looks at.
    const wrapped = new Date(
      Math.max(trip.endDate.getTime() + 86400000, Date.now() - (i * 4 + 1) * 86400000)
    );
    await prisma.trip.update({
      where: { id: trip.id },
      data: { ...debriefs[i % debriefs.length], wrappedUpAt: wrapped },
    });
  }

  // One trip that has finished but isn't wrapped up, so the "Trips ready to wrap up" bell item has
  // something to show and a visitor can walk the Wrap up trip wizard themselves.
  const host = await prisma.trip.findFirst({
    where: { partnerId: { not: null }, status: "completed" },
    orderBy: { id: "asc" },
    select: { partnerId: true, partner: { select: { displayName: true } } },
  });
  if (host?.partnerId) {
    const day = 86400000;
    await prisma.trip.create({
      data: {
        partnerId: host.partnerId,
        name: `${host.partner.displayName.split(" ")[0]}'s Harvest Week team`,
        status: "closed",
        type: "Construction",
        description: "A short team that has just come home. Try Wrap up trip on it.",
        startDate: new Date(Date.now() - 12 * day),
        endDate: new Date(Date.now() - 4 * day),
        teamSizeMax: 6,
      },
    });
  }
}

// Care team updates demo: a decided need and an answered prayer on a partner the
// published care member looks after, so "Updates to pass on to partners" has something on the
// bell. Relative dates. Demo extras only; runs after the care teams and contact log.
// Example audit log entries, inside the default 90-day retention window, written by the
// demo's real accounts, with reserved documentation IPs (RFC 5737). Account-deleted examples use
// ids that match no user.
async function seedAuditLogDemo() {
  console.log("Seeding the audit log...");
  const { demoEmailDomain } = require("../src/utils/demoLogins");
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const byEmail = (email) => users.find((u) => u.email === email);
  const admin = users.find((u) => u.role === "admin" && u.active) || users[0];
  if (!admin) return;
  const named = (first, last) => users.find((u) => u.firstName === first && u.lastName === last);
  const pat = named("Pat", "Reynolds");
  const jordan = named("Jordan", "Lee");
  const casey = named("Casey", "Nguyen");
  const careMember = byEmail(demoCareMemberEmail());
  const tripLeader = byEmail(demoTripLeaderEmail());
  const lapsed =
    users.find((u) => u.role === "guest" && !u.active) || users.find((u) => u.email.startsWith("sam."));
  const trip = await prisma.trip.findFirst({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const restricted = await prisma.partner.findFirst({
    where: { isRestricted: true },
    select: { id: true, displayName: true },
  });
  const team = await prisma.careTeamMember.findMany({
    take: 3,
    orderBy: { createdAt: "asc" },
    include: {
      partner: { select: { id: true, displayName: true } },
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  const domain = demoEmailDomain();
  const ipPool = ["203.0.113.14", "203.0.113.27", "198.51.100.8", "198.51.100.63", "192.0.2.40"];
  const ip = (i) => ipPool[i % ipPool.length];
  const label = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || u?.email || null;
  const person = (prefix, u) => ({
    [`${prefix}UserId`]: u?.id ?? null,
    [`${prefix}Email`]: u?.email ?? null,
    [`${prefix}Name`]: u ? label(u) : null,
  });
  const at = (daysAgo, hour = 9, minute = 0) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const rows = [];
  const add = (daysAgo, action, extra = {}, hour = 9 + (rows.length % 8), minute = (rows.length * 7) % 60) =>
    rows.push({ createdAt: at(daysAgo, hour, minute), action, ...extra });

  // Sign-ins: the demo's people, spread over the last month.
  const signers = [admin, pat, jordan, casey, careMember, tripLeader].filter(Boolean);
  signers.forEach((u, i) => {
    for (const d of [2, 9, 21]) {
      if ((i + d) % 3 === 0) continue;
      add(d + (i % 2), "auth.login_success", { ...person("actor", u), ip: ip(i + d) });
    }
  });
  // Someone guessing at the admin login, and a typo.
  add(
    6,
    "auth.login_failed",
    { targetEmail: `info@${domain}`, ip: "198.51.100.99", details: { reason: "unknown_email" } },
    3,
    12
  );
  add(
    6,
    "auth.login_failed",
    { targetEmail: `administrator@${domain}`, ip: "198.51.100.99", details: { reason: "unknown_email" } },
    3,
    13
  );
  if (pat)
    add(
      11,
      "auth.login_failed",
      { ...person("target", pat), ip: ip(2), details: { reason: "wrong_password" } },
      8,
      41
    );
  if (pat) add(11, "auth.login_success", { ...person("actor", pat), ip: ip(2) }, 8, 42);

  // Accounts and access.
  if (jordan) {
    add(41, "user.created", {
      ...person("actor", admin),
      ...person("target", jordan),
      ip: ip(0),
      details: { role: "viewer" },
    });
    add(21, "user.updated", {
      ...person("actor", admin),
      ...person("target", jordan),
      ip: ip(0),
      details: { role: { from: "viewer", to: "editor" } },
    });
    add(20, "auth.mfa_enabled", { ...person("actor", jordan), ip: ip(3) });
  }
  if (casey)
    add(30, "user.created", {
      ...person("actor", admin),
      ...person("target", casey),
      ip: ip(0),
      details: { role: "viewer" },
    });
  if (pat) add(14, "auth.password_changed", { ...person("actor", pat), ip: ip(2) });
  add(18, "user.mfa_reset", { ...person("actor", admin), ...person("target", casey || pat), ip: ip(0) });
  add(27, "user.deleted", {
    ...person("actor", admin),
    targetUserId: "00000000-0000-4000-8000-0000000000a1",
    targetEmail: `former.volunteer@${domain}`,
    targetName: "Former Volunteer",
    ip: ip(0),
    details: { role: "editor" },
  });
  if (trip && tripLeader) {
    add(35, "trip_access.grant", {
      ...person("actor", admin),
      ...person("target", tripLeader),
      entityType: "trip",
      entityId: trip.id,
      entityLabel: trip.name,
      ip: ip(0),
      details: { expiresAt: { from: null, to: null } },
    });
  }
  if (trip && lapsed) {
    add(33, "trip_access.grant", {
      ...person("actor", admin),
      ...person("target", lapsed),
      entityType: "trip",
      entityId: trip.id,
      entityLabel: trip.name,
      ip: ip(0),
    });
    add(8, "trip_access.revoke", {
      ...person("actor", admin),
      ...person("target", lapsed),
      entityType: "trip",
      entityId: trip.id,
      entityLabel: trip.name,
      ip: ip(0),
    });
    add(
      8,
      "guest.deactivate_no_access",
      { ...person("actor", admin), ...person("target", lapsed), ip: ip(0) },
      10,
      31
    );
  }
  team.forEach((seat, i) => {
    add(19 - i * 4, "care_team.updated", {
      ...person("actor", admin),
      entityType: "partner",
      entityId: seat.partner.id,
      entityLabel: seat.partner.displayName,
      ip: ip(0),
      details: seat.isLead
        ? { added: [label(seat.user)], lead: { from: null, to: label(seat.user) } }
        : { added: [label(seat.user)] },
    });
  });

  // Settings, features, data.
  add(45, "settings.feature_toggled", {
    ...person("actor", admin),
    entityType: "settings",
    entityLabel: "Care teams",
    ip: ip(0),
    details: { feature: "careTeam", from: false, to: true },
  });
  add(
    45,
    "settings.feature_toggled",
    {
      ...person("actor", admin),
      entityType: "settings",
      entityLabel: "Contact log",
      ip: ip(0),
      details: { feature: "contactLog", from: false, to: true },
    },
    10,
    5
  );
  add(40, "settings.updated", {
    ...person("actor", admin),
    entityType: "settings",
    entityLabel: "email",
    ip: ip(0),
    details: { postmarkServerToken: "changed", emailFromAddress: { from: null, to: `no-reply@${domain}` } },
  });
  add(23, "settings.updated", {
    ...person("actor", admin),
    entityType: "settings",
    entityLabel: "ai-extraction",
    ip: ip(0),
    details: { anthropicApiKey: "changed" },
  });
  add(12, "settings.updated", {
    ...person("actor", admin),
    entityType: "settings",
    entityLabel: "audit log retention",
    ip: ip(0),
    details: { retentionDays: { from: 60, to: 90 } },
  });
  add(30, "backup.downloaded", { ...person("actor", admin), ip: ip(0) });
  add(7, "backup.downloaded", { ...person("actor", admin), ip: ip(0) });
  add(26, "partner.deleted", {
    ...person("actor", admin),
    entityType: "partner",
    entityId: "00000000-0000-4000-8000-0000000000b1",
    entityLabel: "Old Example Ministry (archived)",
    ip: ip(0),
  });
  add(17, "trip.deleted", {
    ...person("actor", admin),
    entityType: "trip",
    entityId: "00000000-0000-4000-8000-0000000000c1",
    entityLabel: "Cancelled planning trip",
    ip: ip(0),
  });

  // Restricted partner: who changed it and who looked.
  if (restricted) {
    const r = { entityType: "partner", entityId: restricted.id, entityLabel: restricted.displayName };
    add(38, "partner.restricted_changed", {
      ...person("actor", admin),
      ...r,
      ip: ip(0),
      details: { isRestricted: { from: false, to: true } },
    });
    for (const [d, who] of [
      [15, admin],
      [9, pat],
      [3, admin],
      [2, jordan],
    ]) {
      if (who) add(d, "partner.restricted_viewed", { ...person("actor", who), ...r, ip: ip(d) });
    }
  }

  await prisma.auditLog.createMany({ data: rows });
  console.log(`  ${rows.length} entries.`);
}

async function seedPartnerUpdatesDemo() {
  console.log("Seeding care team updates...");
  const careMember = await prisma.user.findUnique({ where: { email: demoCareMemberEmail() } });
  if (!careMember) return;
  const seat = await prisma.careTeamMember.findFirst({
    where: { userId: careMember.id },
    orderBy: { createdAt: "desc" },
  });
  if (!seat) return;
  const daysAgo = (n) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n));
  };
  await prisma.supportNeed.create({
    data: {
      partnerId: seat.partnerId,
      description: "Help covering the cost of the family's annual residency renewal.",
      requestedAmount: 600,
      requestDate: daysAgo(14),
      approvedAmount: 400,
      approvedDate: daysAgo(2),
      decisionNote:
        "Funded in part from the missions committee's fund; the family may want to know the rest is theirs to raise.",
    },
  });
  await prisma.prayerRequest.create({
    data: {
      partnerId: seat.partnerId,
      category: "situational",
      requestText: "Pray for their daughter's health as she recovers from surgery.",
      dateReceived: daysAgo(25),
      status: "answered",
      dateAnswered: daysAgo(3),
      answeredNote: "She is home and doing well.",
    },
  });
}

async function main() {
  const existingMissionaries = await prisma.partner.count({ where: { kind: "missionary" } });
  const existingOrgs = await prisma.partner.count({ where: { kind: "organization" } });
  if (existingMissionaries > 0 || existingOrgs > 0) {
    console.log(
      `Found ${existingMissionaries} missionaries and ${existingOrgs} organizations already on file — seeding will add more on top of these, not replace them.`
    );
  }

  // A freshly created database has no settings row yet (the app makes it on first use); the seed
  // updates it below, so make sure it exists.
  await prisma.churchSettings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } });

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
    // Every missionary gets both a SendingChurch and a SendingOrg record (the schema doesn't
    // make them exclusive). sentByOurChurch decides whether the SendingChurch is this church
    // (from Church Settings) or a fictional one.
    const sentByOurChurch = churchSettings && chance(0.3);
    const fallbackChurchName = pick(FALLBACK_CHURCH_NAMES);
    const sendingOrgName = pick(SENDING_ORGS);

    const participantPool = [
      `${pick(FIRST_M)} ${pick(LAST)}`,
      `${pick(FIRST_F)} ${pick(LAST)}`,
      `${pick(FIRST_M)} ${pick(LAST)}`,
      `${pick(FIRST_F)} ${pick(LAST)}`,
      `${pick(FIRST_M)} ${pick(LAST)}`,
      `${pick(FIRST_F)} ${pick(LAST)}`,
    ];

    const adults = isFamily
      ? [
          {
            firstName: displayName.split(" and ")[0],
            lastName: last,
            phone1: fakePhone(),
            phone2: chance(0.25) ? fakePhone() : null,
            email: `${slugify(displayName.split(" and ")[0])}.${slugify(last)}@example.com`,
            birthday: dateBetween(60, 28),
            contactMethod: pick(CONTACT_METHODS),
          },
          {
            // The second spouse: first name from displayName.split(" and ")[1] plus
            // the shared last name.
            firstName: displayName.split(" and ")[1].split(" ")[0],
            lastName: last,
            phone1: fakePhone(),
            phone2: null,
            email: `${slugify(displayName.split(" and ")[1])}@example.com`,
            birthday: dateBetween(58, 26),
            contactMethod: pick(CONTACT_METHODS),
          },
        ]
      : [
          {
            firstName: displayName.split(" ")[0],
            lastName: last,
            phone1: fakePhone(),
            phone2: chance(0.15) ? fakePhone() : null,
            email: `${slugify(displayName)}@example.com`,
            birthday: dateBetween(55, 25),
            contactMethod: pick(CONTACT_METHODS),
          },
        ];
    const childCount = isFamily && chance(0.6) ? randInt(1, 4) : 0;
    const children = Array.from({ length: childCount }, () => ({
      firstName: pick(FIRST_M.concat(FIRST_F)),
      lastName: last,
      birthday: dateBetween(17, 1),
    }));

    const furloughs = chance(0.2)
      ? [
          chance(0.3)
            ? {
                startDate: dateBetween(0, 0),
                endDate: null,
                notes: "Currently stateside for home assignment.",
              }
            : (() => {
                // End derived from start: drawn independently, a start and end
                // in the same month would invert about half the time.
                const startDate = dateBetween(3, 1);
                return {
                  startDate,
                  endDate: daysAfter(startDate, randInt(90, 300)),
                  notes: "Completed home assignment, deputation, and medical checkups.",
                };
              })(),
        ]
      : [];

    const photo = await resolveMissionaryPhoto(photoPools, isFamily, childCount);
    const hasEmergencyContact = chance(0.5);

    const createdMissionary = await prisma.partner.create({
      data: {
        kind: "missionary",
        displayName,
        fieldDisplayName: fieldInfo.field,
        fipsCountryCode: fieldInfo.fips,
        isPublic,
        isRestricted,
        archived,
        archivedAt: archived ? dateBetween(0, 0) : null,
        sentByOurChurch: !!sentByOurChurch,
        overview,
        overviewShort,
        focusArea: `Primary focus: ${focusList.join(", ")}.`,
        supportingSince: new Date(year, 0, 1),
        anniversary: isFamily ? dateBetween(35, 5) : null,
        // Relationship dates (annual key dates), recorded for about half.
        commissionedAt: chance(0.5) ? dateBetween(15, 2) : null,
        // Not every partner has this recorded; leave a fraction "Never".
        lastPrayedWithCongregationAt: chance(0.6) ? dateBetween(1, 0) : null,
        languages: { create: buildLanguages() },
        tripTeamSizeMin: chance(0.7) ? randInt(2, 6) : null,
        tripTeamSizeMax: chance(0.7) ? randInt(8, 15) : null,
        tripTypes: { create: pickN(TRIP_TYPES, randInt(1, 3)).map((type) => ({ type })) },
        tripSeasonNotes: chance(0.5) ? pick(SEASON_NOTES) : null,
        tripLogisticsNotes: chance(0.5) ? pick(LOGISTICS_NOTES) : null,
        links: { create: buildLinks(`${last.toLowerCase()}family`) },
        photos: {
          create: {
            bytesRow: { create: { bytes: photo.bytes } },
            contentType: photo.contentType,
            receivedDate: dateBetween(1, 0),
          },
        },
        emergencyContactName: hasEmergencyContact ? `${pick(FIRST_M.concat(FIRST_F))} ${pick(LAST)}` : null,
        emergencyContactPhone: hasEmergencyContact ? fakePhone() : null,
        emergencyContactEmail: null,
        adults: { create: adults },
        children: { create: children },
        addresses: {
          create: [
            {
              type: "physical",
              city: fieldInfo.city,
              country: fieldInfo.country,
              gpsLat: fieldInfo.lat + (Math.random() - 0.5) * 0.3,
              gpsLng: fieldInfo.lng + (Math.random() - 0.5) * 0.3,
            },
            {
              type: "mailing",
              addressLine1: `PO Box ${randInt(100, 9999)}`,
              city: "Rock Island",
              stateProvinceRegion: "IL",
              postalCode: "61201",
              country: "USA",
              receiveMail: true,
              receivePackages: chance(0.5),
            },
          ],
        },
        trips: { create: buildTrips(participantPool) },
        furloughs: { create: furloughs },
        churchVisits: buildChurchVisits(),
        supportEntries: { create: buildSupportEntries() },
        needRequests: { create: buildNeedRequests() },
        prayerRequests: { create: buildPrayerRequests() },
        sendingParties: {
          create: [
            sentByOurChurch
              ? {
                  type: "church",
                  name: churchSettings.churchName,
                  contactFirstName: churchSettings.contactFirstName,
                  contactLastName: churchSettings.contactLastName,
                  contactEmail: churchSettings.contactEmail,
                  websiteLink: churchSettings.websiteLink,
                  phone: churchSettings.phone,
                  addressLine1: churchSettings.addressLine1,
                  addressLine2: churchSettings.addressLine2,
                  city: churchSettings.city,
                  stateProvinceRegion: churchSettings.stateProvinceRegion,
                  postalCode: churchSettings.postalCode,
                  country: churchSettings.country,
                }
              : {
                  type: "church",
                  name: fallbackChurchName,
                  contactFirstName: pick(FIRST_M.concat(FIRST_F)),
                  contactLastName: pick(LAST),
                  contactEmail: chance(0.6) ? `missions@${slugify(fallbackChurchName)}.example.org` : null,
                  websiteLink: chance(0.5) ? `https://${slugify(fallbackChurchName)}.example.org` : null,
                  phone: chance(0.5) ? fakePhone() : null,
                },
            {
              type: "org",
              name: sendingOrgName,
              contactFirstName: pick(FIRST_M.concat(FIRST_F)),
              contactLastName: pick(LAST),
              contactEmail: chance(0.7) ? `partnercare@${slugify(sendingOrgName)}.example.org` : null,
              websiteLink: chance(0.6) ? `https://${slugify(sendingOrgName)}.example.org` : null,
              phone: chance(0.5) ? fakePhone() : null,
            },
          ],
        },
        ...attribution,
      },
    });

    await maybeAddNewsletter({
      partnerId: createdMissionary.id,
      name: displayName,
      slug: last.toLowerCase(),
      field: fieldInfo.field,
    });
    await maybeAddDocument({
      partnerId: createdMissionary.id,
      name: displayName,
      slug: last.toLowerCase(),
      field: fieldInfo.field,
    });
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

    const participantPool = [
      `${pick(FIRST_M)} ${pick(LAST)}`,
      `${pick(FIRST_F)} ${pick(LAST)}`,
      `${pick(FIRST_M)} ${pick(LAST)}`,
      `${pick(FIRST_F)} ${pick(LAST)}`,
    ];

    const logo = await resolveOrgLogo(photoPools);

    const created = await prisma.partner.create({
      data: {
        kind: "organization",
        displayName: name,
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
        // Not every partner has this recorded; leave a fraction "Never".
        lastPrayedWithCongregationAt: chance(0.6) ? dateBetween(1, 0) : null,
        contactFirstName: pick(FIRST_M.concat(FIRST_F)),
        contactLastName: pick(LAST),
        contactPhone: fakePhone(),
        contactEmail: `info@${slugify(name)}.example.org`,
        contactMethod: pick(CONTACT_METHODS),
        links: { create: buildLinks(slugify(name)) },
        tripTeamSizeMin: chance(0.7) ? randInt(4, 8) : null,
        tripTeamSizeMax: chance(0.7) ? randInt(10, 20) : null,
        tripTypes: { create: pickN(TRIP_TYPES, randInt(1, 3)).map((type) => ({ type })) },
        tripSeasonNotes: chance(0.5) ? pick(SEASON_NOTES) : null,
        tripLogisticsNotes: chance(0.5) ? pick(LOGISTICS_NOTES) : null,
        photos: {
          create: {
            bytesRow: { create: { bytes: logo.bytes } },
            contentType: logo.contentType,
            receivedDate: dateBetween(1, 0),
          },
        },
        addresses: {
          create: [
            {
              type: "physical",
              city: fieldInfo.city,
              country: fieldInfo.country,
              gpsLat: fieldInfo.lat + (Math.random() - 0.5) * 0.3,
              gpsLng: fieldInfo.lng + (Math.random() - 0.5) * 0.3,
            },
            ...(chance(0.4)
              ? [
                  {
                    type: "mailing",
                    addressLine1: `PO Box ${randInt(100, 9999)}`,
                    city: fieldInfo.city,
                    country: fieldInfo.country,
                    receiveMail: true,
                    receivePackages: chance(0.5),
                  },
                ]
              : []),
          ],
        },
        trips: { create: buildTrips(participantPool) },
        churchVisits: buildChurchVisits(),
        supportEntries: { create: buildSupportEntries() },
        needRequests: { create: buildNeedRequests() },
        prayerRequests: { create: buildPrayerRequests() },
        ...attribution,
      },
    });

    await maybeAddNewsletter({ partnerId: created.id, name, slug: slugify(name), field: fieldInfo.field });
    await maybeAddDocument({ partnerId: created.id, name, slug: slugify(name), field: fieldInfo.field });
  }

  if (SEED_DEMO_EXTRAS) {
    await seedUnmatchedEmails();
    await seedAdditionalUsers();
    await seedTripsDemo();
    // Last -- reads back the prayer requests/needs/newsletters just
    // created above, so it needs them to already exist.
    await seedNotificationQueue();
    // After the queue: its generic pass sends the first few ordinary prayers
    // through unreviewed, and this adds the HELD care-team ones on top.
    await seedCareTeamsDemo();
    await seedContactLogDemo();
    await seedKeyDatesDemo();
    await seedSupportPreferencesDemo();
    await seedSurveysDemo();
    await seedTripDebriefsDemo();
    await seedPartnerUpdatesDemo();
    await seedAuditLogDemo();
    await seedLastEditedDemo();
  }

  const finalMissionaries = await prisma.partner.count({ where: { kind: "missionary" } });
  const finalOrgs = await prisma.partner.count({ where: { kind: "organization" } });
  console.log(`Done. Missionaries: ${finalMissionaries}, Organizations: ${finalOrgs}.`);
}

// Guarded so this file can be require()'d (e.g. to reuse buildFakePdf/buildFakeEml) without
// re-running the whole seed against the active DATABASE_URL.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

// seedTripsDemo is exported so Trips demo data can be reset and reseeded alone; the full seed is
// additive and would keep growing.
module.exports = {
  buildFakePdf,
  buildFakeEml,
  scannableExtras,
  seedTripsDemo,
  seedCareTeamsDemo,
  seedContactLogDemo,
  seedKeyDatesDemo,
  seedPartnerUpdatesDemo,
};
