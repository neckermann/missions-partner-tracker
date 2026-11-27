// The smaller copy of an uploaded photo that pages show, so a directory of photos doesn't download every photo at
// full size. The full copy is always kept as uploaded (served at the same address with /raw on the end) for the
// booklet and "open full size".
//
// makeDisplayCopy(bytes): a JPEG at most 800px on its longest side, aspect ratio kept, EXIF rotation applied,
//   transparency flattened on white; or null when the photo is already small enough to show as it is.
// shrinkLogo(bytes, contentType): the logo at most 800px wide, in its own format so transparency survives.
//
// Resizing is one at a time (a queue) with sharp's own threads capped at one, and reads at most 100 million pixels,
// so a burst of uploads or a huge picture can't push the server past its memory. Measured in a scratch test: a
// 3000px JPEG adds about 10 MB for 35 ms, a 38 MB 6000x4000 PNG about 52 MB for 0.6 s.
const sharp = require("sharp");

sharp.concurrency(1);
sharp.cache(false);

const DISPLAY_SIDE = 800;
const LOGO_WIDTH = 800;
const DISPLAY_QUALITY = 80;
// A photo this small in both pixels and bytes is shown as uploaded: a copy would save nothing.
const KEEP_AS_IS_BYTES = 200 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;

let queue = Promise.resolve();
function oneAtATime(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

const open = (bytes) => sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true });

async function makeDisplayCopy(bytes) {
  try {
    return await oneAtATime(async () => {
      const meta = await open(bytes).metadata();
      // EXIF orientations 5-8 swap width and height.
      const swapped = meta.orientation >= 5;
      const w = swapped ? meta.height : meta.width;
      const h = swapped ? meta.width : meta.height;
      if (Math.max(w, h) <= DISPLAY_SIDE && bytes.length <= KEEP_AS_IS_BYTES && !meta.orientation)
        return null;
      const out = await open(bytes)
        .rotate()
        .resize({ width: DISPLAY_SIDE, height: DISPLAY_SIDE, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: DISPLAY_QUALITY, mozjpeg: false })
        .toBuffer();
      // Never serve a "smaller" copy that is not smaller.
      return out.length < bytes.length ? out : null;
    });
  } catch {
    // Unreadable or too large to decode: the full copy is still served.
    return null;
  }
}

async function shrinkLogo(bytes, contentType) {
  try {
    return await oneAtATime(async () => {
      const meta = await open(bytes).metadata();
      if (!meta.width || meta.width <= LOGO_WIDTH) return { bytes, contentType };
      let pipeline = open(bytes).rotate().resize({ width: LOGO_WIDTH, withoutEnlargement: true });
      if (contentType === "image/png") pipeline = pipeline.png({ compressionLevel: 9 });
      else if (contentType === "image/webp") pipeline = pipeline.webp({ quality: 90 });
      else if (contentType === "image/jpeg") pipeline = pipeline.jpeg({ quality: 90 });
      else return { bytes, contentType };
      const out = await pipeline.toBuffer();
      return out.length < bytes.length ? { bytes: out, contentType } : { bytes, contentType };
    });
  } catch {
    return { bytes, contentType };
  }
}

module.exports = { makeDisplayCopy, shrinkLogo, DISPLAY_SIDE, LOGO_WIDTH };
