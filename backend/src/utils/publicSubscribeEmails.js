// #271 Finding: email-content-building belongs in utils/, never inline
// in a route file -- every other notification channel in this app
// already follows this (groupmeChannel.js, whatsappChannel.js,
// adminEmailDispatchContent.js, publicEmailDispatchContent.js); this was
// the one holdout, split out of routes/publicSubscribe.js.
const { sendEmail } = require("./email");
const { buildSubscriberConfirmUrl, buildSubscriberConfirmChangeUrl } = require("./emailDispatchShell");
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

// #327 Finding 11 -- a change to an already-confirmed subscriber's
// preferences is proposed, not applied, until this link is clicked (see
// routes/publicSubscribe.js's POST / and GET /confirm). Deliberately a
// different subject/copy than sendConfirmEmail's first-time version, so
// an existing subscriber doesn't read this as "you weren't subscribed
// before" -- they were; this is about a requested *change*.
async function sendConfirmChangeEmail(subscriber, proposed) {
  const confirmUrl = buildSubscriberConfirmChangeUrl(subscriber.id, proposed);
  if (!confirmUrl) return; // APP_BASE_URL not set -- nothing clickable to send
  await sendEmail({
    to: subscriber.email,
    subject: "Confirm this change to your prayer update subscription",
    text: `Someone requested a change to your prayer update subscription. If this was you, click to confirm it: ${confirmUrl}\n\nIf this wasn't you, you can ignore this email -- nothing changes until you click the link.\n\n${PRIVACY_LINE}`,
    html: `<p>Someone requested a change to your prayer update subscription.</p><p>If this was you, click to confirm it:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p>If this wasn't you, you can ignore this email -- nothing changes until you click the link.</p><p style="color:#888;font-size:12px;">${escapeHtml(PRIVACY_LINE)}</p>`,
  });
}

module.exports = { sendConfirmEmail, sendConfirmChangeEmail };
