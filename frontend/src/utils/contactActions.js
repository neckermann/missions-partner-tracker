// The tap-to-call/text/email/WhatsApp links on a partner's contact card
// (#288). Pure so the number handling is testable on its own.

// Digits only, keeping nothing else. A number written with a leading "+" is
// already international; a bare 10-digit number is assumed to be a US/Canada
// number (the church's own), which is the only case where adding a country
// code is safe -- anything else is passed through as the digits typed.
export function whatsappDigits(phone) {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (trimmed.startsWith("+")) return digits;
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

// A tel:/sms: target: keep a leading + and digits.
function dialable(phone) {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 7) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

// -> [{ key, label, href }] for whatever this person has on file, in a fixed
// order. Email is checked loosely: anything with an "@" and a dot after it.
export function contactActions({ phone, email } = {}) {
  const actions = [];
  const tel = dialable(phone);
  if (tel) {
    actions.push({ key: "call", label: "Call", href: `tel:${tel}` });
    actions.push({ key: "text", label: "Text", href: `sms:${tel}` });
  }
  const mail = email && /\S+@\S+\.\S+/.test(email) ? email.trim() : null;
  if (mail) actions.push({ key: "email", label: "Email", href: `mailto:${mail}` });
  const wa = whatsappDigits(phone);
  if (wa) actions.push({ key: "whatsapp", label: "WhatsApp", href: `https://wa.me/${wa}` });
  return actions;
}

// Which person the card is about: an organization's named contact, else a
// missionary family's flagged primary adult, else their first adult.
export function primaryContactOf(partner, adults = []) {
  if (partner?.kind === "organization") {
    const name = [partner.contactFirstName, partner.contactLastName].filter(Boolean).join(" ");
    if (!name && !partner.contactPhone && !partner.contactEmail) return null;
    return {
      name,
      phone: partner.contactPhone,
      email: partner.contactEmail,
      isPrimary: true,
      method: partner.contactMethod || null,
      methodNote: partner.contactMethodNote || null,
    };
  }
  const adult = adults.find((a) => a.isPrimaryContact) || adults[0];
  if (!adult) return null;
  return {
    name: [adult.firstName, adult.lastName].filter(Boolean).join(" "),
    phone: adult.phone1 || adult.phone2,
    email: adult.email,
    isPrimary: !!adult.isPrimaryContact,
    adultId: adult.id,
    method: adult.contactMethod || null,
    methodNote: adult.contactMethodNote || null,
  };
}
