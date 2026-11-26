// Turns what the browser throws while making a passkey into a sentence a person can act on. The browser
// reports the cause by error name; a generic "couldn't add" hid why a phone's fingerprint or face unlock
// would not work.
export function passkeyErrorMessage(err, fallback = "Couldn't add a passkey on this device") {
  const server = err?.response?.data?.error;
  if (server) return server;
  switch (err?.name) {
    case "NotAllowedError":
      return "That was cancelled or timed out. Try again when you're ready.";
    case "InvalidStateError":
      return "This device already has a passkey for this account. Use a different device, or remove the old one first.";
    case "SecurityError":
      return "The browser won't make a passkey for this web address (the site's address and domain setting don't match). Tell whoever runs the site.";
    case "NotSupportedError":
    case "ConstraintError":
    case "UnknownError":
      return "This device or browser couldn't make that kind of passkey. On a phone, check that a screen lock (fingerprint, face or PIN) is set, or try another browser.";
    default:
      return `${fallback}${err?.name ? ` (${err.name})` : ""}.`;
  }
}
