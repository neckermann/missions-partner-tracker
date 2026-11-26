import { test, expect } from "@playwright/test";
import { login, createGuest, setFeatures, restoreFeatures } from "./helpers.js";

// A guest is a scoped login whose reach comes only from grants: a seat on a partner's care
// team, or a trip an admin gave them. This drives both kinds through the real app and checks
// what they can and cannot reach: their own partner or trip works, anything else says so, and
// the pieces a guest must never have (monthly support, settings, deciding a need) stay closed.
// The route tests cover the same rules one endpoint at a time; this covers them as a guest
// experiences them, pages included. Whether a guest must enrol in two-factor is the
// church-wide requirement's business (two-factor-requirement.spec.js); here the helper signs
// them in either way. It turns care teams, the contact log and trip budgeting on, so it is one
// of the specs that change settings (FEATURE_SPECS in playwright.config.js: serial, restores).
test.describe.configure({ mode: "serial" });

test.describe("Guest access", () => {
  let adminContext;
  let admin; // an admin page, kept open for setup, checks and teardown
  let previousFeatures;
  let previousBudgeting;
  let partnerA; // the care team guest's partner
  let partnerB; // a partner they are not on the team for
  let tripOne; // the trip leader's trip (on partner C)
  let tripTwo; // a trip they hold no grant for (on partner B)
  let careGuest;
  let leaderGuest;
  const createdPrayerRequests = [];

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext();
    admin = await adminContext.newPage();
    await login(admin);
    previousFeatures = await setFeatures(admin.request, {
      careTeam: true,
      contactLog: true,
      trips: true,
      prayerRequests: true,
      // A held entry is only queued while some channel is on.
      outboundEmail: true,
    });
    const tripSettings = await (await admin.request.get("/api/settings/trips")).json();
    previousBudgeting = tripSettings.enableTripBudgeting;
    await admin.request.put("/api/settings/trips", { data: { enableTripBudgeting: true } });

    const res = await admin.request.get("/api/partners?restricted=false&archived=false");
    const partners = await res.json();
    const [a, b, c] = Array.isArray(partners) ? partners : partners.partners;
    expect(c, "expected at least three seeded non-restricted, non-archived partners").toBeTruthy();
    partnerA = a;
    partnerB = b;

    const makeTrip = async (partnerId, startDate, endDate) => {
      const created = await admin.request.post("/api/trips", {
        data: {
          partnerId,
          status: "accepting_applications",
          isPublic: false,
          type: "Construction",
          startDate,
          endDate,
        },
      });
      expect(created.ok(), `creating a trip: ${created.status()} ${await created.text()}`).toBeTruthy();
      return created.json();
    };
    tripOne = await makeTrip(c.id, "2027-10-01", "2027-10-10");
    tripTwo = await makeTrip(partnerB.id, "2027-11-01", "2027-11-10");

    careGuest = await createGuest(browser, admin, { suffix: "care", careTeam: [{ partnerId: partnerA.id }] });
    leaderGuest = await createGuest(browser, admin, {
      suffix: "leader",
      tripAccess: [{ tripId: tripOne.id }],
    });
  });

  test.afterAll(async () => {
    for (const id of createdPrayerRequests) await admin.request.delete(`/api/prayer-requests/${id}`);
    for (const guest of [careGuest, leaderGuest]) {
      if (guest) await admin.request.delete(`/api/users/${guest.user.id}`);
    }
    for (const trip of [tripOne, tripTwo]) {
      if (trip) await admin.request.delete(`/api/trips/${trip.id}`);
    }
    if (previousBudgeting !== undefined) {
      await admin.request.put("/api/settings/trips", { data: { enableTripBudgeting: previousBudgeting } });
    }
    await restoreFeatures(admin.request, previousFeatures);
    await adminContext.close();
  });

  // A page signed in as the guest.
  async function asGuest(browser, guest) {
    const context = await browser.newContext({ storageState: guest.storageState });
    return { context, page: await context.newPage() };
  }

  test.describe("a care team member", () => {
    test("lands on one plain Partners list with only their partner, and no tabs", async ({ browser }) => {
      const { context, page } = await asGuest(browser, careGuest);
      await page.goto("/admin/partners");
      await page.waitForSelector("table tbody tr");
      const rows = page.locator("table tbody tr");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(partnerA.displayName);
      await expect(page.locator("table")).not.toContainText(partnerB.displayName);
      await expect(page.getByRole("tab")).toHaveCount(0);
      await context.close();
    });

    test("opens their own partner, and is told they have no access to another", async ({ browser }) => {
      const { context, page } = await asGuest(browser, careGuest);
      await page.goto(`/admin/partners/${partnerA.id}`);
      await expect(page.getByRole("heading", { name: partnerA.displayName })).toBeVisible();

      await page.goto(`/admin/partners/${partnerB.id}`);
      await expect(page.getByText("You don't have access to this partner.")).toBeVisible();
      await expect(page.getByRole("link", { name: /Back to Partners/ })).toBeVisible();
      await context.close();
    });

    test("has no Settings, and is sent away from the settings pages", async ({ browser }) => {
      const { context, page } = await asGuest(browser, careGuest);
      await page.goto("/admin/partners");
      await page.waitForSelector("table tbody tr");
      await expect(page.locator(".admin-sidebar").getByText("Settings")).toHaveCount(0);
      await page.goto("/admin/settings");
      await page.waitForLoadState("networkidle");
      expect(page.url()).not.toContain("/admin/settings");
      await context.close();
    });

    test("cannot read monthly support, church settings, users or another partner's records", async ({
      browser,
    }) => {
      const { context, page } = await asGuest(browser, careGuest);
      const status = async (path) => (await page.request.get(path)).status();
      expect(await status(`/api/support-entries?partnerId=${partnerA.id}`), "monthly support").toBe(403);
      expect(await status("/api/settings/trips"), "trip settings").toBe(403);
      expect(await status("/api/users"), "the user list").toBe(403);
      expect(await status("/api/dispatches/pending"), "the pending dispatch queue").toBe(403);
      expect(await status(`/api/partners/${partnerB.id}`), "another partner").toBe(403);

      const list = await (await page.request.get("/api/partners")).json();
      const ids = (Array.isArray(list) ? list : list.partners).map((p) => p.id);
      expect(ids, "the partner list holds only their partner").toEqual([partnerA.id]);
      await context.close();
    });

    test("can edit their own partner's profile but not another's", async ({ browser }) => {
      const { context, page } = await asGuest(browser, careGuest);
      const own = await (await page.request.get(`/api/partners/${partnerA.id}`)).json();
      const sameOverview = { overview: own.overview ?? "" };
      expect((await page.request.put(`/api/partners/${partnerA.id}`, { data: sameOverview })).status()).toBe(
        200
      );
      expect((await page.request.put(`/api/partners/${partnerB.id}`, { data: sameOverview })).status()).toBe(
        403
      );
      expect((await page.request.delete(`/api/partners/${partnerA.id}`)).status(), "never delete").toBe(403);
      await context.close();
    });

    test("what they enter is held for staff review, and only for their own partner", async ({ browser }) => {
      const { context, page } = await asGuest(browser, careGuest);
      const text = `E2E guest prayer ${Date.now()}`;
      const body = (partnerId) => ({
        partnerId,
        category: "strategic",
        requestText: text,
        dateReceived: "2026-11-01",
      });
      const created = await page.request.post("/api/prayer-requests", { data: body(partnerA.id) });
      expect(created.status()).toBe(201);
      createdPrayerRequests.push((await created.json()).id);
      expect((await page.request.post("/api/prayer-requests", { data: body(partnerB.id) })).status()).toBe(
        403
      );

      // Staff see it waiting, flagged as held because a care team member entered it.
      const pending = await (await admin.request.get("/api/dispatches/pending")).json();
      const held = pending.find((item) => String(item.bodyText).includes(text));
      expect(held, "the entry shows in Updates to share").toBeTruthy();
      expect(held.reviewRequired, "held for review because a care team member entered it").toBe(true);
      await context.close();
    });

    test("cannot decide a one-time need", async ({ browser }) => {
      const { context, page } = await asGuest(browser, careGuest);
      const created = await page.request.post("/api/support-needs", {
        data: {
          partnerId: partnerA.id,
          description: `E2E guest need ${Date.now()}`,
          requestedAmount: 100,
          requestDate: "2026-11-01",
          // Fields only staff may set: ignored for a care team member, never applied.
          approvedAmount: 100,
          approvedDate: "2026-11-02",
        },
      });
      expect(created.status()).toBe(201);
      const need = await created.json();
      try {
        expect(need.approvedAmount, "a guest's entry is created undecided").toBeNull();
        const decided = await page.request.put(`/api/support-needs/${need.id}`, {
          data: { approvedAmount: 100, approvedDate: "2026-11-02" },
        });
        expect([200, 400, 403], "a decision from a guest is refused or ignored").toContain(decided.status());
        const after = await (await admin.request.get(`/api/support-needs?partnerId=${partnerA.id}`)).json();
        expect(after.find((n) => n.id === need.id)?.approvedAmount, "still undecided").toBeNull();
      } finally {
        await admin.request.delete(`/api/support-needs/${need.id}`);
      }
      await context.close();
    });
  });

  test.describe("a trip leader", () => {
    test("sees only the trip they were given", async ({ browser }) => {
      const { context, page } = await asGuest(browser, leaderGuest);
      const trips = await (await page.request.get("/api/trips")).json();
      const ids = (Array.isArray(trips) ? trips : trips.trips).map((t) => t.id);
      expect(ids).toEqual([tripOne.id]);

      await page.goto(`/admin/trips/${tripOne.id}`);
      await expect(page.getByRole("link", { name: "Team" })).toBeVisible();
      await page.goto(`/admin/trips/${tripTwo.id}`);
      // Not a dead end: a guest is sent to the trip they do hold, with a note saying why.
      await expect(page.getByRole("alert")).toContainText("You don't have access to that page");
      await expect(page).toHaveURL(new RegExp(`/admin/trips/${tripOne.id}$`));
      await context.close();
    });

    test("sees the Financial tab when budgeting is on, without reading the closed trip settings", async ({
      browser,
    }) => {
      const { context, page } = await asGuest(browser, leaderGuest);
      const settingsStatuses = [];
      page.on("response", (response) => {
        if (response.url().includes("/api/settings/trips"))
          settingsStatuses.push(
            `${response.status()} ${response.url()} from ${response.request().frame()?.url()}`
          );
      });
      await page.goto(`/admin/trips/${tripOne.id}`);
      await expect(page.getByRole("link", { name: "Financial" })).toBeVisible();
      expect(settingsStatuses, "the church-wide trip settings are never requested as a guest").toEqual([]);
      await context.close();
    });

    test("reaches their trip's partner read-only, and nothing else of the church's", async ({ browser }) => {
      const { context, page } = await asGuest(browser, leaderGuest);
      const tripPartnerId = tripOne.partnerId;
      expect((await page.request.get(`/api/partners/${tripPartnerId}`)).status()).toBe(200);
      expect(
        (await page.request.put(`/api/partners/${tripPartnerId}`, { data: { overview: "x" } })).status()
      ).toBe(403);
      expect((await page.request.get(`/api/partners/${partnerA.id}`)).status()).toBe(403);
      // One-time needs are a care team view: a trip leader gets none, and is refused a partner's by id.
      expect((await page.request.get(`/api/support-needs?partnerId=${tripPartnerId}`)).status()).toBe(403);
      expect(await (await page.request.get("/api/support-needs")).json(), "no needs at all").toEqual([]);
      expect((await page.request.get("/api/settings/trips")).status()).toBe(403);
      await context.close();
    });
  });
});
