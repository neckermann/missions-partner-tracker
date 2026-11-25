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
    id: "getting-to-know-you",
    title: "Getting to know you",
    description:
      "A fuller partnership survey for restarting a relationship: their story, work, how they stay in touch with us, challenges, highlights, hopes and how we can help.",
    intro:
      "Thank you for partnering with us. We want to know you and your work better, and to make sure we are supporting and praying for you well. Share as much or as little as you like, and save and finish later if you need to.",
    questions: [
      { kind: "text", label: "Best phone number to reach you", field: "primaryPhone" },
      { kind: "text", label: "Best email address to reach you", field: "primaryEmail" },
      {
        kind: "single",
        label: "How can we best communicate with you, and receive updates from you?",
        choices: ["call", "text", "email", "whatsapp", "signal", "messenger"],
        allowOther: false,
        field: "contactMethod",
      },
      { kind: "text", label: "Please share the names and birthdays of your family members" },
      {
        kind: "text",
        label: "A short description of your family, where you serve, and how long you have been in this work",
        required: true,
      },
      {
        kind: "text",
        label: "Who is your sending church or gathering? May we contact them with questions about your work?",
      },
      { kind: "text", label: "Who is your sending agency or organization, if any?" },
      { kind: "text", label: "How and when did you first connect with us?" },
      {
        kind: "text",
        label: "How do you keep us updated on your work? Who here do you hear from or know personally?",
      },
      { kind: "text", label: "Has your work changed since we first partnered together? If so, how?" },
      { kind: "text", label: "How are you doing: spiritually, physically, mentally and relationally?" },
      {
        kind: "text",
        label: "Please summarize your current work, including what a typical week or month looks like",
      },
      { kind: "text", label: "What are two or three challenges you regularly face?" },
      { kind: "text", label: "What are two or three highlights from the last two years?" },
      { kind: "text", label: "Who are the people groups you serve, and in what language?" },
      {
        kind: "text",
        label: "What do local gatherings look like where you serve, and how are you involved?",
      },
      {
        kind: "text",
        label: "What are your one-year and five-year hopes, and what is being done toward them?",
      },
      {
        kind: "multiple",
        label: "Are there ways you would like us to support you?",
        choices: [
          "Prayer",
          "A short-term team visit",
          "A project we could partner on",
          "Help with a specific need",
          "Encouragement and regular contact",
        ],
        allowOther: true,
      },
      { kind: "text", label: "When is your next time home, and could you visit us?" },
      { kind: "photo", label: "A recent photo of you and your family (optional)", field: "photo" },
      { kind: "text", label: "Is there anything else you would like to share with us, or a prayer request?" },
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
