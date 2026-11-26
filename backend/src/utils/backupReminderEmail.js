// A monthly email to each admin that nothing in this app backs up the database, for the admin who rarely signs in
// and so never sees the in-app banner (BackupReminder.jsx, the bell's "Time to check your backups"). Email-off
// option: that banner and bell item stay (utils/emailSenders.js).
//
// Sent when Email (Sending) is on, the church hasn't turned the reminder off for good
// (ChurchSettings.backupReminderDisabled), and it is not a demo. An admin is skipped for 30 days after either an
// email or dismissing the in-app reminder, so the two never nag together.
const cron = require("node-cron");
const prisma = require("../prismaClient");
const { sendEmail } = require("./email");
const { isFeatureEnabled } = require("./features");
const { isDemoInstance } = require("./demoMode");
const { renderEmail, blocks } = require("./emailTemplate");
const { detectProvider } = require("./backupCheck");
const { appBaseUrl } = require("./tripAccessToken");
const { getSeenAt, touchSeen } = require("../notifications/categories");

const EMAIL_CATEGORY = "backupReminderEmail";
const REMIND_AGAIN_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const PROVIDER_MESSAGES = {
  neon: "You're on Neon: confirm your plan includes point-in-time recovery (Neon console, your project, Backup/Restore).",
  supabase:
    "You're on Supabase: confirm your plan's backup retention window covers how much data loss your church would tolerate.",
  rds: "You're on Amazon RDS: confirm automated backups and your retention window are enabled (RDS console, your instance, Maintenance & backups).",
  other:
    "This app doesn't back itself up. Download a safety copy now, or ask whoever hosts it to confirm backups are on.",
};

function buildBackupReminderEmail({ user, settings, provider, appUrl }) {
  return renderEmail({
    settings,
    subject: "Time to check your database backups",
    eyebrow: "Backup reminder",
    greetingName: user.firstName,
    blocks: [
      blocks.paragraph(PROVIDER_MESSAGES[provider] || PROVIDER_MESSAGES.other),
      blocks.paragraph(
        "Want a backup right now, or already covered another way? You can download one, or turn this reminder off for good, on the System Info page."
      ),
      appUrl ? blocks.button(`${appUrl}/admin/settings/system-info`, "Open System Info") : null,
      blocks.note("You get this about once a month because you are an admin."),
    ],
  });
}

// `send` and `now` are injectable so the run is testable without Postmark. Returns the number sent.
async function sendBackupReminderEmails({ send = sendEmail, now = new Date() } = {}) {
  const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  if (settings?.backupReminderDisabled) return 0;
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return 0;
  if (await isDemoInstance()) return 0;

  const admins = await prisma.user.findMany({
    where: { active: true, role: "admin" },
    select: { id: true, email: true, firstName: true },
  });
  let sent = 0;
  for (const user of admins) {
    if (!user.email) continue;
    const recent = (d) => d && now.getTime() - d.getTime() < REMIND_AGAIN_AFTER_MS;
    if (recent(await getSeenAt(user.id, EMAIL_CATEGORY))) continue;
    if (recent(await getSeenAt(user.id, "timeToCheckBackups"))) continue;
    try {
      const message = buildBackupReminderEmail({
        user,
        settings,
        provider: detectProvider(),
        appUrl: appBaseUrl(),
      });
      await send({ to: user.email, subject: message.subject, text: message.text, html: message.html });
      await touchSeen(user.id, EMAIL_CATEGORY);
      sent += 1;
    } catch (err) {
      // One bad address must not stop the rest; no marker is written, so tomorrow retries.
      console.error(`Couldn't send the backup reminder to a user (${user.id}):`, err.message);
    }
  }
  return sent;
}

function startBackupReminderScheduler() {
  // 8:30 church-local, once a day; the 30-day marker makes it about monthly per admin.
  cron.schedule("30 8 * * *", () => sendBackupReminderEmails(), { name: "backup-reminder", noOverlap: true });
}

module.exports = {
  sendBackupReminderEmails,
  startBackupReminderScheduler,
  buildBackupReminderEmail,
  EMAIL_CATEGORY,
  REMIND_AGAIN_AFTER_MS,
};
