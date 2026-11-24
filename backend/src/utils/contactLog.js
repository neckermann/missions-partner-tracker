// #288: the contact log's fixed vocabularies and the few pure rules around
// them. Fixed lists in code, stored as plain validated Strings (SPEC §3: no
// native enums, a fork can add a value without a migration) -- deliberately
// not a ChurchSettings list. The API serves them (GET /api/contact-log/
// options) so the frontend never keeps its own copy to drift.

const CONTACT_TYPES = [
  { value: "call", label: "Phone call" },
  { value: "text", label: "Text / message" },
  { value: "email", label: "Email" },
  { value: "visit", label: "Visit" },
  { value: "card", label: "Card / letter / gift" },
  { value: "video", label: "Video call" },
  { value: "prayed", label: "Prayed for them" },
  { value: "other", label: "Other" },
];

const DIRECTIONS = [
  { value: "outbound", label: "We reached out" },
  { value: "inbound", label: "They reached out" },
];

const TOPICS = [
  { value: "checkin", label: "Check-in" },
  { value: "prayer", label: "Prayer" },
  { value: "need", label: "Need / support" },
  { value: "encouragement", label: "Encouragement" },
  { value: "update", label: "Ministry update" },
  { value: "trip", label: "Trip" },
  { value: "furlough", label: "Furlough / visit" },
  // #291: logging a card/call for an upcoming birthday or anniversary with
  // this topic is what clears that key-date reminder.
  { value: "keydate", label: "Key date" },
];

const values = (list) => list.map((x) => x.value);

// A partner nobody has been in touch with for this long is "quiet". One
// number for the report's default, the "My partners" tab and the
// notification, so they can't disagree about who is overdue.
const CONTACT_STALE_DAYS = 90;

// The log entry a care team member's new prayer request makes for them:
// hearing a request from the partner is a contact, and typing it in shouldn't
// mean typing it twice. Marked with the request's id so the link can be shown.
function autoLogForPrayerRequest(request, userId, { answered = false } = {}) {
  return {
    partnerId: request.partnerId,
    contactType: "other",
    direction: "inbound",
    topics: ["prayer"],
    contactedById: userId || null,
    createdById: userId || null,
    contactDate: (answered ? request.dateAnswered : request.dateReceived) || new Date(),
    notes: answered ? "Prayer request answered." : "Prayer request received.",
    prayerRequestId: request.id,
  };
}

module.exports = {
  CONTACT_TYPES,
  DIRECTIONS,
  TOPICS,
  CONTACT_TYPE_VALUES: values(CONTACT_TYPES),
  DIRECTION_VALUES: values(DIRECTIONS),
  TOPIC_VALUES: values(TOPICS),
  CONTACT_STALE_DAYS,
  autoLogForPrayerRequest,
};
