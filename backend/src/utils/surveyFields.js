// The parts of a partner's record a survey question can propose a change to (#419). A question
// linked to one of these keeps the partner's answer as an ordinary answer AND, when it differs
// from what is on file, adds a proposed change that a person approves (or edits, or rejects) on the
// Survey updates page. Nothing is ever applied automatically. Deliberately short: no public
// visibility, restricted status, location, contact level or name. Applying goes through the same
// columns the partner page edits, inside the approver's request, so "last edited by" and the
// audit log credit the person who approved it.
const { CONTACT_METHODS } = require("./contactMethods");
const { normalizePhone, normalizeEmail } = require("./contactFormat");

const { applySupportAnswer } = require("./surveySupport");

const PHOTO = "photo";

// The words a person reads for each way of being reached; the stored value is the key.
const CONTACT_METHOD_LABELS = {
  call: "Phone call",
  text: "Text message",
  email: "Email",
  whatsapp: "WhatsApp",
  signal: "Signal",
  messenger: "Messenger",
  other: "Other",
};

// A contact method from what a person wrote or picked: the stored value, or its readable label.
function normalizeContactMethod(raw) {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!v) return { value: null };
  if (CONTACT_METHODS.includes(v)) return { value: v };
  const byLabel = CONTACT_METHODS.find((m) => CONTACT_METHOD_LABELS[m].toLowerCase() === v);
  if (byLabel) return { value: byLabel };
  return { error: `Choose one of: ${CONTACT_METHODS.map((m) => CONTACT_METHOD_LABELS[m]).join(", ")}` };
}

// A partner's primary contact: an organization's named contact is on the partner itself; a
// family's is the adult marked primary (else the first adult).
function primaryAdult(adults) {
  return adults.find((a) => a.isPrimaryContact) || adults[0] || null;
}

// Each field: label, the question kinds that make sense, which input the page shows (`inputType`),
// how to read what is on file, how to normalise a value (`normalize` returns { value } to save or
// { error } in plain words, the same rules every other form uses), and how to write it. `write`
// returns { error } or nothing.
const FIELDS = {
  primaryPhone: {
    label: "Primary contact's phone",
    kinds: ["text"],
    inputType: "tel",
    read: ({ partner, adults }) =>
      partner.kind === "organization" ? partner.contactPhone : primaryAdult(adults)?.phone1,
    normalize: normalizePhone,
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
    inputType: "email",
    read: ({ partner, adults }) =>
      partner.kind === "organization" ? partner.contactEmail : primaryAdult(adults)?.email,
    normalize: normalizeEmail,
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
    inputType: "contactMethod",
    read: ({ partner, adults }) =>
      partner.kind === "organization" ? partner.contactMethod : primaryAdult(adults)?.contactMethod,
    normalize: normalizeContactMethod,
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
    inputType: "tel",
    normalize: normalizePhone,
  },
  emergencyContactEmail: {
    ...simplePartnerText("Emergency contact's email", "emergencyContactEmail", 200),
    inputType: "email",
    normalize: normalizeEmail,
  },
  overviewShort: simplePartnerText("Short overview (one line)", "overviewShort", 300),
  mailingAddress: {
    label: "Mailing address",
    kinds: ["address"],
    inputType: "address",
    read: ({ addresses }) => addressToValue((addresses || []).find((a) => a.type === "mailing")),
    normalize: (v) => {
      const a = normalizeAddress(v);
      if (a.error) return { error: a.error };
      if (!a.value) return { value: null };
      if (!JSON.parse(a.value).line1) return { error: "Add a street address" };
      return { value: a.value };
    },
    write: async (tx, { partner }, v) => {
      const a = JSON.parse(v);
      const data = {
        addressLine1: a.line1 || null,
        addressLine2: a.line2 || null,
        city: a.city || null,
        stateProvinceRegion: a.region || null,
        postalCode: a.postal || null,
        country: a.country || null,
      };
      await tx.address.upsert({
        where: { partnerId_type: { partnerId: partner.id, type: "mailing" } },
        create: { partnerId: partner.id, type: "mailing", ...data },
        update: data,
      });
    },
  },
  [PHOTO]: { label: "Photo", kinds: ["photo"], photo: true },
  supportPreferences: { label: "Support preferences", kinds: ["support"], support: true },
};

// A mailing address as one canonical line of JSON: the parts the partner gave, trimmed and in a
// fixed order, blanks left out. Canonical so two spellings of the same answer compare equal.
const ADDRESS_PARTS = ["line1", "line2", "city", "region", "postal", "country"];
function normalizeAddress(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { value: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That address isn't in a form we can read" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "That address isn't in a form we can read" };
  }
  const out = {};
  for (const key of ADDRESS_PARTS) {
    const part = typeof parsed[key] === "string" ? parsed[key].trim() : "";
    if (part.length > 200) return { error: "An address line is too long" };
    if (part) out[key] = part;
  }
  return Object.keys(out).length ? { value: JSON.stringify(out) } : { value: null };
}

