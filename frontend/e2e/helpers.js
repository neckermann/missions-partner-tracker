import { generate as generateTotp } from "otplib";

// Shared helpers for the e2e suite. Credentials come from env vars so CI can point this at a
// throwaway account (.github/workflows/ci.yml) and local runs at whatever admin exists
// locally.
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "demo@missionspartnertracker.com";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "TryTheDemo2026!";

export async function login(page, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin/);
}

// A partner that the admin forms' <PartnerSelect> will actually offer. GET /api/partners
// returns archived partners, but PartnerSelect drops them (you shouldn't log a trip or support
// entry against an archived partner). A test that grabs partners[0] from the API therefore
// fails whenever the alphabetically-first partner is archived (the seed archives two), with
// "did not find some options". Asking the API for exactly what the dropdown shows removes that
// draw.
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

// Accounts for the access specs, signed in over the API and ready to use.
//
// Whether a new account is sent to two-factor enrolment at its first sign-in depends on the
// church-wide requirement (ChurchSettings.requireTwoFactor): off, a password signs it in; on,
// sign-in returns a setup token and no session until it enrols. These helpers do what a person
// would in either case: sign in with the password and, when asked, enrol an authenticator over
// the API with a real code from otplib, keeping the session enrolment hands back.
//
// `enrolled: true` enrols the account even when the requirement is off (needed for an admin who
// is going to turn the requirement on, which only an enrolled admin may do).
//
// Each returns { user, email, password, secret?, storageState }; open a page as that account
// with `browser.newContext({ storageState })`. Delete the user afterwards (its seats and grants
// go with it): DELETE /api/users/:id as an admin.
async function signInOverApi(browser, email, password, { enrolled = false } = {}) {
  const context = await browser.newContext();
  try {
    const login = await context.request.post("/api/auth/login", { data: { email, password } });
    const body = await login.json();
    let secret;
    if (body.setupToken || enrolled) {
      // Sent to enrolment by the requirement, or asked to enrol anyway: a setup token if we
      // have one, otherwise the session the password sign-in just gave us.
      const auth = body.setupToken ? { headers: { Authorization: `Bearer ${body.setupToken}` } } : {};
      const setup = await context.request.post("/api/auth/mfa/setup", auth);
      secret = (await setup.json()).secret;
      const verified = await context.request.post("/api/auth/mfa/verify-setup", {
        ...auth,
        data: { token: await generateTotp({ secret }) },
      });
      if (!verified.ok()) throw new Error(`enrolling two-factor failed: ${verified.status()}`);
    } else if (!login.ok()) {
      throw new Error(`signing in failed: ${login.status()}`);
    }
    return { secret, storageState: await context.storageState() };
  } finally {
    await context.close();
  }
}

export async function createAccount(browser, adminPage, { role, suffix, enrolled = false, ...extra }) {
  const email = `e2e-${role}-${suffix}-${Date.now()}@example.test`;
  const password = "AccountE2ePassword123!";
  const created = await adminPage.request.post("/api/users", {
    data: {
      email,
      firstName: "E2E",
      lastName: `${role} ${suffix}`,
      role,
      password,
      sendWelcomeEmail: false,
      ...extra,
    },
  });
  if (!created.ok())
    throw new Error(`creating the account failed: ${created.status()} ${await created.text()}`);
  const user = await created.json();
  return { user, email, password, ...(await signInOverApi(browser, email, password, { enrolled })) };
}

// A guest login with care team seats and/or trip grants.
export const createGuest = (browser, adminPage, { suffix, careTeam = [], tripAccess = [], ...rest }) =>
  createAccount(browser, adminPage, { role: "guest", suffix, careTeam, tripAccess, ...rest });

// An account created but not signed in (so its first sign-in can be driven through the UI).
export async function createAccountUnsignedIn(adminPage, { role, suffix, ...extra }) {
  const email = `e2e-${role}-${suffix}-${Date.now()}@example.test`;
  const password = "AccountE2ePassword123!";
  const created = await adminPage.request.post("/api/users", {
    data: {
      email,
      firstName: "E2E",
      lastName: `${role} ${suffix}`,
      role,
      password,
      sendWelcomeEmail: false,
      ...extra,
    },
  });
  if (!created.ok())
    throw new Error(`creating the account failed: ${created.status()} ${await created.text()}`);
  return { user: await created.json(), email, password };
}

// The code an authenticator app would show for a secret.
export const totpCode = (secret) => generateTotp({ secret });
