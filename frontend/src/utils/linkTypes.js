// Keys match backend/src/routes/linkTypes.js LINK_TYPES exactly (stored on PartnerLink.type). A
// fixed, curated list with no "Other" escape hatch; new platforms are added here.
export const LINK_TYPES = [
  { value: "website", label: "Website" },
  { value: "support", label: "Support / Donate Link" },
  { value: "newsletterSignup", label: "Newsletter Signup" },
  { value: "facebook", label: "Facebook" },
  { value: "twitter", label: "Twitter / X" },
  { value: "instagram", label: "Instagram" },
  { value: "linkedin", label: "LinkedIn" },
];

const LABEL_BY_VALUE = Object.fromEntries(LINK_TYPES.map((t) => [t.value, t.label]));

export function linkTypeLabel(type) {
  return LABEL_BY_VALUE[type] || type;
}
