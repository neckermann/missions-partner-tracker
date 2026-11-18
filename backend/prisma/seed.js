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
const { generateShareToken } = require("../src/utils/tripAccessToken");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Overridable via env for deployments that want a different amount of
// seed data (e.g. a public demo) without forking this file. `||` would
// treat an explicit 0 as "unset" and silently fall back to the default,
// so this checks presence first.
const MISSIONARY_COUNT = process.env.SEED_MISSIONARY_COUNT ? Number(process.env.SEED_MISSIONARY_COUNT) : 35;
const ORGANIZATION_COUNT = process.env.SEED_ORGANIZATION_COUNT
  ? Number(process.env.SEED_ORGANIZATION_COUNT)
  : 12;
// On by default (local `npm run seed`, the live demo reset) -- unmatched
// inbound emails, extra admin/editor/viewer users, and a sample pending-
// dispatches queue, all of which a fresh route-test/CI database must
// NOT have: those suites assert on InboundEmail/DispatchRecord/User
// tables assuming nothing but their own fixtures touched them (see
// CONTRIBUTING.md § Local development data for this exact hazard).
// CI's e2e job and scripts/test-db.js both set this to "false" before
// calling this script for that reason -- see each one's own comment.
const SEED_DEMO_EXTRAS = process.env.SEED_DEMO_EXTRAS !== "false";

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
// A date `years` ago, give or take a few months, on a random day of that
// month.
//
// Two bugs lived in the old version, and both showed up the moment the
// Upcoming Birthdays report started grouping by day:
//
//   d.setDate(1)  pinned EVERY seeded date -- birthdays, trip and furlough
//                 dates, newsletter received dates, support effective dates,
//                 prayer request dates -- to the first of the month. Demo
//                 data had thirty-five missionaries all born on the 1st.
//
//   local time    these columns are @db.Date, so Prisma stores the UTC
//                 calendar date. Building the date in local time and keeping
//                 the current time of day meant that whenever the seed ran
//                 after ~7pm US Eastern, the 1st was already the 2nd in UTC
//                 and every date shifted together. Hence a demo where every
//                 birthday read "October 2".
//
// Built in UTC throughout, so what goes in is what comes back out.
function dateYearsAgo(years, monthsJitter = 6) {
  const now = new Date();
  const year = now.getUTCFullYear() - years;
  // Date.UTC normalises a negative month by rolling the year back, so no
  // wrap-around arithmetic is needed here.
  const month = now.getUTCMonth() - randInt(0, monthsJitter);
  // Day 0 of the following month is the last day of this one -- keeps
  // February and the thirty-day months honest without a lookup table.
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, randInt(1, daysInMonth)));
}

// `days` after `start`, same UTC-only discipline.
function daysAfter(start, days) {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}
function dateBetween(startYearsAgo, endYearsAgo) {
  return dateYearsAgo(randInt(endYearsAgo, startYearsAgo));
}
function fakePhone() {
  return `(${randInt(200, 999)}) 555-${String(randInt(0, 9999)).padStart(4, "0")}`;
}

// A handful of real US city/state/zip triples -- enough variety that a
// list of enriched historical participants doesn't all live in the same
// town, without the overhead of a real geocoded address pool.
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
// A plausible adult (not the participant's own) emergency contact --
// never a real name pulled from the same FIRST/LAST pools in a way that
// could coincide with the participant's own, but close enough in shape
// (a family member sharing the participant's last name is the common
// real-world case for this field).
function fakeEmergencyContact(participantLastName) {
  const firstName = pick(FIRST_M.concat(FIRST_F));
  const lastName = participantLastName || pick(LAST);
  const emailLocal = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, "");
  return {
    emergencyContactName: `${firstName} ${lastName}`,
    emergencyContactPhone: fakePhone(),
    emergencyContactEmail: `${emailLocal}@example.com`,
  };
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

// Default e-signature requirement text, generalized from what the user's
// own church currently asks applicants to agree to -- a real, usable
// starting point every fork can edit or delete, not hardcoded app logic
// (CONTRIBUTING.md's "keep forks upgradable" rule). Used by both the
// church-wide tripRequirementTemplate (below) and directly on the demo
// open trip (seedTripsDemo), so there's something real to sign without
// waiting on a brand-new trip to pick up the template automatically.
const LIABILITY_RELEASE_TEXT = `Liability Release and Code of Conduct — Short-Term Mission Trip

I understand that participation in this short-term mission trip involves inherent risks, including but not limited to travel-related injury, illness, and property loss, and that these risks cannot be entirely eliminated no matter what care is taken. I voluntarily assume all such risks and release the church, its staff, and its partner organizations from liability for any injury, loss, or damage arising from my participation, except where caused by gross negligence.

I agree to conduct myself in a manner consistent with the team's values throughout the trip. Specifically, I agree not to use alcohol or tobacco, not to engage in public displays of affection with another team member (whether married or single), not to use profane or vulgar language, to dress modestly and appropriately in a way that respects the customs and expectations of the culture we are serving in, and to avoid a critical or complaining attitude toward team leadership, fellow team members, or the conditions of the trip. I will follow the reasonable direction of the team leader at all times, and will represent the team and the church respectfully in my interactions with our hosts and host community.

I confirm that I have disclosed any medical conditions, allergies, or medications the team leader should be aware of, and that I am responsible for bringing an adequate supply of any personal medication for the duration of the trip.

I understand that the team leader may send me home at my own expense if my conduct endangers myself, another team member, or the trip's relationship with our hosts.

This agreement is governed by the laws of the state in which the church is located.`;

