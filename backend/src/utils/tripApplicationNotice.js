// Tells a trip's team when someone applies. Email only when Email (Sending) is on; without it the application is
// still a badge on the bell ("Trip applications pending review") and a row on the trip's Team page, which is the
// email-off option (utils/emailSenders.js). Best-effort: a failed email must never fail the public submission.
//
// Who: every active admin, and no one else (not editors, viewers or a trip's guest leaders). The email names the
// applicant and links to the review page, and leaves out their contact details, date of birth and answers.
const prisma = require("../prismaClient");
const { sendEmail } = require("./email");
const { isFeatureEnabled } = require("./features");
const { isDemoInstance } = require("./demoMode");
const { renderEmail, blocks } = require("./emailTemplate");
const { appBaseUrl } = require("./tripAccessToken");

async function applicationRecipients() {
  const admins = await prisma.user.findMany({
    where: { active: true, role: "admin" },
    select: { id: true, email: true, firstName: true },
  });
  return admins.filter((u) => u.email);
}

function buildApplicationEmail({ user, trip, applicantName, settings, appUrl }) {
  const tripName = trip.name || "your trip";
  return renderEmail({
    settings,
    subject: `New application for ${tripName}`,
    eyebrow: "Trip application",
    greetingName: user.firstName,
    blocks: [
      blocks.paragraph(
        `${applicantName || "Someone"} has applied to join ${tripName}. It is waiting for review.`
      ),
      appUrl ? blocks.button(`${appUrl}/admin/trips/${trip.id}/team`, "Review the application") : null,
      blocks.note(
        "You get this because you help run trips. Approving or declining it is on the trip's Team page."
      ),
    ],
  });
}

// `send` is injectable so the run is testable without Postmark. Returns how many emails went out.
async function notifyTripTeamOfApplication(tripId, application, { send = sendEmail } = {}) {
  try {
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return 0;
    if (await isDemoInstance()) return 0;
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true, name: true },
    });
    if (!trip) return 0;
    const applicantName = [application.firstName, application.lastName].filter(Boolean).join(" ");
    let sent = 0;
    for (const user of await applicationRecipients()) {
      try {
        const message = buildApplicationEmail({ user, trip, applicantName, settings, appUrl: appBaseUrl() });
        await send({ to: user.email, subject: message.subject, text: message.text, html: message.html });
        sent += 1;
      } catch (err) {
        console.error(`Couldn't send the trip application email to a user (${user.id}):`, err.message);
      }
    }
    return sent;
  } catch (err) {
    console.error("Trip application notification failed:", err);
    return 0;
  }
}

module.exports = { notifyTripTeamOfApplication, applicationRecipients, buildApplicationEmail };
