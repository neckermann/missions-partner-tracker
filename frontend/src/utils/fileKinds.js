// Shared by every PartnerFile UI. Keys match backend/src/routes/fileKinds.js FILE_KINDS exactly
// (what is stored on PartnerFile.kind). "newsletter" sorts first as the most common kind.
export const FILE_KINDS = [
  { value: "newsletter", label: "Newsletter" },
  { value: "survey_response", label: "Survey Response" },
  { value: "signed_policy", label: "Signed Policy" },
  { value: "email", label: "Email Communication" },
  { value: "office_document", label: "Office Document" },
  { value: "other", label: "Other" },
];

const LABEL_BY_VALUE = Object.fromEntries(FILE_KINDS.map((k) => [k.value, k.label]));

// For "other", prefer the free-typed customKind over the generic "Other" label.
export function fileKindLabel(file) {
  if (file.kind === "other" && file.customKind) return file.customKind;
  return LABEL_BY_VALUE[file.kind] || file.kind;
}
