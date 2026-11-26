// Every file that sends email, and what the app does when Email (Sending) is off. The rule (CONTRIBUTING.md
// § Email paths need an email-off option): a path that would send an email must still let the person do what
// it was for, by one of these, never by silently doing nothing:
//
//   handOver  the content (a link or text) is shown to copy and pass on
//   inApp     it still appears somewhere in the app the person already looks at
//   download  a file or printable view covers it
//   disabled  the control is disabled or the route refused, and the reason says what to turn on
//   setup     it only exists while email is being set up (an admin tool), so "off" can't happen
//
// test/emailSenders.test.js fails when a file that requires ./email is missing here, so adding an email
// forces you to say what happens without it.

const WHEN_OFF = ["handOver", "inApp", "download", "disabled", "setup"];

const EMAIL_SENDERS = {
  "routes/settingsEmail.js": {
    whenOff: "setup",
    note: "The test email only exists on the Email settings page, where email is being set up.",
  },
  "routes/surveys.js": {
    whenOff: "handOver",
    note: "Sending a survey returns each partner's personal link to copy (Get link).",
  },
  "utils/emailDispatchDelivery.js": {
    whenOff: "handOver",
    note: "Queued updates stay on Pending Dispatches, which offers Copy the updates that are ready.",
  },
  "utils/keyDateReminderScheduler.js": {
    whenOff: "handOver",
    note: "My partners shows what the email would have said, with Copy this week's list.",
  },
  "utils/passwordless.js": {
    whenOff: "disabled",
    note: "Passwordless sign-in can't be turned on without working email; the switch says why.",
  },
  "utils/publicSubscribeEmails.js": {
    whenOff: "disabled",
    note: "Public prayer-digest sign-up needs email, so it is refused and the form hidden while email is off.",
  },
  "utils/reportScheduler.js": {
    whenOff: "download",
    note: "A scheduled report email can still be run and downloaded from Reports.",
  },
  "utils/tripAccessToken.js": {
    whenOff: "handOver",
    note: "A participant's lost-link request is refused; an admin copies their link from the participant page.",
  },
  "utils/tripEmails.js": {
    whenOff: "handOver",
    note: "Trip invites, access links, meeting and requirement emails return the links and wording to copy.",
  },
  "utils/welcomeEmails.js": {
    whenOff: "handOver",
    note: "A new user's setup link (and a reset link) is shown to the admin to hand over.",
  },
};

module.exports = { EMAIL_SENDERS, WHEN_OFF };
