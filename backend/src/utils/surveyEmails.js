// The email that carries a partner's personal survey link. Rendered in the branded shell.
const { renderEmail, blocks } = require("./emailTemplate");

// Pure.
function buildSurveyEmail({ partnerName, survey, url, expiresAt, settings, reminder = false }) {
  const church = settings?.churchName || "your church";
  return renderEmail({
    settings,
    subject: `${reminder ? "Reminder: " : ""}${survey.title}`,
    eyebrow: "A few questions",
    greetingName: partnerName,
    blocks: [
      blocks.paragraph(
        survey.intro ||
          `${church} would love your help with a few short questions. It takes only a few minutes.`
      ),
      blocks.button(url, "Answer the questions"),
      blocks.note(
        `This link is just for you. You can save and finish later. It works until ${expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} or until the survey closes.`
      ),
    ],
    footerNote: "Didn't expect this? You can safely ignore it. Nothing happens unless you answer.",
  });
}

module.exports = { buildSurveyEmail };
