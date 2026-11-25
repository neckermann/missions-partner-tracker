// Outbound email via Postmark (a transactional provider), not SMTP against the
// church's own mailbox: Microsoft is disabling SMTP AUTH basic auth for Exchange
// Online by end of 2026, and sending directly from this app isn't viable (Render's
// outbound IPs are a shared range, useless for SPF/DKIM reputation). Postmark's
// HTTP API needs only a server token.
const { ServerClient } = require("postmark");
const prisma = require("../prismaClient");
const { decryptField } = require("./crypto");

// Admin-managed in ChurchSettings. No env-var fallback (as extraction.js's
// client()), so a stale env var can't come back into play.
async function client() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { postmarkServerToken: true, emailFromAddress: true },
  });
  if (!settings?.postmarkServerToken || !settings?.emailFromAddress) {
    const err = new Error(
      "Email isn't configured -- add a Postmark server token and From address under Settings → Email"
    );
    err.status = 400;
    throw err;
  }
  return {
    postmark: new ServerClient(decryptField(settings.postmarkServerToken)),
    fromAddress: settings.emailFromAddress,
  };
}

// Unlike groupmeChannel.js's postToGroupMe, this throws on failure; the caller
// decides whether a failed send is fire-and-log (a report) or surfaced (a
// password reset).
// attachments: [{ Name, Content (base64), ContentType }], Postmark's own shape,
// passed straight through (used by the trip .ics sends).
//
// No replyTo param: every send replies to the From address.
async function sendEmail({ to, subject, text, html, attachments }) {
  const { postmark, fromAddress } = await client();
  return postmark.sendEmail({
    From: fromAddress,
    To: to,
    Subject: subject,
    TextBody: text,
    HtmlBody: html,
    Attachments: attachments || undefined,
  });
}

// Sends up to 500 fully-built messages in one Postmark call (POST /email/batch):
// a transport optimization only. Each message is still independently addressed
// (no Cc/Bcc, no recipient visible to another) and billed. Callers chunk to <=250
// (see emailDispatchDelivery.js) for headroom under Postmark's 500-message/50MB
// cap. `messages` are { To, Subject, HtmlBody, TextBody } (the shape
// buildEmailDispatchMessage returns). Returns one entry per message in submission
// order, each with its own ErrorCode; callers check per entry since one bad
// address must not affect the batch.
async function sendEmailBatch(messages) {
  const { postmark, fromAddress } = await client();
  return postmark.sendEmailBatch(messages.map((m) => ({ ...m, From: fromAddress })));
}

module.exports = { sendEmail, sendEmailBatch };
