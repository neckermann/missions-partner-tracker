// Gets a chosen photo ready to send: checks its type and size in plain words before anything uploads, and shrinks
// a big one in the browser (a phone photo is often 3 to 12 MB) so it uploads quickly, even on a slow connection,
// and is kept at a size the database and its backups handle comfortably.
//
// A photo is shrunk to at most 3000 px on its long side as a JPEG at quality 88 (it still prints about 10 inches
// wide at 300 dpi, and is hard to tell from the original on screen). A photo that is already small is sent as it is,
// and so is one the browser can't open (a HEIC photo in Chrome): the server accepts those up to the same limit and
// converts HEIC itself. Dependency-free on purpose; `deps` lets a test stand in for the browser.
export const MAX_SIDE = 3000;
export const QUALITY = 0.88;
// A photo at or under this size is sent untouched; shrinking it would save little and cost quality.
export const LEAVE_ALONE_BYTES = 1.5 * 1024 * 1024;
// What the server accepts (backend/src/utils/surveyResponses.js, participantPhoto.js, routes/partners.js).
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

const size = (bytes) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function looksLikeAllowedImage(file, allowed) {
  if (allowed.includes(file.type)) return true;
  // Windows often reports no type for HEIC, and some browsers none for WebP.
  return (
    (!file.type || file.type === "application/octet-stream") &&
    /\.(hei[cf]|webp|jpe?g|png)$/i.test(file.name || "")
  );
}

const defaultDeps = {
  // Opens the photo with its camera rotation applied. Throws when the browser can't read it.
  decode: (file) => createImageBitmap(file, { imageOrientation: "from-image" }),
  // Draws the photo at width x height and returns it as a JPEG Blob.
  encode: async (bitmap, width, height, quality) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // a PNG's see-through parts become white, not black
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality)
    );
  },
};

const tooBig = (file, max, why) =>
  `That photo is ${size(file.size)} and the limit is ${size(max)}${why}. Please choose a smaller photo.`;

// Returns { file, shrunk, before, after } to send, or { error } in plain words (nothing should be uploaded).
export async function prepareImage(
  file,
  { allowed = OK_TYPES, maxBytes = MAX_UPLOAD_BYTES, deps = defaultDeps } = {}
) {
  if (!file || !looksLikeAllowedImage(file, allowed)) {
    return { error: "Please choose a JPEG, PNG, WebP or HEIC photo." };
  }
  const original = { file, shrunk: false, before: file.size, after: file.size };
  const sendAsIs = () =>
    file.size > maxBytes
      ? { error: tooBig(file, maxBytes, " and this browser can't make it smaller") }
      : original;

  if (file.size <= LEAVE_ALONE_BYTES) return original;

  let bitmap;
  try {
    bitmap = await deps.decode(file);
  } catch {
    return sendAsIs();
  }
  try {
    const long = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_SIDE / long);
    // Already within 3000 px: only recompress when the file is large; otherwise leave it exactly as it is.
    if (scale === 1 && file.size <= 5 * 1024 * 1024) return sendAsIs();
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    let blob;
    try {
      blob = await deps.encode(bitmap, width, height, QUALITY);
    } catch {
      return sendAsIs();
    }
    // Never make it worse: keep the original when shrinking didn't help.
    if (!blob || blob.size >= file.size) return sendAsIs();
    const name = `${(file.name || "photo").replace(/\.[^.]+$/, "")}.jpg`;
    const shrunk = new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
    if (shrunk.size > maxBytes) return { error: tooBig(shrunk, maxBytes, "") };
    return { file: shrunk, shrunk: true, before: file.size, after: shrunk.size };
  } finally {
    bitmap.close?.();
  }
}
