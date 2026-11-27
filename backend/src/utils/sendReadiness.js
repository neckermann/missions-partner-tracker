// "This channel is switched on" is not "this channel can send". Each check here answers the second question
// for one channel, from ChurchSettings alone, so an admin can be told before a week of updates quietly goes
// nowhere. Pure functions (no I/O): the notification registry (notifications/categories.js) reads the settings
// once and asks each. Email's own "no mail account yet" check is utils/emailReady.js.
const { isFeatureEnabled } = require("./features");
const { READY_SELECT, isOutboundEmailReady } = require("./emailReady");

const SEND_READINESS_SELECT = {
  ...READY_SELECT,
  updatedAt: true,
  emailDispatchDayOfWeek: true,
  emailDispatchDayOfMonth: true,
  emailDispatchHour: true,
  cadenceBiweeklyEnabled: true,
  cadenceMonthlyEnabled: true,
  cadenceQuarterlyEnabled: true,
  chatDispatchHour: true,
  groupmeAccessToken: true,
  groupmeGroupId: true,
  whatsappPairedAt: true,
  whatsappAnnouncementGroupId: true,
  whatsappPrayerGroupId: true,
  whatsappOneTimeNeedGroupId: true,
  whatsappNewsletterGroupId: true,
  whatsappCareGroupId: true,
};

const on = (settings, feature) => isFeatureEnabled(settings?.enabledFeatures, feature);

// Email can send, but the digest schedule can't fire (utils/emailDispatchScheduler.js needs a day AND a time
// for each rhythm). null when the schedule is complete, when email itself isn't ready (that has its own
// notice) or when no rhythm is offered; otherwise:
//   "none": no day and no time at all;
//   "half": something is set, but a rhythm that is offered has no day, or there is a day with no time.
function emailScheduleProblem(settings) {
  if (!isOutboundEmailReady(settings)) return null;
  const weekly = Boolean(settings.cadenceBiweeklyEnabled);
  const monthly = Boolean(settings.cadenceMonthlyEnabled || settings.cadenceQuarterlyEnabled);
  if (!weekly && !monthly) return null;
  const hasHour = settings.emailDispatchHour != null;
  const hasWeekday = settings.emailDispatchDayOfWeek != null;
  const hasMonthDay = settings.emailDispatchDayOfMonth != null;
  const complete = hasHour && (!weekly || hasWeekday) && (!monthly || hasMonthDay);
  if (complete) return null;
  return !hasHour && !hasWeekday && !hasMonthDay ? "none" : "half";
}

// GroupMe is on but there is no access token, or no group to post in (utils/groupmeChannel.js posts nothing).
function isGroupMeUnfinished(settings) {
  return on(settings, "groupme") && !(settings?.groupmeAccessToken && settings?.groupmeGroupId);
}

// WhatsApp is on but no phone has been linked, or it has no group to post in (utils/whatsappChannel.js). A
// linked number that has dropped its connection is a different notice (whatsappConnectionDrop).
function isWhatsAppUnfinished(settings) {
  if (!on(settings, "whatsapp")) return false;
  const hasGroup = Boolean(
    settings?.whatsappAnnouncementGroupId ||
    settings?.whatsappPrayerGroupId ||
    settings?.whatsappOneTimeNeedGroupId ||
    settings?.whatsappNewsletterGroupId ||
    settings?.whatsappCareGroupId
  );
  return !settings?.whatsappPairedAt || !hasGroup;
}

// A chat service is on but the one daily posting time is not set, so neither posts (utils/chatSchedule.js).
function isChatTimeMissing(settings) {
  return (on(settings, "groupme") || on(settings, "whatsapp")) && settings?.chatDispatchHour == null;
}

module.exports = {
  SEND_READINESS_SELECT,
  emailScheduleProblem,
  isGroupMeUnfinished,
  isWhatsAppUnfinished,
  isChatTimeMissing,
};
