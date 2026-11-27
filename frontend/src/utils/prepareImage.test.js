import { describe, it, expect, vi } from "vitest";
import { prepareImage, MAX_SIDE, LEAVE_ALONE_BYTES, MAX_UPLOAD_BYTES } from "./prepareImage.js";

const MB = 1024 * 1024;
const photo = (bytes, { type = "image/jpeg", name = "IMG_1234.jpg" } = {}) =>
  new File([new Uint8Array(bytes)], name, { type });
const depsFor = ({ width, height, out = 700 * 1024, decodeFails = false, encodeFails = false } = {}) => {
  const close = vi.fn();
  return {
    close,
    decode: vi.fn(async () => {
      if (decodeFails) throw new Error("can't open");
      return { width, height, close };
    }),
    encode: vi.fn(async (_b, w, h) => {
      if (encodeFails) throw new Error("no canvas");
      return Object.assign(new Blob([new Uint8Array(out)], { type: "image/jpeg" }), { drewAt: [w, h] });
    }),
  };
};

describe("prepareImage", () => {
  it("shrinks a big phone photo to 3000 px on the long side, as a JPEG, and says how much smaller", async () => {
    const deps = depsFor({ width: 4032, height: 3024 });
    const result = await prepareImage(photo(6 * MB, { name: "IMG_1234.HEIC", type: "image/heic" }), { deps });
    expect(result.shrunk).toBe(true);
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.name).toBe("IMG_1234.jpg");
    expect(result.before).toBe(6 * MB);
    expect(result.after).toBe(700 * 1024);
    expect(deps.encode).toHaveBeenCalledWith(expect.anything(), 3000, 2250, 0.88);
    expect(deps.close).toHaveBeenCalled();
  });

  it("scales a portrait photo by its long side too", async () => {
    const deps = depsFor({ width: 3024, height: 4032 });
    await prepareImage(photo(4 * MB), { deps });
    expect(deps.encode).toHaveBeenCalledWith(expect.anything(), 2250, 3000, 0.88);
  });

  it("leaves a small photo exactly as it is, without even opening it", async () => {
    const deps = depsFor({ width: 4032, height: 3024 });
    const file = photo(LEAVE_ALONE_BYTES);
    const result = await prepareImage(file, { deps });
    expect(result.file).toBe(file);
    expect(result.shrunk).toBe(false);
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it("leaves a photo that is already within 3000 px and not large alone", async () => {
    const deps = depsFor({ width: 2400, height: 1800 });
    const file = photo(3 * MB);
    const result = await prepareImage(file, { deps });
    expect(result.file).toBe(file);
    expect(deps.encode).not.toHaveBeenCalled();
  });

  it("recompresses a within-3000 px photo that is large, without changing its size in pixels", async () => {
    const deps = depsFor({ width: 2900, height: 2000, out: 900 * 1024 });
    const result = await prepareImage(photo(9 * MB), { deps });
    expect(result.shrunk).toBe(true);
    expect(deps.encode).toHaveBeenCalledWith(expect.anything(), 2900, 2000, 0.88);
  });

  it("keeps the original when shrinking would not make it smaller", async () => {
    const deps = depsFor({ width: 4000, height: 3000, out: 8 * MB });
    const file = photo(6 * MB);
    expect((await prepareImage(file, { deps })).file).toBe(file);
  });

  it("sends a photo the browser can't open as it is, when it is within the limit", async () => {
    const deps = depsFor({ decodeFails: true });
    const file = photo(8 * MB, { type: "image/heic", name: "IMG.HEIC" });
    const result = await prepareImage(file, { deps });
    expect(result.file).toBe(file);
    expect(result.shrunk).toBe(false);
  });

  it("says so in plain words when a photo the browser can't open is over the limit", async () => {
    const deps = depsFor({ decodeFails: true });
    const result = await prepareImage(
      photo(MAX_UPLOAD_BYTES + MB, { type: "image/heic", name: "IMG.HEIC" }),
      { deps }
    );
    expect(result.error).toMatch(
      /That photo is 16\.0 MB and the limit is 15\.0 MB and this browser can't make it smaller\. Please choose a smaller photo\./
    );
    expect(result.file).toBeUndefined();
  });

  it("falls back to the original when the browser can't draw it, and refuses one that is too big either way", async () => {
    const file = photo(5 * MB);
    expect(
      (await prepareImage(file, { deps: depsFor({ width: 4000, height: 3000, encodeFails: true }) })).file
    ).toBe(file);
    const huge = photo(MAX_UPLOAD_BYTES + 1);
    expect(
      (await prepareImage(huge, { deps: depsFor({ width: 4000, height: 3000, encodeFails: true }) })).error
    ).toMatch(/limit is 15\.0 MB/);
  });

  it("refuses something that isn't a photo, before anything is read", async () => {
    const deps = depsFor({ width: 10, height: 10 });
    for (const file of [
      photo(1000, { type: "application/pdf", name: "scan.pdf" }),
      photo(1000, { type: "text/plain", name: "a.txt" }),
      null,
    ]) {
      expect((await prepareImage(file, { deps })).error).toBe(
        "Please choose a JPEG, PNG, WebP or HEIC photo."
      );
    }
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it("accepts a photo whose type the browser leaves blank, by its name", async () => {
    const file = photo(1000, { type: "", name: "IMG_0001.heic" });
    expect((await prepareImage(file, { deps: depsFor({}) })).file).toBe(file);
  });

  it("uses MAX_SIDE for the long side", () => {
    expect(MAX_SIDE).toBe(3000);
  });
});