// Seeded into ChurchSettings.tripRequirementLibrary by default (not
// auto-added to every trip -- picked onto a specific trip's own
// Requirements section only when that trip actually has minors on it).
// Written in the parent/guardian's own voice, parallel in structure to
// LIABILITY_RELEASE_TEXT above (risk acknowledgment, code-of-conduct
// consent on the minor's behalf, medical-treatment authorization --
// specifically needed here since a minor generally can't consent to
// their own medical treatment, media release, governing law), not
// copied from any real source. A starting point, not vetted legal
// advice -- the trailing note says so explicitly, same as a church
// would want to have any release form reviewed by its own counsel
// before relying on it.
const MINOR_RELEASE_TEXT = `Minor Travel Release, Consent, and Medical Authorization — Short-Term Mission Trip

I am the parent or legal guardian of the minor named on this form, and I give my permission for them to participate in this short-term mission trip.

I understand that participation involves inherent risks, including but not limited to travel-related injury, illness, and property loss, and that these risks cannot be entirely eliminated no matter what care is taken. I voluntarily assume these risks on my child's behalf and release the church, its staff, and its partner organizations from liability for any injury, loss, or damage arising from their participation, except where caused by gross negligence.

I authorize the team leader and any accompanying adult leaders to consent to emergency medical treatment for my child if I cannot be reached in a timely manner, and I confirm that I have disclosed any medical conditions, allergies, or medications the team leader should be aware of. I am responsible for ensuring my child brings an adequate supply of any personal medication for the duration of the trip.

I agree, on my child's behalf, that they will follow the same code of conduct every team member agrees to: no alcohol or tobacco, modest and culturally appropriate dress, respectful behavior toward team leadership, fellow team members, and our hosts, and the reasonable direction of the team leader at all times. I understand the team leader may send my child home at my own expense if their conduct endangers themselves, another team member, or the trip's relationship with our hosts.

I consent to photos and video of my child taken during the trip being used in the church's own newsletters, website, and social media.

This agreement is governed by the laws of the state in which the church is located.

This is a starting template, not legal advice -- have it reviewed by your own church's legal counsel before relying on it.`;

// Shared across every seeded passport question (two trip-level
// applicationQuestions + the church-wide tripQuestionLibrary entry below) --
// one wording, not three near-duplicates that could drift out of sync.
const PASSPORT_OPTIONS = [
  "Yes, I have a passport that will be valid for at least 6 months from the time the trip starts",
  "No, I do not have a passport, but there is enough time to get one before the deadline",
  "No, and there is not enough time to get one before the deadline",
];

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
// Fallback for SendingChurch when Church Settings hasn't been configured
// yet — per the README's setup order (migrate -> seed -> createAdmin),
// that's the common case, so this can't rely on churchSettings existing.
const FALLBACK_CHURCH_NAMES = [
  "Grace Community Church",
  "First Baptist Church",
  "Crossroads Fellowship",
  "Hillside Community Church",
  "Faith Community Church",
  "Riverside Chapel",
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
// one of the file types the Newsletters & Docs feature already explicitly
// supports (see routes/partnerFiles.js's resolveExt).
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
      bytes: buffer,
      fileName: "update.eml",
      contentType: "message/rfc822",
      fileSize: buffer.length,
    },
  });
}

// Titles per document kind — see backend/src/routes/fileKinds.js's
// FILE_KINDS for what these keys mean. "other" pairs a title with its own
// free-typed customKind, same as a real admin would fill in.
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
    // Only for kinds where a prayer request/need mention is plausible
    // content -- a signed policy or background-check result wouldn't
    // realistically contain one.
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
  return {
    bytes: Buffer.from(buildingSilhouette(pick(SILHOUETTE_COLORS)), "utf-8"),
    contentType: "image/svg+xml",
  };
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
// Deliberately NOT "logo"/"brand" terms -- stock libraries tag essentially
// any designed product photography (packaging, merchandise, ads, across
// every industry with zero regard for appropriateness) under those same
// generic branding keywords, and a real reseed against a real Pexels
// account surfaced exactly that kind of unrelated, inappropriate product
// photo for a missions app showing a church's partners. These queries ask
// for photographic content specific to a church/missions context instead
// of a generic "org" concept, so results land in the same narrow, fitting
// neighborhood this app actually depicts.
const PEXELS_ORG_QUERIES = [
  "church building exterior",
  "mission trip volunteers serving community",
  "world map globe",
];

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

const ALBUM_PROVIDERS = ["google_photos", "icloud", "other"];

// 0-3 rather than 0-2 -- a seeded partner with a longer relationship
// history should sometimes show three or more past trips, not cap out
// at two, so Trip History has real variety to scroll through.
function buildTrips(participantNamePool) {
  const count = randInt(0, 3);
  const trips = [];
  for (let i = 0; i < count; i++) {
    const start = dateBetween(4, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + randInt(5, 12));
    const participants = pickN(participantNamePool, randInt(2, 5)).map((name, idx) => {
      const [firstName, ...rest] = name.split(" ");
      const lastName = rest.join(" ") || null;
      return {
        firstName,
        lastName,
        role: pick(TRIP_ROLES),
        isLeader: idx === 0,
        // Always populated now, not a coin flip -- a historical,
        // already-completed trip's team is exactly the kind of record
        // a real admin would have on file in full; "sometimes missing"
        // only makes sense for a trip still in progress.
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

// Higher chance and sometimes more than one, so a seeded partner's
// one-time-need history reads like an actual multi-year relationship
// rather than at most a single isolated ask -- and both the
// requested-amount view (undecided) and the decision/approved view
// (decided, every outcome) get real, varied examples to show off,
// not just whichever one the dice happened to land on.
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
      // decisionNote documents *why* the decision came out this way --
      // separate from the general `notes` field below, same reasoning
      // as the schema.prisma comment on SupportNeed.decisionNote.
      // Populated most of the time a decision exists, not every time,
      // so a seeded instance also shows the "decided, no note" case.
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

// The Unmatched Emails admin queue (routes/inboundEmail.js) is always
// empty after a reset/seed otherwise -- nothing else in this file ever
// creates an InboundEmail row, since every newsletter/document above is
// created already assigned to a partner. fromAddress is deliberately
// unrelated to any seeded partner's own contact/adult email, same as a
// real stranger's message landing in the review queue.
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
      `To: missions@example.org`,
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
        bytes: buffer,
        fileName: "email.eml",
        receivedAt,
      },
    });
  }
}

