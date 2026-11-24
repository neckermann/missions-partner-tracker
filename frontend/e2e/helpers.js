// Shared helpers for the e2e suite. Credentials come from env vars rather
// than being hardcoded, so CI can point this at a throwaway account
// created fresh for that run (see .github/workflows/ci.yml) while local
// runs can point at whatever admin account exists in the developer's
// own local database.
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "demo@missionspartnertracker.com";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "TryTheDemo2026!";

export async function login(page, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin/);
}

// A partner that the admin forms' <PartnerSelect> will actually offer.
//
// GET /api/partners returns archived partners unless you ask it not to
// (routes/partners.js only filters when ?archived is passed), but
// PartnerSelect defaults to includeArchived=false and drops them -- you
// shouldn't be able to log a new trip or support entry against a partner
// someone archived. Both behaviours are right; they just don't match.
//
// So a test that grabs partners[0] from the API and looks for that name in
// the dropdown fails whenever the alphabetically-first partner happens to
// be archived. The seed archives two of its thirty-five missionaries and
// gives everyone random names, so that is a real draw on every run -- and
// when it comes up, every test doing this fails at once, 30 seconds each,
// with "did not find some options". It cost a CI-red afternoon.
//
// Asking the API for exactly what the dropdown shows removes the draw.
export async function firstSelectablePartner(page, { kind = "missionary" } = {}) {
  const res = await page.request.get(`/api/partners?kind=${kind}&archived=false`);
  const partners = await res.json();
  if (!partners.length) {
    throw new Error(`no non-archived ${kind} partners exist -- check the seed`);
  }
  return partners[0];
}

// Feature flags live in one shared JSON column (ChurchSettings.enabledFeatures), and
// PUT /api/settings replaces the whole column rather than merging. So a spec that turns a
// flag on must read, merge and write -- a bare `{ enabledFeatures: { trips: true } }` wipes
// every other flag for the rest of the run -- and must put back what it changed.
//
// Even a merging read-then-write loses updates if two workers do it at once, so the specs
// that call these run together in their own serial Playwright project (see
// playwright.config.js): never two at a time, and never alongside the specs that read flags.
//
// setFeatures returns the previous value of each flag it set (undefined when it was unset),
// to hand back to restoreFeatures.
export async function setFeatures(request, patch) {
  const current = await request.get("/api/settings");
  const existing = (await current.json()).enabledFeatures || {};
  await request.put("/api/settings", { data: { enabledFeatures: { ...existing, ...patch } } });
  return Object.fromEntries(Object.keys(patch).map((key) => [key, existing[key]]));
}

export async function restoreFeatures(request, previous) {
  if (!previous) return;
  const current = await request.get("/api/settings");
  const next = { ...((await current.json()).enabledFeatures || {}) };
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  await request.put("/api/settings", { data: { enabledFeatures: next } });
}

// Phone-layout check, run in the page: whether the page scrolls sideways, and which visible
// elements run past the screen edge (the outermost only), ignoring anything inside a
// horizontally scrolling or clipping container that itself fits (a wide table scrolling
// inside its section is fine). Empty result = nothing off screen.
export async function layoutProblems(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const flagged = new Set();
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) {
          const pr = p.getBoundingClientRect();
          if (pr.right <= vw + 1 && pr.left >= -1) {
            clipped = true;
            break;
          }
        }
      }
      if (clipped) continue;
      if (el.parentElement && flagged.has(el.parentElement)) {
        flagged.add(el);
        continue;
      }
      flagged.add(el);
      offenders.push(
        `<${el.tagName.toLowerCase()}> "${(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)}" ${Math.round(r.left)}..${Math.round(r.right)} (screen ${vw})`
      );
    }
    return {
      pageOverflow: Math.max(0, document.documentElement.scrollWidth - vw),
      offenders: offenders.slice(0, 6),
    };
  });
}
