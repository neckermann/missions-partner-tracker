// Emails saved report views on a cadence (ReportSchedule); runs among the scheduled jobs.
// Rendered for the "shared" audience (restricted partners masked) because an email
// can be forwarded; a report the owner's role can't open is skipped.
const cron = require("node-cron");
const prisma = require("../prismaClient");
const { isDemoInstance } = require("./demoMode");
const { isFeatureEnabled } = require("./features");
const { sendEmail } = require("./email");
const { toCsv, csvFilename } = require("./csv");
const { getReport, runReport } = require("../reporting/registry");
const { isScheduleDue } = require("../reporting/definitions");
const { escapeHtml } = require("./emailDispatchShell");
const { resolveToday } = require("./today");

const MAX_EMAIL_ROWS = 25;
const SEND_HOUR = 7; // church-local, since process.env.TZ is the church's zone

function baseUrl() {
  return (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
}

function cellText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function renderHtml(view, result) {
  const shown = result.rows.slice(0, MAX_EMAIL_ROWS);
  const head = result.columns
    .map(
      (c) =>
        `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc;">${escapeHtml(c.label)}</th>`
    )
    .join("");
  const body = shown
    .map(
      (r) =>
        `<tr>${result.columns.map((c) => `<td style="padding:4px 8px;border-bottom:1px solid #eee;">${escapeHtml(cellText(r[c.key]))}</td>`).join("")}</tr>`
    )
    .join("");
  const tiles = result.summary
    .map((s) => `<li>${escapeHtml(s.label)}: <b>${escapeHtml(cellText(s.value))}</b></li>`)
    .join("");
  const more =
    result.rows.length > shown.length
      ? `<p>Showing ${shown.length} of ${result.rows.length} rows. The full list is attached.</p>`
      : "";
  const link = baseUrl()
    ? `<p><a href="${baseUrl()}/admin/reports/${encodeURIComponent(view.reportId)}">Open this report</a></p>`
    : "";
  return `<h2 style="margin:0 0 8px;">${escapeHtml(view.name)}</h2><ul>${tiles}</ul><table style="border-collapse:collapse;font-size:14px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${more}${link}`;
}

async function sendDueReports(now = new Date()) {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true, restrictedPartnerInitialsEnabled: true },
  });
  if (!isFeatureEnabled(settings?.enabledFeatures, "reports")) return;
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return;
  if (await isDemoInstance()) return;
  const isEnabled = (key) => isFeatureEnabled(settings?.enabledFeatures, key);

  const schedules = await prisma.reportSchedule.findMany({
    where: { active: true },
    include: { savedReport: { include: { owner: { select: { role: true, active: true } } } } },
  });

  for (const schedule of schedules) {
    if (!isScheduleDue(schedule, now)) continue;
    const view = schedule.savedReport;
    try {
      if (!view.owner.active) continue;
      const report = getReport(view.reportId, { role: view.owner.role, isEnabled });
      if (!report) continue;
      const today = resolveToday();
      const result = await runReport(report, view.params, {
        prisma,
        today,
        audience: "shared",
        settings,
      });
      if (schedule.skipIfEmpty && result.rows.length === 0) {
        await prisma.reportSchedule.update({ where: { id: schedule.id }, data: { lastSentAt: now } });
        continue;
      }
      const recipients = await prisma.user.findMany({
        where: { id: { in: schedule.recipientIds }, active: true },
        select: { email: true },
      });
      const csv = toCsv(result.rows, result.columns);
      const message = (to) => ({
        to,
        subject: `${view.name} — ${report.label}`,
        text: `${view.name}\n\n${result.summary.map((s) => `${s.label}: ${cellText(s.value)}`).join("\n")}`,
        html: renderHtml(view, result),
        attachments: [
          {
            Name: csvFilename(report.label, { now: today }),
            Content: Buffer.from(csv, "utf8").toString("base64"),
            ContentType: "text/csv",
          },
        ],
      });
      // Each recipient is sent on their own, and tried twice, so one bad address (or one hiccup) neither stops the
      // others nor makes the next day's retry send the report again to the people who already have it.
      let delivered = 0;
      for (const r of recipients) {
        let ok = false;
        let lastError;
        for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
          try {
            await sendEmail(message(r.email));
            ok = true;
          } catch (err) {
            lastError = err;
          }
        }
        if (ok) delivered += 1;
        else
          console.error(`Scheduled report ${schedule.id}: couldn't send to a recipient:`, lastError?.message);
      }
      // Nobody got it: leave it due so the next send hour tries again. If anyone did, it is marked sent: a
      // recipient it failed for misses this one (marking per recipient would need a schema change), but nobody
      // gets it twice.
      if (recipients.length > 0 && delivered === 0) {
        console.error(
          `Scheduled report ${schedule.id}: every send failed, will retry at the next send hour.`
        );
        continue;
      }
      await prisma.reportSchedule.update({ where: { id: schedule.id }, data: { lastSentAt: now } });
    } catch (err) {
      // One bad schedule must not stop the rest; it stays due and retries next tick.
      console.error(`Scheduled report ${schedule.id} failed:`, err.message);
    }
  }
}

function startReportScheduler() {
  // Hourly tick, acting only in the church-local send hour, so a deploy or
  // restart never fires everything at once.
  cron.schedule(
    "0 * * * *",
    () => {
      if (new Date().getHours() === SEND_HOUR) return sendDueReports();
      return undefined;
    },
    { name: "report-emails", noOverlap: true }
  );
}

module.exports = { startReportScheduler, sendDueReports, renderHtml };
