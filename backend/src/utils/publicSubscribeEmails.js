// #271 Finding: email-content-building belongs in utils/, never inline
// in a route file -- every other notification channel in this app
// already follows this (groupmeChannel.js, whatsappChannel.js,
// adminEmailDispatchContent.js, publicEmailDispatchContent.js); this was
// the one holdout, split out of routes/publicSubscribe.js.
const { sendEmail } = require("./email");
const { buildSubscriberConfirmUrl } = require("./emailDispatchShell");
const { escapeHtml, PRIVACY_LINE } = require("./subscriberPage");

async function sendConfirmEmail(subscriber) {
  const confirmUrl = buildSubscriberConfirmUrl(subscriber.id);
  if (!confirmUrl) return; // APP_BASE_URL not set -- nothing clickable to send
  await sendEmail({
    to: subscriber.email,
    subject: "Confirm your prayer update subscription",
    text: `Click to confirm: ${confirmUrl}\n\n${PRIVACY_LINE}`,
    html: `<p>Click to confirm your subscription:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p style="color:#888;font-size:12px;">${escapeHtml(PRIVACY_LINE)}</p>`,
  });
}

module.exports = { sendConfirmEmail };
