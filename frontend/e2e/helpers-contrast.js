// Finds text a person can't read: for every visible piece of text on the page, the WCAG contrast
// between its colour and the background it actually sits on. Run in the browser, so it uses the
// computed styles of whichever theme is active (light, dark, or the system's).
export async function lowContrastText(page, { minRatio = 4.5, minLargeRatio = 3 } = {}) {
  return page.evaluate(
    ({ minRatio, minLargeRatio }) => {
      const parse = (c) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = 1] = m[1]
          .split(/[ ,/]+/)
          .filter(Boolean)
          .map(Number);
        return { r, g, b, a };
      };
      const over = (top, bottom) => {
        const a = top.a + bottom.a * (1 - top.a);
        if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
        const mix = (t, b2) => (t * top.a + b2 * bottom.a * (1 - top.a)) / a;
        return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
      };
      const lum = ({ r, g, b }) => {
        const f = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      // The colour actually behind an element: blend its ancestors' backgrounds, bottom up.
      // An image or gradient behind the text can't be judged, so those elements are skipped.
      const backdrop = (el) => {
        const chain = [];
        for (let n = el; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.backgroundImage && s.backgroundImage !== "none") return null;
          chain.push(parse(s.backgroundColor) || { r: 0, g: 0, b: 0, a: 0 });
          if ((parse(s.backgroundColor) || { a: 0 }).a >= 1) break;
        }
        let bg = { r: 255, g: 255, b: 255, a: 1 };
        for (const layer of chain.reverse()) bg = over(layer, bg);
        return bg;
      };
      const out = [];
      const seen = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent.trim();
        const el = node.parentElement;
        if (!text || !el || seen.has(el)) continue;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(el.tagName)) continue;
        const rect = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (rect.width === 0 || rect.height === 0 || s.visibility === "hidden" || s.display === "none")
          continue;
        if (Number(s.opacity) === 0) continue;
        const fg = parse(s.color);
        const bg = backdrop(el);
        if (!fg || !bg) continue;
        seen.add(el);
        const px = parseFloat(s.fontSize);
        const bold = parseInt(s.fontWeight, 10) >= 700;
        const large = px >= 24 || (px >= 18.66 && bold);
        const need = large ? minLargeRatio : minRatio;
        const r = ratio(over(fg, bg), bg);
        if (r < need) {
          out.push({
            ratio: Math.round(r * 100) / 100,
            text: text.slice(0, 50),
            selector:
              el.tagName.toLowerCase() +
              (el.className && typeof el.className === "string"
                ? "." + el.className.trim().split(/\s+/).join(".")
                : ""),
            color: s.color,
          });
        }
      }
      return out;
    },
    { minRatio, minLargeRatio }
  );
}
