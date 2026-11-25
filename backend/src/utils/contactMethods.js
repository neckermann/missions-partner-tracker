// The ways a person can like to be reached, and how careful to be with a partner. Stored as plain
// strings; this list is the one place the allowed values live (the Contact card shows the labels).
const CONTACT_METHODS = ["call", "text", "email", "whatsapp", "signal", "messenger", "other"];
const CONTACT_LEVELS = ["normal", "caution", "no_direct"];

module.exports = { CONTACT_METHODS, CONTACT_LEVELS };
