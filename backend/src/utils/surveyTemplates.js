// Starting points for a new survey (#419). A church picks one under Settings → Surveys →
// + New survey and then edits it freely; each becomes ordinary Survey and SurveyQuestion rows, so
// nothing here is a church's own list (the fork-upgradability rule) and nothing stays linked to
// this file (a question's `field` links it to part of the partner's record for staff to approve; see
// surveyFields.js). Wording is neutral ("we"), with no church name.

const TEMPLATES = [
  {
    id: "care-check-in",
    title: "Care check-in",
    description: "A gentle, regular check-in: how they are, what to pray for, and how we can help.",
    intro:
      "We think of you often and would love to hear how you are doing. These few questions help us pray for you and support you well.",
    questions: [
      {
        kind: "single",
        label: "How are you doing overall?",
        choices: ["Doing well", "Managing", "Struggling", "Need help soon"],
        required: true,
      },
      { kind: "text", label: "What is going on in your life and ministry right now?" },
      { kind: "text", label: "What can we pray for this month?" },
      {
        kind: "multiple",
        label: "How can we help right now?",
        choices: [
          "Prayer",
          "A call or video chat",
          "A visit from a team",
          "A care package",
          "Help with a project or a need",
        ],
        allowOther: true,
      },
      { kind: "yesno", label: "Is there anything urgent we should know about?" },
    ],
  },
  {
    id: "annual-update",
    title: "Annual update",
    description:
      "Ask partners to confirm their contact details and share an update. Answers can be reviewed and applied to their record.",
    intro:
      "Once a year we like to make sure we have your details right and hear what has changed. Please leave anything blank that is still correct.",
    questions: [
      { kind: "text", label: "Best phone number to reach you", field: "primaryPhone" },
      { kind: "text", label: "Best email address to reach you", field: "primaryEmail" },
      {
        kind: "single",
        label: "How do you prefer to be contacted?",
        choices: ["call", "text", "email", "whatsapp", "signal", "messenger"],
        allowOther: false,
        field: "contactMethod",
      },
      { kind: "text", label: "Emergency contact: name", field: "emergencyContactName" },
      { kind: "text", label: "Emergency contact: phone", field: "emergencyContactPhone" },
      { kind: "text", label: "Emergency contact: email", field: "emergencyContactEmail" },
      { kind: "photo", label: "A recent photo of you and your family (optional)", field: "photo" },
      { kind: "text", label: "A short update on your work for the people who pray for you" },
      { kind: "text", label: "Anything else that has changed (family, location, plans)?" },
    ],
  },
  {
    id: "furlough-planning",
    title: "Furlough and visit planning",
    description:
      "Plan a time home: when, where they will stay, and how they would like to connect with the church.",
    intro: "We would love to plan well for your time with us. Tell us what you can, and we will follow up.",
    questions: [
      { kind: "yesno", label: "Are you planning to be home in the next twelve months?", required: true },
      { kind: "text", label: "Roughly when, and for how long?" },
      { kind: "text", label: "Where will you be staying?" },
      {
        kind: "multiple",
        label: "Would you like to…",
        choices: [
          "Speak at a church gathering",
          "Host a prayer or information evening",
          "Meet with the care team",
          "Have quiet time to rest",
        ],
        allowOther: true,
      },
      { kind: "text", label: "Is there anything we should prepare or arrange ahead of time?" },
    ],
  },
];

const byId = (id) => TEMPLATES.find((t) => t.id === id) || null;

// What the picker needs.
function listTemplates() {
  return TEMPLATES.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    questionCount: t.questions.length,
  }));
}

module.exports = { TEMPLATES, byId, listTemplates };
