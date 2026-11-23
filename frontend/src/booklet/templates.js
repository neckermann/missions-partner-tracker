// The booklet template catalog -- mirrors the registry/definitions split
// backend/src/reporting/registry.js + definitions.js established for
// Reports (#296): a template is a small data object (a token set), not a
// hand-duplicated ~150-line CSS block. AdminBooklet.jsx's picker renders
// from TEMPLATES below instead of a literal array, and the one shared
// frontend/src/styles/booklet.css reads a template's tokens as CSS custom
// properties and a couple of data-* attributes (for the handful of things
// that are structurally, not just numerically, different -- see that
// file's own comments). Adding template #3 means adding another entry
// here with its own token values, not another CSS block.
//
// #322 shipped exactly two: Classic (the original warm/relational look,
// unchanged in behavior from before this rebuild) and Modern (clean/
// structured). Traditional/Keepsake/Portfolio/Friendly existed before this
// rebuild but are not offered here -- see booklet.css's header comment for
// why their CSS was deleted rather than ported.
export const TEMPLATES = [
  {
    id: "classic",
    label: "Classic",
    description: "Warm accent-colored circles, a soft tinted callout, a circular photo — the original look.",
    tokens: {
      // "brand" resolves the accent from ChurchSettings.primaryColor, with
      // the fallback rotation (FALLBACK_ACCENTS below) only for an
      // instance that hasn't set a brand color. "rotate" would skip
      // primaryColor entirely and always use the rotation -- no v1
      // template does this, but the token exists for a future template
      // whose look intentionally varies accent per entry regardless of
      // brand color (see resolveAccent()).
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

// AdminBooklet.jsx's picker: { value, label, description } per template,
// derived from the catalog instead of its own literal array.
export const TEMPLATE_OPTIONS = TEMPLATES.map((t) => ({
  value: t.id,
  label: t.label,
  description: t.description,
}));

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID);
}

// Kept only as the fallback now that --accent defaults to
// ChurchSettings.primaryColor (see resolveAccent) -- previously this (as
// PALETTE, paired with its own hand-picked --tint hex per entry) was the
// only accent source the booklet had. The matching tinted-callout
// background Classic needs is no longer a second hardcoded hex per entry;
// booklet.css derives it from whichever --accent is actually in play via
// color-mix(), so one fallback list (accents only) is enough.
const FALLBACK_ACCENTS = ["#C97A3D", "#4C7A79", "#6B5B4C", "#7A8B6F"];

// The accent color for one booklet page/entry. `primaryColor` is
// ChurchSettings' own brand accent (SettingsContext's --brand-color role);
// null on an instance that hasn't set one. `index` is the per-section
// running index used to rotate through the fallback list (the same
// rotation every page already used before this template had any concept
// of brand color at all).
export function resolveAccent(template, primaryColor, index) {
  if (template.tokens.accentSource === "brand" && primaryColor) return primaryColor;
  return FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length];
}

// Everything a template's wrapper <div> needs so booklet.css's shared,
// token-driven rules pick up this template's look: a data-template
// attribute (useful for debugging/e2e, mirrors the old tpl-${template}
// class), the structural data-* attributes booklet.css branches on, and
// the handful of tokens that are plain CSS values -- as a `--tpl-*` custom
// property each. --accent/--tint stay separate (set per-page/per-entry,
// not per-template) and are threaded through unchanged by callers.
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

// Quote-escapes a value headed into a double-quoted HTML attribute --
// fontFamily token values (e.g. Georgia, "Times New Roman", serif)
// contain literal double quotes that would otherwise terminate the
// attribute early.
function escapeAttr(value) {
  return String(value).replaceAll('"', "&quot;");
}

// buildBookletHtml builds a raw HTML string (see AdminBooklet.jsx), not
// JSX, so the wrapper's attributes/style need to come back as literal
// markup rather than a React props object.
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
