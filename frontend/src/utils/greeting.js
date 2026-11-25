// A prefilled email draft for a key date (a birthday, an anniversary). The app never sends it:
// this builds a mailto: link a person opens in their own mail program and sends themselves.

const WORDS = {
  Birthday: { subject: "Happy birthday", line: "Wishing you a very happy birthday" },
  Anniversary: { subject: "Happy anniversary", line: "Happy anniversary" },
  "Wedding anniversary": { subject: "Happy anniversary", line: "Happy anniversary" },
  "Adopted by our church": {
    subject: "Thinking of you",
    line: "Today marks another year since we adopted you as one of our partners, and we are grateful for you",
  },
  Commissioned: {
    subject: "Remembering your commissioning",
    line: "Today marks another year since you were commissioned, and we are thankful for your work",
  },
  "Supported since": {
    subject: "Thank you for the partnership",
    line: "Today marks another year of partnering together, and we are thankful for you",
  },
};

// -> { subject, body } for an occasion ("Birthday"), optionally the person ("Dana") and the church.
export function buildGreeting({ occasion, who = "", churchName = "" }) {
  const w = WORDS[occasion] || { subject: "Thinking of you", line: "We are thinking of you today" };
  const name = who ? `${who}, ` : "";
  const from = churchName ? `\n\nWith love from all of us at ${churchName}` : "\n\nWith love from all of us";
  return { subject: w.subject, body: `${name}${w.line}!${from}` };
}

export function greetingHref(to, greeting) {
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(greeting.subject)}&body=${encodeURIComponent(greeting.body)}`;
}
