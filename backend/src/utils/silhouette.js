// Generic placeholder photos, as inline SVG data URIs -- no external image
// service at all, so there's zero risk of an inappropriate or unavailable
// image and no extra network round-trip. Two callers share this:
//
// - maskData.js uses `silhouetteFor()` with the fixed NEUTRAL_ACCENT color
//   to give restricted-access partners a real (but anonymous) public
//   photo instead of no photo at all -- a plain shape-only icon, never a
//   real human photo (even a generic one), keeps this consistent with
//   the whole point of isRestricted masking.
// - prisma/seed.js calls the individual shape builders directly with a
//   randomly-picked color per record, purely for demo-data variety when
//   Pexels isn't configured (a different use case, so it doesn't want
//   the fixed neutral color `silhouetteFor` defaults to).
const NEUTRAL_ACCENT = "#6b7280"; // slate-500 -- neutral enough not to clash with any church's own brand color

function svgDataUri(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
function personSilhouette(bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><circle cx="100" cy="80" r="35" fill="#fff"/><path d="M40 170 Q40 110 100 110 Q160 110 160 170 Z" fill="#fff"/></svg>`;
}
function coupleSilhouette(bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><circle cx="75" cy="75" r="28" fill="#fff"/><path d="M30 165 Q30 115 75 115 Q120 115 120 165 Z" fill="#fff"/><circle cx="130" cy="80" r="26" fill="#ffffffcc"/><path d="M88 168 Q88 122 130 122 Q172 122 172 168 Z" fill="#ffffffcc"/></svg>`;
}
function familySilhouette(bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><circle cx="60" cy="70" r="24" fill="#fff"/><path d="M25 165 Q25 122 60 122 Q95 122 95 165 Z" fill="#fff"/><circle cx="140" cy="70" r="24" fill="#ffffffcc"/><path d="M105 165 Q105 122 140 122 Q175 122 175 165 Z" fill="#ffffffcc"/><circle cx="100" cy="112" r="16" fill="#ffffffee"/><path d="M76 168 Q76 142 100 142 Q124 142 124 168 Z" fill="#ffffffee"/></svg>`;
}
function buildingSilhouette(bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><path d="M100 30 L170 72 L30 72 Z" fill="#fff"/><rect x="38" y="78" width="12" height="78" fill="#fff"/><rect x="66" y="78" width="12" height="78" fill="#fff"/><rect x="94" y="78" width="12" height="78" fill="#fff"/><rect x="122" y="78" width="12" height="78" fill="#fff"/><rect x="150" y="78" width="12" height="78" fill="#fff"/><rect x="25" y="158" width="150" height="14" fill="#fff"/></svg>`;
}

const BUILDERS = {
  single: personSilhouette,
  couple: coupleSilhouette,
  family: familySilhouette,
  organization: buildingSilhouette,
};

// `category` is one of BUILDERS' keys above; anything else falls back to
// the single-person shape rather than throwing, since a masked public
// record is exactly the wrong place for an unhandled-category crash.
function silhouetteFor(category, bg = NEUTRAL_ACCENT) {
  const build = BUILDERS[category] || personSilhouette;
  return svgDataUri(build(bg));
}

module.exports = {
  NEUTRAL_ACCENT,
  svgDataUri,
  personSilhouette,
  coupleSilhouette,
  familySilhouette,
  buildingSilhouette,
  silhouetteFor,
};
