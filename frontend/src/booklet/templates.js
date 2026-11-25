// The booklet template catalog: a template is a small data object (a token set), not a CSS block.
// booklet.css reads the tokens as CSS custom properties and a few data-* attributes. Adding a
// template means adding an entry here.
export const TEMPLATES = [
  {
    id: "classic",
    label: "Classic",
    description: "Warm accent-colored circles, a soft tinted callout, a circular photo — the original look.",
    tokens: {
      // "brand" takes the accent from ChurchSettings.primaryColor (FALLBACK_ACCENTS only when unset).
      // "rotate" always uses the rotation, ignoring primaryColor (see resolveAccent()).
      accentSource: "brand",
      fontFamily: 'Georgia, "Times New Roman", serif',
      headingWeight: 700,
      headingTransform: "none",
      coverAlign: "center",
      shapeStyle: "circles",
      photoShape: "circle",
      calloutStyle: "tint",
      frameStyle: "none",
      headingRule: "none",
    },
  },
  {
    id: "modern",
    label: "Modern",
    description:
      "Clean and structured — no decorative shapes, bold rules, a rectangular photo, condensed sans-serif headers.",
    tokens: {
      accentSource: "brand",
      fontFamily: '"Helvetica Neue", Arial, sans-serif',
      headingWeight: 800,
      headingTransform: "uppercase",
      coverAlign: "left",
      shapeStyle: "none",
      photoShape: "rect",
      calloutStyle: "rule",
      frameStyle: "rule",
      headingRule: "rule",
    },
  },
];

export const DEFAULT_TEMPLATE_ID = "classic";

// The picker's { value, label, description } per template.
export const TEMPLATE_OPTIONS = TEMPLATES.map((t) => ({
  value: t.id,
  label: t.label,
  description: t.description,
}));

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID);
}

// Fallback accents for an instance with no primaryColor. booklet.css derives the tinted callout
// background from the active --accent via color-mix().
const FALLBACK_ACCENTS = ["#C97A3D", "#4C7A79", "#6B5B4C", "#7A8B6F"];

// The accent for one booklet page/entry. `primaryColor` is ChurchSettings' brand color (null if
// unset); `index` is the per-section running index used to rotate the fallback list.
export function resolveAccent(template, primaryColor, index) {
  if (template.tokens.accentSource === "brand" && primaryColor) return primaryColor;
  return FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length];
}

// Everything a template's wrapper <div> needs for booklet.css's token-driven rules: data-template,
// the structural data-* attributes, and plain-value tokens as `--tpl-*` properties. --accent and
// --tint are set per page/entry by callers.
export function templateAttributes(template) {
  const t = template.tokens;
  return {
    "data-template": template.id,
    "data-shape-style": t.shapeStyle,
    "data-photo-shape": t.photoShape,
    "data-callout-style": t.calloutStyle,
    "data-frame-style": t.frameStyle,
    "data-heading-rule": t.headingRule,
  };
}

export function templateStyleVars(template) {
  const t = template.tokens;
  return {
    "--tpl-font": t.fontFamily,
    "--tpl-heading-weight": t.headingWeight,
    "--tpl-heading-transform": t.headingTransform,
    "--tpl-cover-align": t.coverAlign,
  };
}

// Escapes a value for a double-quoted HTML attribute: fontFamily tokens contain literal quotes.
function escapeAttr(value) {
  return String(value).replaceAll('"', "&quot;");
}

// buildBookletHtml builds a raw HTML string, not JSX, so attributes/style come back as markup.
export function templateWrapperMarkup(template) {
  const attrs = templateAttributes(template);
  const vars = templateStyleVars(template);
  const attrString = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(" ");
  const styleString = Object.entries(vars)
    .map(([k, v]) => `${k}:${escapeAttr(v)}`)
    .join(";");
  return { attrString, styleString };
}
