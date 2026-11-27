// The daily key-date email: its own cron among the scheduled jobs, like
// tripReminderScheduler.js. One church-local tick a day (the process applies
// ChurchSettings.timezone to TZ); mail goes out ONLY on a day something is due and
// not yet mailed to that person.
//
// Idempotent through KeyDateReminder: one row per (person, partner, kind, subject,
// occurrence date), written after the send, so a re-run never double-mails, next
// year's is a new row, and a failed send leaves no row so tomorrow retries while
// the date is in the window. Needs keyDates + outboundEmail.

const cron = require("./pausableCron");
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { sendEmail } = require("./email");
const { appBaseUrl } = require("./dispatchBlurbs");
const { loadOpenKeyDates } = require("./keyDateQueries");
const { buildKeyDateEmail } = require("./keyDateReminderEmail");
const { isDemoInstance } = require("./demoMode");
const { digestComesBefore } = require("./digestSchedule");
const { churchToday } = require("./today");

const rowKey = (userId, i) => `${userId}|${i.partnerId}|${i.kind}|${i.subjectId}|${i.date}|${i.tier ?? 0}`;

// `send` and `today` are injectable so the run is testable without Postmark.
async function checkAndSendKeyDateReminders({ today = churchToday(), send = sendEmail } = {}) {
  // A public demo never sends these: its team members are fake addresses, so mail
  // would bounce and spend the email plan. The demo reset keeps keyDates off too
  // (utils/demoMode.js); this is the backstop for a visitor enabling it.
  if (await isDemoInstance()) return { sent: 0, recipients: 0 };
  const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  const features = settings?.enabledFeatures;
  if (!isFeatureEnabled(features, "keyDates") || !isFeatureEnabled(features, "outboundEmail")) {
    return { sent: 0, recipients: 0 };
  }

  const open = await loadOpenKeyDates(today);
  if (open.length === 0) return { sent: 0, recipients: 0 };

  const byUser = new Map();
  for (const item of open) {
    for (const userId of item.recipientIds) byUser.set(userId, [...(byUser.get(userId) || []), item]);
  }
  // An opted-out person (My account) keeps the bell but gets no email and no row,
  // so turning it back on lets what is still due go out.
  const users = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] }, active: true, keyDateEmailOptOut: false },
    select: { id: true, email: true, firstName: true, cadence: true },
  });
  const done = await prisma.keyDateReminder.findMany({
    where: {
      userId: { in: users.map((u) => u.id) },
      partnerId: { in: [...new Set(open.map((i) => i.partnerId))] },
    },
    select: { userId: true, partnerId: true, kind: true, subjectId: true, occurrenceDate: true, tier: true },
  });
  const alreadySent = new Set(
    done.map((r) =>
      rowKey(r.userId, {
        partnerId: r.partnerId,
        kind: r.kind,
        subjectId: r.subjectId,
        date: r.occurrenceDate.toISOString().slice(0, 10),
        tier: r.tier,
      })
    )
  );

  let sent = 0;
  for (const user of users) {
    // Someone whose digest goes out on or before the date gets it there instead (one email, not two). The digest
    // lists these final-window dates too (emailDispatchDelivery.js), so nothing is lost.
    const fresh = byUser
      .get(user.id)
      .filter((i) => !alreadySent.has(rowKey(user.id, i)))
      .filter((i) => !digestComesBefore(user.cadence, settings, i.date, today));
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
          tier: 0,
        })),
        skipDuplicates: true,
      });
      sent += 1;
    } catch (err) {
      // One bad address or Postmark blip must not stop the rest; no row is written, so tomorrow retries.
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
