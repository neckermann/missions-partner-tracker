// Outbound email via Postmark (see #71) -- a transactional email provider,
// not SMTP against the church's own Gmail/Microsoft mailbox. That path was
// ruled out: Microsoft is turning off SMTP AUTH basic auth for every
// Exchange Online tenant by end of 2026, and direct-from-this-app sending
// isn't viable either (Render's static outbound IPs are a shared, unowned
// /24 range -- useless for SPF/DKIM-grade sending reputation). Postmark's
// HTTP API needs only a single server token, never touches the church's
// own mailbox, and is unaffected by either provider's auth deprecations.
const { ServerClient } = require("postmark");
const prisma = require("../prismaClient");
const { decryptField } = require("./crypto");

// Admin-managed in ChurchSettings -- see that field's own comment in
// schema.prisma. No implicit env-var fallback, same reasoning as
// extraction.js's client(): an old env var left behind on a host can't
// quietly come back into play once the token is meant to be admin-managed.
async function client() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { postmarkServerToken: true, emailFromAddress: true },
  });
  if (!settings?.postmarkServerToken || !settings?.emailFromAddress) {
    const err = new Error(
      "Email isn't configured -- add a Postmark server token and From address under Site Administration → Email"
    );
    err.status = 400;
    throw err;
  }
  return {
    postmark: new ServerClient(decryptField(settings.postmarkServerToken)),
    fromAddress: settings.emailFromAddress,
  };
}

// Unlike groupmeChannel.js's postToGroupMe (which swallows its own failures
// because nothing has ever depended on a GroupMe post actually landing),
// this throws on failure -- no consumer exists yet (see #71's scope), and
// whatever calls this later gets to decide whether a failed send is
// fire-and-log (a report email) or something to surface directly (a
// future password-reset email, where silently failing would be actively
// harmful).
async function sendEmail({ to, subject, text, html }) {
  const { postmark, fromAddress } = await client();
  return postmark.sendEmail({
    From: fromAddress,
    To: to,
    Subject: subject,
    TextBody: text,
    HtmlBody: html,
  });
}

// Sends up to 500 already-fully-built messages in one Postmark API call
// (POST /email/batch) -- a transport optimization only. Each message is
// still independently addressed (its own To/Subject/HtmlBody/TextBody),
// so this never reduces the number of emails sent or billed, and no
// recipient is ever visible to another -- there's no Cc/Bcc involved,
// just fewer HTTP round-trips for the same N sends. Callers chunk to
// <=250 per call themselves (see emailDispatchDelivery.js), well under
// Postmark's 500-message/50MB cap, to leave real headroom. `messages`
// are { To, Subject, HtmlBody, TextBody } objects, matching sendEmail's
// own shape plus the capitalized Postmark field names batch expects
// directly (emailDispatchShell.js's buildEmailDispatchMessage already returns this
// exact shape). Returns one response entry per message, in the same
// order submitted, each with its own ErrorCode -- callers check that
// per-entry rather than relying on the call as a whole succeeding or
// failing, since one bad address must never affect any other message in
// the same batch.
async function sendEmailBatch(messages) {
  const { postmark, fromAddress } = await client();
  return postmark.sendEmailBatch(messages.map((m) => ({ ...m, From: fromAddress })));
}

module.exports = { sendEmail, sendEmailBatch };
