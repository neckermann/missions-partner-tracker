// #291: the daily key-date email -- ONE message per person listing everything
// coming up for the partners they look after (never one per partner), sent
// only on a day something is due. Pure: no I/O, so the wording and the
// masking are unit-testable. Rendered in the same branded shell as the other
// transactional mail (emailTemplate.js).
//
// Masking. This leaves the app, so a restricted partner is named the way every
// other outbound message names one (maskedDisplayName: initials, or the
// field/generic label), and a restricted family's own names are left out
// entirely. A partner marked not safe to contact gets a pointer to the
// special instructions on their page -- never the instructions themselves --
// so a reminder to "send a card" can't read as "call them".

const { renderEmail, blocks } = require("./emailTemplate");
const { maskedDisplayName } = require("./maskData");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function when(item) {
  const d = new Date(`${item.date}T00:00:00Z`);
  const date = `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (item.daysUntil === 0) return `Today · ${date}`;
  if (item.daysUntil === 1) return `Tomorrow · ${date}`;
  return `In ${item.daysUntil} days · ${date}`;
}

function describe(item, settings) {
  const partner = item.partner;
  const name = maskedDisplayName(partner, settings) || "A partner";
  const restricted = !!partner.isRestricted;
  let what;
  if (item.kind === "anniversary") {
    what = `wedding anniversary${item.turning ? ` (${item.turning} years)` : ""}`;
  } else if (item.kind === "supportingSince") {
    what = `${item.turning} ${item.turning === 1 ? "year" : "years"} of our support`;
  } else {
    // Birthdays: a restricted family's own names stay out of the email.
    const who = restricted || !item.who ? "a birthday" : `${item.who}'s birthday`;
    what = item.turning ? `${who} (turning ${item.turning})` : who;
  }
  const care =
    partner.contactLevel && partner.contactLevel !== "normal"
      ? " — special communication instructions apply, see their page"
      : "";
  return `${name}: ${what}${care}`;
}

// items: the open key dates for one person (keyDateQueries.js shape).
function buildKeyDateEmail({ user, items, settings, appUrl }) {
  const count = items.length;
  const church = settings?.churchName ? `${settings.churchName} ` : "";
  return renderEmail({
    settings,
    subject: `${count} key ${count === 1 ? "date" : "dates"} coming up for your ${church}partners`,
    eyebrow: "Key dates",
    greetingName: user.firstName,
    blocks: [
      blocks.paragraph(
        count === 1
          ? "One of the partners you look after has a key date coming up. A card or a call this week is a small thing that tells them they're known."
          : "Some of the partners you look after have key dates coming up. A card or a call this week is a small thing that tells them they're known."
      ),
      blocks.details(items.map((i) => ({ label: when(i), value: describe(i, settings) }))),
      appUrl ? blocks.button(`${appUrl}/admin/partners?assigned=1`, "Open my partners") : null,
      blocks.note(
        "Sent a card or made the call? Log it as a contact with the topic “Key date” and these reminders stop."
      ),
    ],
    footerNote:
      "You get this because you're on these partners' care teams (or the default lead for partners without one).",
  });
}

module.exports = { buildKeyDateEmail, describe, when };
