// The daily key-date email (#291) -- its own independent cron registration in
// the worker, same shape as tripReminderScheduler.js. One tick a day (church-
// local, the worker applies ChurchSettings.timezone to TZ), and the email goes
// out ONLY on a day something is due and not yet mailed to that person.
//
// Idempotent through KeyDateReminder: one row per (person, partner, kind,
// subject, occurrence date), written after the send, so a re-run (a restart, a
// second tick) never mails the same occurrence twice, next year's is a new
// row, and a failed send leaves no row so tomorrow's tick retries while the
// date is still inside the window. Needs keyDates + careTeam + outboundEmail.

const cron = require("node-cron");
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { sendEmail } = require("./email");
const { appBaseUrl } = require("./dispatchBlurbs");
const { loadOpenKeyDates } = require("./keyDateQueries");
const { buildKeyDateEmail } = require("./keyDateReminderEmail");
const { isDemoDeployment } = require("./demoMode");

const rowKey = (userId, i) => `${userId}|${i.partnerId}|${i.kind}|${i.subjectId}|${i.date}`;

// `send` and `today` are injectable so the run is testable without Postmark.
async function checkAndSendKeyDateReminders({ today = new Date(), send = sendEmail } = {}) {
  // A public demo never sends these: its team members are fake seeded
  // addresses, so the mail would only bounce and spend the email plan. The
  // reset keeps the keyDates flag off there too (utils/demoMode.js); this is
  // the backstop for a visitor with the published admin login switching it on.
  if (isDemoDeployment()) return { sent: 0, recipients: 0 };
  const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  const features = settings?.enabledFeatures;
  if (
    !isFeatureEnabled(features, "keyDates") ||
    !isFeatureEnabled(features, "careTeam") ||
    !isFeatureEnabled(features, "outboundEmail")
  ) {
    return { sent: 0, recipients: 0 };
  }

  const open = await loadOpenKeyDates(today);
  if (open.length === 0) return { sent: 0, recipients: 0 };

  const byUser = new Map();
  for (const item of open) {
    for (const userId of item.recipientIds) byUser.set(userId, [...(byUser.get(userId) || []), item]);
  }
  // Someone who has opted out of the daily email (My account) keeps the bell alert but gets no
  // email, and nothing is recorded for them, so turning it back on lets what is still due go out.
  const users = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] }, active: true, keyDateEmailOptOut: false },
    select: { id: true, email: true, firstName: true },
  });
  const done = await prisma.keyDateReminder.findMany({
    where: {
      userId: { in: users.map((u) => u.id) },
      partnerId: { in: [...new Set(open.map((i) => i.partnerId))] },
    },
    select: { userId: true, partnerId: true, kind: true, subjectId: true, occurrenceDate: true },
  });
  const alreadySent = new Set(
    done.map((r) =>
      rowKey(r.userId, {
        partnerId: r.partnerId,
        kind: r.kind,
        subjectId: r.subjectId,
        date: r.occurrenceDate.toISOString().slice(0, 10),
      })
    )
  );

  let sent = 0;
  for (const user of users) {
    const fresh = byUser.get(user.id).filter((i) => !alreadySent.has(rowKey(user.id, i)));
    if (fresh.length === 0) continue;
    try {
      const message = buildKeyDateEmail({ user, items: fresh, settings, appUrl: appBaseUrl() });
      await send({ to: user.email, subject: message.subject, text: message.text, html: message.html });
      await prisma.keyDateReminder.createMany({
        data: fresh.map((i) => ({
          userId: user.id,
          partnerId: i.partnerId,
          kind: i.kind,
          subjectId: i.subjectId,
          occurrenceDate: new Date(`${i.date}T00:00:00Z`),
        })),
        skipDuplicates: true,
      });
      sent += 1;
    } catch (err) {
      // One person's bad address or a Postmark blip must not stop the rest;
      // no row was written, so tomorrow's tick tries again.
      console.error(`Couldn't send the key-date email to a user (${user.id}):`, err.message);
    }
  }
  return { sent, recipients: users.length };
}

function startKeyDateReminderScheduler() {
  // 7:00 church-local, once a day.
  cron.schedule("0 7 * * *", () => checkAndSendKeyDateReminders(), {
    name: "key-date-reminders",
    noOverlap: true,
  });
}

module.exports = { startKeyDateReminderScheduler, checkAndSendKeyDateReminders };