const ADDITIONAL_USERS = [
  { name: "Pat Reynolds", role: "editor", cadence: null, active: true, mfaSetupRequired: false },
  { name: "Jordan Lee", role: "editor", cadence: null, active: true, mfaSetupRequired: true },
  { name: "Casey Nguyen", role: "viewer", cadence: null, active: true, mfaSetupRequired: false },
  { name: "Morgan Patel", role: "admin", cadence: null, active: false, mfaSetupRequired: false },
];

// Beyond the one env-var-driven demo admin (createAdmin.js), a handful
// more across roles/active-state/MFA-required -- so Manage Users has
// real variety to show, not just a single row. mfaSetupRequired (forces
// enrollment at next login), not mfaEnabled, for the MFA example --
// mfaEnabled with no real TOTP secret would leave that account
// permanently unable to complete login. Fixed, obviously-fake password
// -- these exist to populate the list, not to be logged into for the
// demo. None are ever given a cadence: every one of these accounts'
// email is a generated @example.org address nobody reads, and
// example.org is a reserved, non-deliverable domain (RFC 2606) -- but a
// scheduled digest actually attempting to send there is still exactly
// the kind of thing a demo reset must never do by default. The admin
// cadence picker's own UI is enough to demonstrate the feature; seeded
// data doesn't need to exercise the send path too.
// Trips (#252) demo data -- a handful of hand-crafted trips layered on
// top of whatever partners buildTrips() already gave random historical
// trips to, so the new recruiting/team/support-raising feature has
// something real to click through: one actively-recruiting (public)
// trip with a pending application and a partial team, one
// team-finalized (closed) trip, and one restricted-partner trip using
// the private-link mechanism instead of public discovery. shareToken/
// applicationShareToken are generated here regardless of
// ChurchSettings.allowPublicSupportRaisingLinks/allowPrivateApplicationLinks
// (both off by default) -- an admin flips those settings on to actually
// use the links this seed already created, same as toggling any other
// feature on against existing data.
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
    // A third, distinct partner for the new "planning"-stage trip below --
    // skip: 1 so it's neither the alphabetically-first (openPartner) nor
    // -last (closedPartner) partner.
    prisma.partner.findFirst({
      where: { archived: false, isRestricted: false },
      orderBy: { displayName: "asc" },
      skip: 1,
    }),
  ]);
  if (!openPartner || !closedPartner) return;

  // Needed below for the approved application's own reviewedById -- same
  // "whoever's seeded as an admin" lookup main() already does for its own
  // createdById/updatedById attribution.
  const admin = await prisma.user.findFirst({ where: { role: "admin" } });

  const openStart = dateBetween(-1, -2);
  const openEnd = new Date(openStart);
  openEnd.setDate(openEnd.getDate() + randInt(5, 10));
  const closedStart = dateBetween(-2, -3);
  const closedEnd = new Date(closedStart);
  closedEnd.setDate(closedEnd.getDate() + randInt(5, 10));

  // Flight segments (#252 follow-on, replaces the former flightDetails
  // free text) -- a real connection (two segments, one leg) for the
  // whole team, plus a separate segment labeled for just two people
  // flying from a different city, same example shape as the approved
  // mockup. Demonstrates the actual variability this design exists to
  // handle (connections, mixed group/individual bookings), not just the
  // simplest one-segment case.
  const outboundLeg1Depart = new Date(openStart);
  outboundLeg1Depart.setHours(8, 15, 0, 0);
  const outboundLeg1Arrive = new Date(outboundLeg1Depart.getTime() + 14.5 * 60 * 60 * 1000);
  const outboundLeg2Depart = new Date(outboundLeg1Arrive.getTime() + 2 * 60 * 60 * 1000);
  const outboundLeg2Arrive = new Date(outboundLeg2Depart.getTime() + 5.5 * 60 * 60 * 1000);
  const soloDepart = new Date(openStart);
  soloDepart.setHours(6, 40, 0, 0);
  const soloArrive = new Date(soloDepart.getTime() + 19 * 60 * 60 * 1000);

  const openTrip = await prisma.trip.create({
    data: {
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
      // Emergency contact deliberately NOT repeated here -- it's covered by
      // the church-wide tripApplicationTemplate seeded below, which is
      // exactly the case that layering exists for: a question every trip
      // asks lives in the template once, not retyped per trip.
      applicationQuestions: [
        { id: "q1", label: "Do you have any dietary restrictions?", required: false },
        {
          id: "q3",
          type: "select",
          label: "Do you have a valid passport?",
          required: true,
          options: PASSPORT_OPTIONS,
        },
        // checkboxes (multi-select, array response) wasn't exercised
        // anywhere in this seed otherwise -- every other question here or
        // in the template/library is text/textarea/select/date.
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
      ],
      applications: {
        create: [
          {
            firstName: "James",
            lastName: "Okonkwo",
            email: "james.okonkwo@example.org",
            phone: "555-0198",
            emergencyContactName: "Grace Okonkwo",
            emergencyContactPhone: "555-0142",
            emergencyContactEmail: "grace.okonkwo@example.org",
            // Structured address (#252 follow-on) -- at least one seeded
            // application needs these populated to actually demonstrate
            // the feature, not just leave the columns null.
            addressLine1: "482 Maple Street",
            city: "Rock Island",
            stateProvinceRegion: "IL",
            postalCode: "61201",
            country: "USA",
            // Real column now, not a template question's answer -- see
            // ChurchSettings.collectDateOfBirth's own schema comment.
            dateOfBirth: new Date(Date.UTC(1991, 2, 22)),
            // Every question this trip actually asks answered (template
            // layer + this trip's own q1/q3) -- a half-answered pending
            // application doesn't show what the admin review screen looks
            // like once someone has actually finished the form.
            responses: {
              tmpl2: "Yes",
              tmpl3: "Yes",
              tmpl6: "I grew up going to church, but it wasn't until a mission trip in college that my faith became my own.",
              tmpl7: "I'm hoping to serve wherever there's a need and come back with a deeper dependence on God.",
              tmpl8: "Blue Cross Blue Shield, Policy #BC-48213",
              q1: "Vegetarian, no peanuts.",
              q3: "Yes",
              q4: ["Construction", "Cooking/Hospitality"],
            },
          },
          // A declined application, with a real declinedReason -- the
          // only state missing from this trip's application list
          // otherwise (pending and approved already existed; nothing
          // showed the declined flow). Filled out just as completely as
          // the pending one above -- a declined applicant still finished
          // the whole form before being turned down, not a half-blank one.
          {
            firstName: "Derek",
            lastName: "Palmquist",
            email: "derek.palmquist@example.org",
            phone: "555-0176",
            emergencyContactName: "Wendy Palmquist",
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
              tmpl6: "I've been part of my church's missions committee for three years and wanted to finally go myself.",
              tmpl7: "I expect it to be physically demanding, and I'm ready for that.",
              tmpl8: "Aetna, Group #AE-90217",
              q1: "No restrictions.",
              q3: "No",
              q4: ["Teaching/Children's ministry"],
            },
          },
        ],
      },
      // Budget (estimate-only, trip-wide) -- deliberately doesn't sum to
      // this trip's own supportRaisingGoal (1200) above, so the demo also
      // shows the "differs from your goal" hint, not just a clean match.
      budgetLines: {
        create: [
          { label: "Round-trip flights", estimatedAmount: 650 },
          { label: "Lodging", estimatedAmount: 220 },
          { label: "In-country transport", estimatedAmount: 90 },
          { label: "Visa fees", estimatedAmount: 75 },
          { label: "Travel insurance", estimatedAmount: 45 },
        ],
      },
      // Flight segments are created separately, below, once Priya/John
      // exist -- the "just these two" segment needs their real ids
      // (issue #265's participants relation, not a free-text label), so
      // it can't be nested inside this same create.
      // Same e-signature requirement as the church-wide
      // tripRequirementTemplate below, added directly here too so there's
      // something real to sign on this demo trip without first creating
      // a brand new one -- a normal new trip gets this automatically via
      // the template; this trip predates that mechanism in seed order.
      // All three TripRequirement kinds represented, not just esignature
      // -- document and task both need a real example too, and (below)
      // at least one participant fulfilling each while another doesn't,
      // so the "outstanding" state is visible alongside "done".
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
    },
  });
  const priya = await prisma.tripParticipant.create({
    data: {
      trip: { connect: { id: openTrip.id } },
      firstName: "Priya",
      lastName: "Krishnan",
      email: "priya.krishnan@example.org",
      role: "Team Lead",
      isLeader: true,
      supportRaisingGoal: 1200,
      shareToken: generateShareToken(),
      story: "I'm excited to serve this summer and would love your support!",
      // Two contributions, two different methods -- a single-row list
      // doesn't actually show it's a list, and "check" was previously the
      // only TripContribution.method value anywhere in this seed.
      contributions: {
        create: [
          {
            trip: { connect: { id: openTrip.id } },
            donorName: "Family friend",
            // donorEmail/donorPhone -- only ever shown when
            // ChurchSettings.collectDonorContactInfo is on (set below);
            // nothing in this seed populated either column anywhere.
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

  // John -- the deliberate contrast to Priya above: no shareToken, no
  // story, none of the three requirements fulfilled yet. Matches the
  // "Priya & John" flight segment label already seeded. Demonstrates
  // the "freshly added, nothing done yet" state (missing support-raising
  // link included) alongside Priya's "fully set up" one -- a reset that
  // only ever shows the finished state never demonstrates what "still
  // needed" actually looks like.
  const john = await prisma.tripParticipant.create({
    data: {
      trip: { connect: { id: openTrip.id } },
      firstName: "John",
      lastName: "Alvarado",
      email: "john.alvarado@example.org",
      supportRaisingGoal: 1200,
    },
  });

  // John's photo -- the one participant-photo feature needs at least one
  // real example. Reuses the same Pexels pool/download mechanism already
  // used for missionary photos elsewhere in this file, rather than a new
  // image source; silhouette fallback (no PEXELS_API_KEY) just leaves
  // John photo-less, which is a fine fallback state, not an error.
  try {
    const photoPools = await buildPhotoPools();
    const photoUrl = photoPools && nextFromPool(photoPools.single_adult);
    if (photoUrl) {
      const photo = await downloadAndUploadPhoto(photoUrl);
      if (photo) {
        await prisma.tripParticipant.update({
          where: { id: john.id },
          data: { photo: photo.bytes, photoContentType: photo.contentType },
        });
      }
    }
  } catch (err) {
    console.warn("  Skipping John's seed photo:", err.message);
  }

  // David -- this trip's own teamSizeMin is 4; Priya/John/Amara alone left
  // it one short of its own stated minimum. Also a second photo example
  // (previously only John had one) and a fourth distinct partial-profile
  // shape: direct-added like John, but with a shareToken/story/photo/some
  // support raised -- started their public page, never got their
  // emergency contact on file. Completes the document requirement only
  // (a passport upload), leaving the task and e-signature outstanding --
  // a different partial-completion combination from Amara's (task-only).
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
          data: { photo: photo.bytes, photoContentType: photo.contentType },
        });
      }
    }
  } catch (err) {
    console.warn("  Skipping David's seed photo:", err.message);
  }

  // Amara -- the one participant on this trip who actually came through
  // the real application->approval path (Priya/John above were both
  // added directly, which is realistic but meant nothing ever
  // demonstrated a participant whose address/emergency contact/role
  // arrived pre-filled from their own application, or the new read-only
  // "Application answers" section on their detail page -- both were
  // real gaps with no seeded example to show them working). Mirrors
  // exactly what PUT /api/trips/applications/:id's approval branch does
  // on a real approval, not a shortcut shape.
  const amaraApplication = await prisma.tripApplication.create({
    data: {
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
      emergencyContactName: "Chidi Chukwu",
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
    },
  });
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
      emergencyContactName: amaraApplication.emergencyContactName,
      emergencyContactPhone: amaraApplication.emergencyContactPhone,
      emergencyContactEmail: amaraApplication.emergencyContactEmail,
      dateOfBirth: amaraApplication.dateOfBirth,
      supportRaisingGoal: 1200,
      // Some progress, but well short of the goal -- a third distinct
      // raised/goal state alongside Priya's (well-funded) and John's
      // ($0, no shareToken at all).
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

  // Flight segments -- a real connection (two legs, the whole team) plus
  // a separate segment for just Priya and John, flying from a different
  // city. Demonstrates the actual variability this design exists to
  // handle (connections, mixed group/individual bookings). The third
  // segment's `participants` relation (issue #265) needs Priya/John's
  // real ids, which is why this whole block waits until after they
  // (and David/Amara) exist, rather than nesting inside openTrip's own
  // create above.
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
  // createMany can't set a many-to-many relation -- this one needs its
  // own create.
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

  // Fulfillment split across the three requirement kinds -- Priya
  // completes/signs/uploads everything, John does none of it, Amara (below)
  // does exactly one of the three, so "all done," "none done," and
  // "partially done" are all visible on the same trip instead of only ever
  // showing the two extremes.
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
        bytes: passportPdf,
        fileName: "passport.pdf",
        contentType: "application/pdf",
      },
    });
    // David completes the document requirement only -- a different
    // partial-completion combination from Amara's (task-only) above.
    const davidPassportPdf = buildFakePdf("Passport Photo Page", "Seed placeholder -- not a real passport scan.");
    await prisma.tripDocument.create({
      data: {
        tripId: openTrip.id,
        participantId: david.id,
        requirementId: docReq.id,
        title: "Passport photo page",
        bytes: davidPassportPdf,
        fileName: "passport.pdf",
        contentType: "application/pdf",
      },
    });
  }

  // A real signature, not a hand-faked row -- same pdfGeneration.js
  // utility and server-computed SHA-256 hash the actual sign route
  // uses, so this seed row is byte-identical in shape to what a real
  // signature produces (confirmed: the generated PDF opens as a real
  // PDF, same as the real route's own output).
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
          bytes: pdfBytes,
          fileName: "signed-liability-release.pdf",
          contentType: "application/pdf",
          // Merged from the former, separate TripSignature model (§20.1
          // of the plan doc) -- it was always a 1:1 side table keyed off
          // this exact row, never queried independently of it.
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

  // A trip-wide document (participantId: null) -- every TripDocument
  // seeded above was participant-specific; nothing demonstrated the
  // shared-with-the-whole-team case (itinerary, packing list) at all.
  const itineraryPdf = buildFakePdf(
    "Team Itinerary & Packing List",
    "Seed placeholder -- not a real itinerary."
  );
  await prisma.tripDocument.create({
    data: {
      tripId: openTrip.id,
      participantId: null,
      title: "Team itinerary & packing list",
      bytes: itineraryPdf,
      fileName: "team-itinerary.pdf",
      contentType: "application/pdf",
    },
  });

  // Meetings -- a completely unrepresented model otherwise. One already
  // past with its day-before reminder stamped (reminderSentAt), one still
  // upcoming with no reminder sent yet -- both states the reminder cron
  // actually needs to distinguish between. Plain day-level Date arithmetic
  // here, not dateBetween (that helper works in years, meant for
  // long-past historical content -- not what a meeting a few weeks out
  // needs).
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

  // This second trip previously had nothing beyond its two bare
  // participants -- no flights, budget, meeting, requirements, or
  // signature anywhere outside the main open trip, which left every one
  // of those look like a one-off special case rather than a feature that
  // works on any trip. A different flavor throughout (domestic build trip,
  // not an international connection), not a duplicate of the open trip.
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
            isLeader: true,
            email: "marcus.t@example.org",
            supportRaisingGoal: 900,
            shareToken: generateShareToken(),
            story: "Excited to lead this build team again this fall -- thank you for considering a gift!",
          },
          // Sarah -- the same contrast Priya/John already demonstrate on
          // the open trip, shown again here so it reads as the normal
          // range of participant states, not something only the open trip
          // happens to show.
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
          bytes: pdfBytes,
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

  // Marcus's photo -- a third example, on a trip the open trip's own
  // participants don't otherwise represent.
  try {
    const photoPools = await buildPhotoPools();
    const photoUrl = photoPools && nextFromPool(photoPools.single_adult);
    if (photoUrl) {
      const photo = await downloadAndUploadPhoto(photoUrl);
      if (photo) {
        await prisma.tripParticipant.update({
          where: { id: marcus.id },
          data: { photo: photo.bytes, photoContentType: photo.contentType },
        });
      }
    }
  } catch (err) {
    console.warn("  Skipping Marcus's seed photo:", err.message);
  }

  // A trip still in "planning" -- not yet accepting applications. Every
  // other seeded trip here was already either accepting applications,
  // closed, or completed; nothing demonstrated this earlier lifecycle
  // stage at all.
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
        applicationQuestions: [
          { id: "q1", type: "select", label: "Do you have a valid passport?", required: true, options: PASSPORT_OPTIONS },
        ],
        requirements: {
          create: [{ label: "Signed Confidentiality Agreement", kind: "esignature", bodyText: LIABILITY_RELEASE_TEXT }],
        },
      },
    });

    // Zero participants/applications here otherwise -- the masked (not
    // excluded) private-link/support-raising code paths this trip's
    // isPublic: false + restricted partner exist to exercise had nothing
    // real to click through. Approved via a real application, same
    // field-copy shape as the open trip's Amara.
    const restrictedApplication = await prisma.tripApplication.create({
      data: {
        tripId: restrictedTrip.id,
        firstName: "Hannah",
        lastName: "Weiss",
        email: "hannah.weiss@example.org",
        phone: "555-0184",
        status: "approved",
        reviewedAt: dateBetween(1, 0),
        reviewedById: admin?.id || null,
        responses: { q1: "Yes" },
      },
    });
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

  // A trip with minors on it -- demonstrates collectParentGuardianInfo
  // end to end: a minor's application with real parent/guardian info
  // and a date of birth, the Minor Travel Release picked from the new
  // tripRequirementLibrary onto this specific trip only (never every
  // trip), and that requirement signed by the parent, not the minor,
  // via the signerRelationship field. Reuses closedPartner rather than
  // a brand-new partner lookup -- a long-term field partner hosting
  // more than one short-term team over time is realistic, not a
  // shortcut.
  const minorsTripStart = dateBetween(-1, -2);
  const minorsTripEnd = new Date(minorsTripStart);
  minorsTripEnd.setDate(minorsTripEnd.getDate() + randInt(5, 7));
  // dateYearsAgo (not a hand-rolled `setFullYear`) -- the latter leaves
  // the month/day pinned to whatever day the seed happens to run on,
  // so every minor's birthday would land on today's calendar date no
  // matter how many years back. dateYearsAgo's own jitter avoids that.
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
      collectParentGuardianInfo: true,
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
      parentGuardianName: "Karen Thompson",
      parentGuardianRelationship: "Mother",
      parentGuardianPhone: "555-0212",
      parentGuardianEmail: "karen.thompson@example.org",
      emergencyContactName: "Karen Thompson",
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
      parentGuardianName: minorApplication.parentGuardianName,
      parentGuardianRelationship: minorApplication.parentGuardianRelationship,
      parentGuardianPhone: minorApplication.parentGuardianPhone,
      parentGuardianEmail: minorApplication.parentGuardianEmail,
      emergencyContactName: minorApplication.emergencyContactName,
      emergencyContactPhone: minorApplication.emergencyContactPhone,
      emergencyContactEmail: minorApplication.emergencyContactEmail,
      supportRaisingGoal: minorsTrip.supportRaisingGoal,
      shareToken: generateShareToken(),
      story: "So excited for my first mission trip -- thank you for supporting me!",
    },
  });

  // An adult co-leader, direct-added like Priya/John on the open trip --
  // a trip with minors still needs an adult the minor isn't the only
  // one on. Given a full profile (phone/address/DOB/emergency contact),
  // unlike Priya/John/David/Sarah's deliberate partial-profile contrast
  // elsewhere in this file -- this trip's own point is to show the
  // minors feature working end to end, not to demonstrate a missing-field
  // state.
  await prisma.tripParticipant.create({
    data: {
      tripId: minorsTrip.id,
      firstName: "Rachel",
      lastName: "Nguyen",
      email: "rachel.nguyen@example.org",
      phone: fakePhone(),
      role: "Team Lead",
      isLeader: true,
      dateOfBirth: dateYearsAgo(34, 10),
      ...fakeUsAddress(),
      ...fakeEmergencyContact("Nguyen"),
      supportRaisingGoal: minorsTrip.supportRaisingGoal,
    },
  });

  // The general code-of-conduct/liability release every trip needs --
  // this trip's own point is demonstrating collectParentGuardianInfo, but
  // that's additive to the standard agreement every participant (minor or
  // not) still signs, never a replacement for it. Previously missing here
  // (flagged from a real screenshot of this trip's own Requirements
  // section showing only the minor-specific form).
  await prisma.tripRequirement.create({
    data: {
      tripId: minorsTrip.id,
      label: "Signed Liability Release and Code of Conduct",
      kind: "esignature",
      bodyText: LIABILITY_RELEASE_TEXT,
    },
  });

  // Picked from tripRequirementLibrary onto this one trip -- same
  // label/kind/bodyText copy shape the real "add from library" admin
  // action uses, not a hand-shaped duplicate of it.
  const minorReleaseRequirement = await prisma.tripRequirement.create({
    data: {
      tripId: minorsTrip.id,
      label: "Minor Travel Release & Consent Form",
      kind: "esignature",
      bodyText: MINOR_RELEASE_TEXT,
    },
  });

  // Signed by the parent, not the minor -- signerRelationship records
  // that honestly. Same real pdfGeneration.js mechanism as every other
  // seeded signature in this file, not a hand-faked row.
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
      signerName: minorApplication.parentGuardianName,
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
        bytes: pdfBytes,
        fileName: "minor-travel-release.pdf",
        contentType: "application/pdf",
        signerName: minorApplication.parentGuardianName,
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

  // A second minors trip, already completed -- the one above is still
  // accepting_applications, so nothing showed what collectParentGuardianInfo
  // looks like after the fact (a finished trip whose team already
  // includes a minor, with her signed release sitting in its normal
  // historical state). Reuses openPartner rather than a fresh lookup --
  // same "a field partner hosts more than one short-term team over time"
  // reasoning minorsTrip's own reuse of closedPartner already established.
  const pastMinorsTripStart = dateBetween(2, 1);
  const pastMinorsTripEnd = new Date(pastMinorsTripStart);
  pastMinorsTripEnd.setDate(pastMinorsTripEnd.getDate() + randInt(6, 9));
  // Same dateYearsAgo fix as minorDob above -- avoids every minor's
  // birthday landing on today's calendar date regardless of age.
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
      collectParentGuardianInfo: true,
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
      parentGuardianName: "Diane Castellano",
      parentGuardianRelationship: "Mother",
      parentGuardianPhone: "555-0234",
      parentGuardianEmail: "diane.castellano@example.org",
      emergencyContactName: "Diane Castellano",
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
      parentGuardianName: pastMinorApplication.parentGuardianName,
      parentGuardianRelationship: pastMinorApplication.parentGuardianRelationship,
      parentGuardianPhone: pastMinorApplication.parentGuardianPhone,
      parentGuardianEmail: pastMinorApplication.parentGuardianEmail,
      emergencyContactName: pastMinorApplication.emergencyContactName,
      emergencyContactPhone: pastMinorApplication.emergencyContactPhone,
      emergencyContactEmail: pastMinorApplication.emergencyContactEmail,
      addressLine1: pastMinorApplication.addressLine1,
      city: pastMinorApplication.city,
      stateProvinceRegion: pastMinorApplication.stateProvinceRegion,
      postalCode: pastMinorApplication.postalCode,
      country: pastMinorApplication.country,
    },
  });

  // Same general code-of-conduct/liability release added to the other
  // minors trip above -- additive to the minor-specific form, not a
  // replacement for it.
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
      signerName: pastMinorApplication.parentGuardianName,
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
        bytes: pdfBytes,
        fileName: "minor-travel-release.pdf",
        contentType: "application/pdf",
        signerName: pastMinorApplication.parentGuardianName,
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

  // Realistic starter content for tripApplicationTemplate/tripQuestionLibrary
  // -- generalized from a real short-term mission trip application a user
  // shared (not copied verbatim; every church's own wording differs, and
  // CONTRIBUTING.md's "keep forks upgradable" rule means this belongs in
  // this demo church's own seed data, not hardcoded into app code).
  // tripApplicationTemplate is the universal layer every trip asks;
  // tripQuestionLibrary is a picker-only set an admin could add to any
  // trip or the template itself, never live on a form by itself.
  // Whether the 5 integration-backed toggles below are safe to force on
  // -- scripts/reset-demo-data.js already established this exact
  // reasoning (its own comment: flipping one of these on with no key
  // behind it "shows a toggle that does nothing ... or errors on click
  // ... worse than just leaving it off"). That script runs first in the
  // real reset flow and upserts these same credential fields before
  // this seed ever runs, so reading them back here (rather than reading
  // env vars directly, which a plain `npm run seed` -- no
  // DEMO_ADMIN_EMAIL/PASSWORD required -- has no reason to know about)
  // picks up whatever's actually configured either way.
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
      // Every optional feature on, demo-only -- utils/features.js's own
      // registry defaults several of these (trips, publicTripDiscovery,
      // outboundEmail, inboundEmail, groupme, whatsapp,
      // publicPrayerDigest, aiExtraction, joshuaProject) to off, which is
      // the right production default but means a demo visitor exploring
      // this app for the first time would find most of its nav hidden
      // behind a toggle nobody told them to flip. Every key here is
      // copied from that registry's own key list, not re-derived --
      // if a new feature is ever added there, it still needs adding
      // here too, since seed.js intentionally doesn't import
      // FEATURE_KEYS (keeping this demo-only literal from quietly
      // reaching into app code it has no other reason to depend on).
      // groupme/outboundEmail/inboundEmail/aiExtraction/joshuaProject are
      // the 5 exceptions -- same conditional-on-a-real-key treatment as
      // reset-demo-data.js, not unconditionally true like the rest.
      enabledFeatures: {
        publicDirectory: true,
        publicMap: true,
        partnerFiles: true,
        prayerRequests: true,
        oneTimeNeeds: true,
        monthlySupport: true,
        trips: true,
        publicTripDiscovery: true,
        booklet: true,
        reports: true,
        outboundEmail: Boolean(integrationSettings?.postmarkServerToken && integrationSettings?.emailFromAddress),
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
      // The one other binary toggle this app ships off by default
      // (ChurchSettings' own schema default) -- left off, the minors
      // trip's own DOB enforcement would never actually get exercised
      // by a demo visitor just clicking around.
      requireDateOfBirth: true,
      // Both default off (schema default) -- left off, a demo visitor
      // would never see a private application link or a participant's
      // public support-raising page generated anywhere, even though
      // this file already seeds the data (shareToken, private links)
      // those two features show off.
      allowPrivateApplicationLinks: true,
      allowPublicSupportRaisingLinks: true,
      // On for the demo specifically (schema default is off) -- a
      // visitor exploring the demo should see the Budget section
      // working, not have to find and flip the toggle first.
      enableTripBudgeting: true,
      // Same "on for the demo" reasoning -- without this, Priya's own
      // seeded donorEmail/donorPhone above would never actually show
      // anywhere, since the UI gates on this setting, not on whether the
      // columns happen to be populated.
      collectDonorContactInfo: true,
      // Church-wide, not per-trip (see Trip.onlineGivingUrl's own schema
      // comment) -- without these, every public Trip Opportunities card's
      // "Donate" button has nothing to point at and never renders at all.
      onlineGivingUrl: "https://give.example.org/missions",
      onlineGivingInstructions:
        "Choose \"Missions Trips\" as the fund, and include the team member's name in the memo/notes field so their support is credited correctly.",
      // tmpl5 ("Date of birth," a free-text "date" question) existed
      // briefly and was dropped once ChurchSettings.collectDateOfBirth
      // shipped a real structured field on the application form itself --
      // same reasoning tmpl4/tmpl1 below were dropped for address/
      // emergency contact. The "date" question type itself stays in
      // utils/applicationQuestions.js -- other date-shaped questions
      // (e.g. "when does your passport expire") still have a real use
      // for it; only this one specific question moved to a first-class
      // column. The former tmpl4 ("Mailing address, one free-text line") was dropped
      // once ChurchSettings.collectApplicantAddress shipped a real
      // structured address block on the application form itself --
      // asking for the same thing twice would be a duplicate, not a
      // second layer of the same precanned-question system this
      // template/library pair exists for. The former tmpl1 ("Emergency
      // contact name and phone, one free-text line") was dropped once
      // ChurchSettings.collectEmergencyContact shipped a real structured
      // name/phone/email block on the application form itself -- same
      // reasoning as tmpl4 (mailing address) being dropped just above.
      tripApplicationTemplate: [
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
        // tmpl6/7/8 promoted from the library (were lib1/2/3) -- the user
        // asked for these three specifically to be live on every
        // application by default for the demo, not just available as an
        // opt-in pick. Moved, not duplicated: a question that's already
        // live in the template has no remaining reason to also sit in the
        // picker-only library (same reasoning that already applies to
        // every other template question -- nothing lives in both lists).
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
      ],
      tripQuestionLibrary: [
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
      ],
      // Church-wide requirement checklist, auto-copied onto every
      // newly-created, actively-recruiting trip (#252 e-signature round)
      // -- see ChurchSettings.tripRequirementTemplate's own schema
      // comment. One entry: the real default a church starts with,
      // generalized from what the user's own church currently asks on
      // its applications, not copied verbatim from any one source.
      tripRequirementTemplate: [
        {
          id: "reqtmpl1",
          label: "Signed Liability Release and Code of Conduct",
          kind: "esignature",
          bodyText: LIABILITY_RELEASE_TEXT,
        },
      ],
      // Picked onto a specific trip's own Requirements section when
      // that trip actually needs it -- never auto-added anywhere, see
      // ChurchSettings.tripRequirementLibrary's own schema comment. The
      // one entry every church running trips that might include minors
      // actually needs out of the box, not something they should have
      // to write from scratch the first time it comes up.
      tripRequirementLibrary: [
        {
          id: "reqlib1",
          label: "Minor Travel Release & Consent Form",
          kind: "esignature",
          bodyText: MINOR_RELEASE_TEXT,
        },
      ],
    },
  });
}

