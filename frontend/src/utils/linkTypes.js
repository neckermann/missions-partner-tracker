// Keys match backend/src/routes/linkTypes.js's LINK_TYPES exactly -- that's
// what's actually stored on PartnerLink.type. A fixed, curated list (no
// "Other" escape hatch) -- a new platform gets added here via an issue/PR,
// same as any other feature request.
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
