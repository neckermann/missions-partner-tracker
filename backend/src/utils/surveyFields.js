// The parts of a partner's record a survey question can propose a change to (#419). A question
// linked to one of these keeps the partner's answer as an ordinary answer AND, when it differs
// from what is on file, adds a proposed change that a person approves (or edits, or rejects) on the
// Survey updates page. Nothing is ever applied automatically. Deliberately short: no public
// visibility, restricted status, location, contact level or name. Applying goes through the same
// columns the partner page edits, inside the approver's request, so "last edited by" and the
// audit log credit the person who approved it.
const { CONTACT_METHODS } = require("./contactMethods");

const PHOTO = "photo";
const isEmail = (v) => /^\S+@\S+\.\S+$/.test(v) && v.length <= 200;
const phoneOk = (v) => (v.match(/\d/g) || []).length >= 7 && v.length <= 40;

// A partner's primary contact: an organization's named contact is on the partner itself; a
// family's is the adult marked primary (else the first adult).
function primaryAdult(adults) {
  return adults.find((a) => a.isPrimaryContact) || adults[0] || null;
}

// Each field: label, the question kinds that make sense, how to read what is on file, how to check
// a value, and how to write it. `write` returns { error } or nothing.
const FIELDS = {
  primaryPhone: {
    label: "Primary contact's phone",
    kinds: ["text"],
    read: ({ partner, adults }) =>
      partner.kind === "organization" ? partner.contactPhone : primaryAdult(adults)?.phone1,
    check: (v) => (phoneOk(v) ? null : "That doesn't look like a phone number"),
    write: async (tx, { partner, adults }, v) => {
      if (partner.kind === "organization") {
        await tx.partner.update({ where: { id: partner.id }, data: { contactPhone: v } });
        return;
      }
      const a = primaryAdult(adults);
      if (!a) return { error: "This partner has no adult on file to put the phone number on" };
      await tx.adult.update({ where: { id: a.id }, data: { phone1: v } });
    },
  },
  primaryEmail: {
    label: "Primary contact's email",
    kinds: ["text"],
    read: ({ partner, adults }) =>
      partner.kind === "organization" ? partner.contactEmail : primaryAdult(adults)?.email,
    check: (v) => (isEmail(v) ? null : "That doesn't look like an email address"),
    write: async (tx, { partner, adults }, v) => {
      if (partner.kind === "organization") {
        await tx.partner.update({ where: { id: partner.id }, data: { contactEmail: v } });
        return;
      }
      const a = primaryAdult(adults);
      if (!a) return { error: "This partner has no adult on file to put the email on" };
      await tx.adult.update({ where: { id: a.id }, data: { email: v } });
    },
  },
  contactMethod: {
    label: "How they prefer to be contacted",
    kinds: ["single", "text"],
    read: ({ partner, adults }) =>
      partner.kind === "organization" ? partner.contactMethod : primaryAdult(adults)?.contactMethod,
    check: (v) => (CONTACT_METHODS.includes(v) ? null : `Use one of: ${CONTACT_METHODS.join(", ")}`),
    write: async (tx, { partner, adults }, v) => {
      if (partner.kind === "organization") {
        await tx.partner.update({ where: { id: partner.id }, data: { contactMethod: v } });
        return;
      }
      const a = primaryAdult(adults);
      if (!a) return { error: "This partner has no adult on file" };
      await tx.adult.update({ where: { id: a.id }, data: { contactMethod: v } });
    },
  },
  emergencyContactName: simplePartnerText("Emergency contact's name", "emergencyContactName", 120),
  emergencyContactPhone: {
    ...simplePartnerText("Emergency contact's phone", "emergencyContactPhone", 40),
    check: (v) => (phoneOk(v) ? null : "That doesn't look like a phone number"),
  },
  emergencyContactEmail: {
    ...simplePartnerText("Emergency contact's email", "emergencyContactEmail", 200),
    check: (v) => (isEmail(v) ? null : "That doesn't look like an email address"),
  },
  overviewShort: simplePartnerText("Short overview (one line)", "overviewShort", 300),
  [PHOTO]: { label: "Photo", kinds: ["photo"], photo: true },
};

function simplePartnerText(label, column, max) {
  return {
    label,
    kinds: ["text"],
    read: ({ partner }) => partner[column],
    check: (v) => (v.length <= max ? null : `Keep it to ${max} characters`),
    write: async (tx, { partner }, v) => {
      await tx.partner.update({ where: { id: partner.id }, data: { [column]: v } });
    },
  };
}

// What the builder offers: [{ key, label, kinds }].
function listFields() {
  return Object.entries(FIELDS).map(([key, f]) => ({ key, label: f.label, kinds: f.kinds }));
}

// True if `field` can be linked to a question of this kind.
function fieldFitsKind(field, kind) {
  const f = FIELDS[field];
  return Boolean(f && f.kinds.includes(kind));
}

async function loadContext(db, partnerId) {
  const partner = await db.partner.findUnique({ where: { id: partnerId } });
  if (!partner) return null;
  const adults = await db.adult.findMany({ where: { partnerId }, orderBy: { createdAt: "asc" } });
  return { partner, adults };
}

const clean = (v) => (typeof v === "string" ? v.trim() : "");
const sameValue = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

// The text on file for a field ("" when none).
function currentText(ctx, field) {
  const f = FIELDS[field];
  if (!f || f.photo) return "";
  return clean(f.read(ctx));
}

// Checks and writes an approved value. Returns { error } or { applied }.
async function applyField(tx, ctx, field, raw) {
  const f = FIELDS[field];
  if (!f || f.photo) return { error: "That field can't be updated from a survey" };
  const value = clean(raw);
  if (!value) return { error: "There is nothing to apply" };
  const problem = f.check(value);
  if (problem) return { error: problem };
  const result = await f.write(tx, ctx, value);
  if (result?.error) return { error: result.error };
  return { applied: value };
}

module.exports = {
  PHOTO,
  FIELDS,
  listFields,
  fieldFitsKind,
  loadContext,
  currentText,
  sameValue,
  applyField,
};