// The mailing address on file in the same canonical form ("" when none).
function addressToValue(a) {
  if (!a) return "";
  return (
    normalizeAddress(
      JSON.stringify({
        line1: a.addressLine1,
        line2: a.addressLine2,
        city: a.city,
        region: a.stateProvinceRegion,
        postal: a.postalCode,
        country: a.country,
      })
    ).value || ""
  );
}

function simplePartnerText(label, column, max) {
  return {
    label,
    kinds: ["text"],
    inputType: "line",
    maxLength: max,
    read: ({ partner }) => partner[column],
    normalize: (v) => {
      const t = typeof v === "string" ? v.trim() : "";
      return t.length <= max ? { value: t || null } : { error: `Keep it to ${max} characters` };
    },
    write: async (tx, { partner }, v) => {
      await tx.partner.update({ where: { id: partner.id }, data: { [column]: v } });
    },
  };
}

// What the builder offers: [{ key, label, kinds }].
function listFields() {
  return Object.entries(FIELDS).map(([key, f]) => ({ key, label: f.label, kinds: f.kinds }));
}

// How a question linked to `field` is shown to the person answering: which input to use, and for
// a contact method the one fixed list of choices (whatever an author typed is ignored, so the
// answer can always be saved). `choices` and `labels` are only set when the list is fixed.
function presentation(field) {
  const f = FIELDS[field];
  if (!f || !f.inputType) return {};
  const out = { inputType: f.inputType };
  if (f.maxLength) out.maxLength = f.maxLength;
  if (f.inputType === "contactMethod") {
    out.choices = [...CONTACT_METHODS];
    out.labels = CONTACT_METHOD_LABELS;
    out.allowOther = false;
  }
  return out;
}

// The question as the page and the answer check see it: stored choices replaced by the fixed list
// where the field has one.
function presentQuestion(q) {
  const p = presentation(q.field);
  return {
    ...q,
    ...(p.choices ? { choices: p.choices, allowOther: false } : {}),
  };
}

// The question as the page draws it: its own columns plus which input to show (`inputType`:
// "tel", "email", "line", "contactMethod" or null for the ordinary box), a length limit, and for a
// contact method the fixed choices with the words to show beside each.
function pageQuestion(q) {
  const p = presentation(q.field);
  return {
    ...q,
    choices: p.choices || q.choices,
    allowOther: p.choices ? false : q.allowOther,
    inputType: p.inputType || null,
    maxLength: p.maxLength || null,
    labels: p.labels || null,
  };
}

// The problem with a typed answer for the field a question is linked to, in plain words, or null.
// Blank is never a problem here (required questions are checked separately).
function problemWithAnswer(field, raw) {
  const f = FIELDS[field];
  if (!f || !f.normalize || f.photo || f.support) return null;
  return f.normalize(raw).error || null;
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
  const addresses = await db.address.findMany({ where: { partnerId } });
  return { partner, adults, addresses };
}

const clean = (v) => (typeof v === "string" ? v.trim() : "");
// Two values are the same when they normalise to the same thing for this field, so "(506) 555-0259"
// on file and "506 555 0259" in an answer are one number. Without a field, plain case-blind text.
function sameValue(a, b, field) {
  const f = field && FIELDS[field];
  if (f && f.normalize) {
    const x = f.normalize(clean(a));
    const y = f.normalize(clean(b));
    if (!x.error && !y.error) return (x.value || "") === (y.value || "");
  }
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

// The text on file for a field ("" when none).
function currentText(ctx, field) {
  const f = FIELDS[field];
  if (!f || f.photo || f.support) return "";
  return clean(f.read(ctx));
}

// Checks and writes an approved value. Returns { error } or { applied }.
async function applyField(tx, ctx, field, raw) {
  const f = FIELDS[field];
  if (!f || f.photo) return { error: "That field can't be updated from a survey" };
  const value = clean(raw);
  if (!value) return { error: "There is nothing to apply" };
  if (f.support) {
    const result = await applySupportAnswer(tx, ctx.partner.id, value);
    return result?.error ? { error: result.error } : { applied: value };
  }
  const checked = f.normalize ? f.normalize(value) : { value };
  if (checked.error) return { error: checked.error };
  const saved = checked.value;
  if (!saved) return { error: "There is nothing to apply" };
  const result = await f.write(tx, ctx, saved);
  if (result?.error) return { error: result.error };
  return { applied: saved };
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
  normalizeAddress,
  presentation,
  presentQuestion,
  pageQuestion,
  problemWithAnswer,
  CONTACT_METHOD_LABELS,
};
