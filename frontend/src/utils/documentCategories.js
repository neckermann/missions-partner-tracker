// Shared between AdminDocuments.jsx (consolidated list + filter) and
// DocumentSection.jsx (embedded per-partner upload form) so the two never
// drift apart. Keys match backend/src/routes/documents.js's CATEGORIES
// exactly — that's what's actually stored on Document.category.
export const DOCUMENT_CATEGORIES = [
  { value: "survey_response", label: "Survey Response" },
  { value: "signed_policy", label: "Signed Policy" },
  { value: "email", label: "Email Communication" },
  { value: "office_document", label: "Office Document" },
  { value: "other", label: "Other" },
];

const LABEL_BY_VALUE = Object.fromEntries(DOCUMENT_CATEGORIES.map((c) => [c.value, c.label]));

// For "other", prefer the free-typed customCategory over the generic
// "Other" label, since that's the whole point of that category.
export function documentCategoryLabel(doc) {
  if (doc.category === "other" && doc.customCategory) return doc.customCategory;
  return LABEL_BY_VALUE[doc.category] || doc.category;
}
