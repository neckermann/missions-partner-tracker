// What to tell an admin when an account exists but its setup link went nowhere. The server answers
// { sent: false } with no manualSetupUrl when email can't send AND the site has no web address to build a
// link from (APP_BASE_URL), and { sent: false, error } when a send was tried and failed. Neither is "sent".

const NO_LINK =
  "email isn't set up on this site, and the site doesn't know its own web address, so there is no setup link to copy either. To let them sign in, open their row, choose Edit and set a password for them. For a link instead, ask whoever set up the site to give it its web address (APP_BASE_URL in the Admin Guide).";

// After pressing "Send setup link" on a user's row.
export function setupLinkNotSentMessage(email) {
  return `Nothing was sent to ${email}: ${NO_LINK}`;
}

// After creating an account whose welcome email didn't go out. `created` is what the action made
// ("was created", "now has guest access"); `retryHint` says where "Send setup link" is.
export function welcomeNotSentMessage(email, welcomeEmail, { created = "was created", retryHint } = {}) {
  if (welcomeEmail?.error) {
    return `${email} ${created}, but the welcome email couldn't be sent (${welcomeEmail.error}). ${retryHint}`;
  }
  return `${email} ${created}, but nothing was sent to them: ${NO_LINK}`;
}
