// Fetches a guide's Markdown straight from GitHub's raw content at load
// time and renders it client-side -- the repo's .md file stays the single
// source of truth, this page is just a nicer reader for it. No build step,
// no copy to keep in sync.
const RAW_BASE = "https://raw.githubusercontent.com/neckermann/missions-partner-tracker/main/";
const REPO_BLOB_BASE = "https://github.com/neckermann/missions-partner-tracker/blob/main/";

// The two guides that have their own page on this site -- any link to one
// of these from inside the rendered Markdown gets rewritten to stay on this
// site instead of bouncing back to GitHub.
const LOCAL_GUIDES = {
  "ADMIN_GUIDE.md": "admin-guide.html",
  "USER_GUIDE.md": "user-guide.html",
};

function rewriteLink(href) {
  if (!href || /^https?:\/\//i.test(href) || href.startsWith("#") || href.startsWith("mailto:")) {
    return href;
  }
  const [path, hash] = href.split("#");
  const local = LOCAL_GUIDES[path];
  if (local) return hash ? `${local}#${hash}` : local;
  // Any other relative .md link (CONTRIBUTING.md, CHANGELOG.md, etc.) --
  // this page doesn't have a reader for those, so send it to GitHub's own
  // rendered view instead of a dead relative path.
  if (path.endsWith(".md")) return `${REPO_BLOB_BASE}${path}${hash ? "#" + hash : ""}`;
  return href;
}

// A relative image path in the .md source (e.g. "docs/assets/screenshots/
// foo.png") resolves correctly on GitHub's own blob view and in a local
// editor preview, both of which treat it as relative to the repo root --
// but this page only has the raw Markdown *text*, fetched with no base URL
// of its own, so the same relative path would resolve against this site's
// own URL instead and 404. Pointed at the raw file straight from GitHub so
// it works wherever the Markdown itself is read from.
function rewriteImageSrc(src) {
  if (!src || /^https?:\/\//i.test(src)) return src;
  return `${RAW_BASE}${src}`;
}

async function loadGuide(fileName, containerId) {
  const container = document.getElementById(containerId);
  try {
    const res = await fetch(`${RAW_BASE}${fileName}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const markdown = await res.text();
    container.innerHTML = marked.parse(markdown);
    container.querySelectorAll("a[href]").forEach((a) => {
      a.setAttribute("href", rewriteLink(a.getAttribute("href")));
    });
    container.querySelectorAll("img[src]").forEach((img) => {
      img.setAttribute("src", rewriteImageSrc(img.getAttribute("src")));
    });
    // Jump to the requested anchor now that the real content (and its
    // heading ids) exists -- the browser already tried once, before any
    // of this existed, and gave up.
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  } catch (err) {
    container.innerHTML = `<p class="guide-error">Couldn't load this guide from GitHub right now. <a href="${REPO_BLOB_BASE}${fileName}" target="_blank" rel="noreferrer">Read it directly on GitHub</a> instead.</p>`;
  }
}