async function seedAdditionalUsers() {
  console.log(`Seeding ${ADDITIONAL_USERS.length} additional admin users...`);
  const bcrypt = require("bcryptjs");
  const passwordHash = await bcrypt.hash("SeedDemoUser2026!", 12);
  for (const u of ADDITIONAL_USERS) {
    const email = `${slugify(u.name)}@example.org`;
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: u.name,
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

// A curated handful of DispatchRecord rows against partners already
// seeded above, covering the states Pending Dispatches should show
// off: an ordinary sendable prayer request, an answered one, a
// restricted partner's prayer request left deliberately unreviewed
// (the "awaiting review" badge -- #218, the one state a fresh reset
// otherwise never demonstrates), an undecided one-time need, a decided
// one, and a newsletter. Reuses the real notify* functions
// (dispatchRecording.js) rather than hand-building DispatchRecord
// payloads here, so a seeded row is byte-identical in shape to what a
// real create would have produced and can't silently drift out of sync
// with the real payload shape. None of this risks an actual send:
// these functions only ever enqueue a row (isUrgent is never set true
// by anything above), and whether a scheduled pass could later pick one
// up depends entirely on ChurchSettings' own schedule fields, which the
// demo reset deliberately leaves unset -- see reset-demo-data.js.
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

async function main() {
  const existingMissionaries = await prisma.partner.count({ where: { kind: "missionary" } });
  const existingOrgs = await prisma.partner.count({ where: { kind: "organization" } });
  if (existingMissionaries > 0 || existingOrgs > 0) {
    console.log(
      `Found ${existingMissionaries} missionaries and ${existingOrgs} organizations already on file — seeding will add more on top of these, not replace them.`
    );
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

    const participantPool = [
      `${pick(FIRST_M)} ${pick(LAST)}`,
      `${pick(FIRST_F)} ${pick(LAST)}`,
      `${pick(FIRST_M)} ${pick(LAST)}`,
      `${pick(FIRST_F)} ${pick(LAST)}`,
      `${pick(FIRST_M)} ${pick(LAST)}`,
      `${pick(FIRST_F)} ${pick(LAST)}`,
    ];

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
      ? [
          chance(0.3)
            ? {
                startDate: dateBetween(0, 0),
                endDate: null,
                notes: "Currently stateside for home assignment.",
              }
            : (() => {
                // End derived from start, not drawn separately. The two were
                // independent before and stayed in order only because every
                // seeded date was the 1st of some month; once days vary, a
                // start and end in the same month invert about half the time.
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
  }

  const finalMissionaries = await prisma.partner.count({ where: { kind: "missionary" } });
  const finalOrgs = await prisma.partner.count({ where: { kind: "organization" } });
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

// seedTripsDemo exported alongside the existing three -- lets Trips demo
// data be reset and reseeded on its own (e.g. after cleaning up duplicate
// rows created by running the full seed repeatedly) without re-running
// the whole missionary/organization seed, which is additive and would
// otherwise just keep growing every time.
module.exports = { buildFakePdf, buildFakeEml, scannableExtras, seedTripsDemo };
