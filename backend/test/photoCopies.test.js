const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { makeDisplayCopy, shrinkLogo, DISPLAY_SIDE, LOGO_WIDTH } = require("../src/utils/photoCopies");

// A noisy picture, so the JPEG/PNG is big enough that a copy is worth making.
async function picture(width, height, { format = "jpeg", orientation, alpha = false } = {}) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + (i >> 5) * 17) & 255;
  if (alpha) for (let i = 3; i < raw.length; i += 4) raw[i] = i % 8 === 3 ? 0 : 255;
  let img = sharp(raw, { raw: { width, height, channels } });
  if (orientation) img = img.withMetadata({ orientation });
  return img[format]().toBuffer();
}

describe("makeDisplayCopy", () => {
  test("a large photo becomes a JPEG at most 800px on its longest side, aspect ratio kept", async () => {
    const big = await picture(3000, 2000);
    const copy = await makeDisplayCopy(big);
    assert.ok(copy, "a copy is made");
    const meta = await sharp(copy).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.width, DISPLAY_SIDE);
    assert.equal(meta.height, Math.round((DISPLAY_SIDE * 2000) / 3000));
    assert.ok(copy.length < big.length);
  });

  test("a tall photo is limited by its height", async () => {
    const copy = await makeDisplayCopy(await picture(1500, 3000, { format: "png" }));
    const meta = await sharp(copy).metadata();
    assert.equal(meta.height, DISPLAY_SIDE);
    assert.equal(meta.width, DISPLAY_SIDE / 2);
  });

  test("a small photo is left alone (null: the full copy is shown)", async () => {
    assert.equal(await makeDisplayCopy(await picture(200, 150)), null);
  });

  test("EXIF rotation is applied, so the copy stands upright with no orientation tag", async () => {
    // 1600x1000 stored sideways (orientation 6 = rotate 90 clockwise to view): it shows as 1000 wide, 1600 tall.
    const copy = await makeDisplayCopy(await picture(1600, 1000, { orientation: 6 }));
    const meta = await sharp(copy).metadata();
    assert.equal(meta.height, DISPLAY_SIDE);
    assert.equal(meta.width, 500);
    assert.ok(!meta.orientation || meta.orientation === 1);
  });

  test("transparency is flattened on white", async () => {
    const copy = await makeDisplayCopy(await picture(1600, 1200, { format: "png", alpha: true }));
    const meta = await sharp(copy).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.hasAlpha, false);
  });

  test("something that is not an image gives null instead of throwing", async () => {
    assert.equal(await makeDisplayCopy(Buffer.from("not a picture")), null);
  });

  test("several at once are done one at a time and all come back", async () => {
    const big = await picture(2000, 1500);
    const copies = await Promise.all([1, 2, 3, 4].map(() => makeDisplayCopy(big)));
    assert.ok(copies.every((c) => c && c.length > 0));
  });
});

describe("shrinkLogo", () => {
  test("a wide PNG logo is shrunk to 800px wide and keeps its transparency", async () => {
    const big = await picture(2400, 600, { format: "png", alpha: true });
    const out = await shrinkLogo(big, "image/png");
    const meta = await sharp(out.bytes).metadata();
    assert.equal(out.contentType, "image/png");
    assert.equal(meta.format, "png");
    assert.equal(meta.width, LOGO_WIDTH);
    assert.equal(meta.height, 200);
    assert.equal(meta.hasAlpha, true);
    assert.ok(out.bytes.length < big.length);
  });

  test("a WebP and a JPEG logo keep their own format", async () => {
    const webp = await shrinkLogo(await picture(1600, 400, { format: "webp" }), "image/webp");
    assert.equal((await sharp(webp.bytes).metadata()).format, "webp");
    const jpeg = await shrinkLogo(await picture(1600, 400), "image/jpeg");
    assert.equal((await sharp(jpeg.bytes).metadata()).format, "jpeg");
  });

  test("a logo already 800px wide or less is stored untouched", async () => {
    const small = await picture(500, 200, { format: "png", alpha: true });
    const out = await shrinkLogo(small, "image/png");
    assert.equal(out.bytes, small);
  });

  test("a file sharp cannot read is stored as it came", async () => {
    const junk = Buffer.from("junk");
    const out = await shrinkLogo(junk, "image/png");
    assert.equal(out.bytes, junk);
    assert.equal(out.contentType, "image/png");
  });
});
