// The daily key-date email: ONE message per person listing everything coming up
// for the partners they look after, sent only on a day something is due. Pure
// (no I/O) so wording and masking are unit-testable; uses the branded
// transactional shell (emailTemplate.js).
//
// Masking: this leaves the app, so a restricted partner is named as elsewhere
// outbound (maskedDisplayName) and a restricted family's own names are left out.
// A partner marked not safe to contact gets a pointer to the special instructions
// on their page, never the instructions themselves, so "send a card" can't read as "call them".

const { renderEmail, blocks } = require("./emailTemplate");
const { maskedDisplayName } = require("./maskData");
const { keyDateWhat, when } = require("./keyDateText");

function describe(item, settings) {
  const partner = item.partner;
  const name = maskedDisplayName(partner, settings) || "A partner";
  const what = keyDateWhat(item, !!partner.isRestricted);
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
      "You get this because you look after these partners (on their care team, or on the team that looks after partners without one).",
  });
}

module.exports = { buildKeyDateEmail, describe, when, keyDateWhat };
