import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login } from "./helpers.js";

// Reports are read-only views over data that already exists, so the things
// worth checking in a browser are the ones the route tests can't see: that
// the picker renders a filter form from what the server declares, that
// running one puts rows on screen, and that the page survives a report
// returning nothing.
//
// The Report and Month <select> elements are looked up by role, not by
// getByLabel, and that distinction is load-bearing. Every field here is
// written as <label>{field.label}<select>{options}</select></label>
// (AdminReports.jsx), and getByLabel's exact matching compares against
// that <label>'s raw textContent -- which, for a <select>, DOM-level
// textContent recursively includes every <option>'s text too, with no
// separating whitespace. So the real exact text of the Report label is
// "ReportUpcoming BirthdaysOne-Time Needs..." (every option concatenated),
// never just "Report" -- getByLabel("Report", { exact: true }) always
// matches nothing, not even the element it's named for. Confirmed
// directly: a non-exact getByLabel("Report") matched 1 element (substring
// luck, since "Report" is a prefix of that polluted string); the exact
// variant matched 0; getByRole("combobox", { name: "Report", exact: true})
// matched exactly 1, because getByRole reads the true computed ARIA
// accessible name (confirmed against the page's own accessibility tree),
// which correctly resolves to just "Report". That's also why this bit at
// all: adding "Monthly Support" as a fifth report option made "Month" a
// substring of the (already-polluted) Report label's text, so the old
// non-exact getByLabel("Month") started ambiguously matching both
// selects. getByRole sidesteps the whole class of bug rather than papering
// over this one instance of it.
//
// getByLabel stays, unmodified, for the plain inputs and the checkbox --
// those have no descendant option text to pollute their label's
// textContent, so substring matching never collided and never will.

const FAILING_IMPACTS = ["serious", "critical"];

function summarize(violations) {
  return violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) -- ${v.helpUrl}`)
    .join("\n");
}

test.describe("Reports", () => {
  test("picks a report, runs it, and shows rows with the report's own columns", async ({ page }) => {
    await login(page);

    // Its own throwaway partner, deleted in the finally.
    //
    // The first version of this test appended an adult to whichever partner
    // sorted first in the seed. That mutates a fixture every other spec
    // shares, and it accumulates: by the third run the report had three
    // "E2E March Adult" rows and the locator blew up on strict mode. The
    // same lesson as the MFA spec, which used to enrol the shared admin.
    const marker = `[e2e-report-${Date.now()}]`;
    const created = await page.request.post("/api/partners", {
      data: {
        kind: "missionary",
        displayName: `${marker} Report Family`,
        adults: [{ name: `${marker} Adult`, birthday: "1985-03-11" }],
        children: [{ name: `${marker} Child`, birthday: "2015-03-02" }],
      },
    });
    expect(created.status(), "seeding the fixture partner should succeed").toBe(201);
    const partnerId = (await created.json()).id;

    try {
      await page.goto("/admin/reports");
      await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();

      await page.getByRole("combobox", { name: "Report", exact: true }).selectOption("upcoming-birthdays");
      // Upcoming Birthdays defaults to the full-year view, where the Month
      // control is hidden (showWhen in the report's own field declaration --
      // see AdminReports.jsx). Switching View to "One month" reveals it.
      await page.getByRole("combobox", { name: "View", exact: true }).selectOption("month");
      // The month control is rendered from the server's field declaration,
      // not hardcoded here -- if the registry stops shipping `fields`, this
      // fails.
      await page.getByRole("combobox", { name: "Month", exact: true }).selectOption("3");
      await page.getByRole("button", { name: "Run report" }).click();

      const adultRow = page.locator("tr", { hasText: `${marker} Adult` });
      await expect(adultRow).toBeVisible();
      await expect(adultRow).toContainText("Adult");

      // Adults and children are interleaved in one list, by design.
      const childRow = page.locator("tr", { hasText: `${marker} Child` });
      await expect(childRow).toBeVisible();
      await expect(childRow).toContainText("Child");

      // Column headings come from the report, so this also pins that the
      // server's `columns` reached the table.
      await expect(page.getByRole("columnheader", { name: "Partner" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Adult/Child" })).toBeVisible();
    } finally {
      await page.request.delete(`/api/partners/${partnerId}`);
    }
  });

  test("a report with no matches says so instead of rendering an empty table", async ({ page }) => {
    await login(page);
    await page.goto("/admin/reports");

    await page.getByRole("combobox", { name: "Report", exact: true }).selectOption("one-time-needs");
    // A window that cannot contain anything.
    await page.getByLabel("Requested on or after", { exact: true }).fill("2099-01-01");
    await page.getByRole("button", { name: "Run report" }).click();

    await expect(page.getByText("Nothing matched those filters.")).toBeVisible();
  });

  test("switching reports clears the previous result rather than relabelling it", async ({ page }) => {
    await login(page);
    await page.goto("/admin/reports");

    await page.getByRole("combobox", { name: "Report", exact: true }).selectOption("upcoming-birthdays");
    await page.getByRole("button", { name: "Run report" }).click();
    await expect(page.locator("table.admin-table")).toBeVisible();

    // Rows from the old report under the new report's columns would be
    // nonsense, and worse, would look authoritative.
    await page.getByRole("combobox", { name: "Report", exact: true }).selectOption("one-time-needs");
    await expect(page.locator("table.admin-table")).toHaveCount(0);
  });

  test("has no serious/critical accessibility violations once a report is rendered", async ({ page }) => {
    await login(page);
    await page.goto("/admin/reports");
    await page.getByRole("combobox", { name: "Report", exact: true }).selectOption("upcoming-birthdays");
    await page.getByRole("button", { name: "Run report" }).click();
    await expect(page.locator(".report-output")).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => FAILING_IMPACTS.includes(v.impact));
    expect(serious, summarize(serious)).toEqual([]);
  });

  // Smoke coverage for the three reports added alongside Upcoming Birthdays
  // and One-Time Needs: each is reachable from the picker, renders its own
  // filter fields, and produces rows against the seeded data. The shared
  // mechanics (CSV, print, the shell's error states) are already covered
  // above and in report-print.spec.js against upcoming-birthdays --
  // exercising them a second time per report would test the shell again,
  // not the report.
  for (const { id, label, rowText } of [
    { id: "prayer-requests", label: "Prayer Requests", rowText: "Category" },
    { id: "trip-history", label: "Trip History", rowText: "Team Size" },
    { id: "monthly-support", label: "Monthly Support", rowText: "Current Amount" },
  ]) {
    test(`${label} runs and shows its own columns`, async ({ page }) => {
      await login(page);
      await page.goto("/admin/reports");

      await page.getByRole("combobox", { name: "Report", exact: true }).selectOption(id);
      await page.getByRole("button", { name: "Run report" }).click();

      await expect(page.getByRole("columnheader", { name: rowText })).toBeVisible();
      // The seed produces plenty of rows for all three; a report that ran
      // but found nothing would point at the query, not the UI, and
      // deserves its own look rather than a green check here.
      await expect(page.locator("table.admin-table tbody tr").first()).toBeVisible();
    });
  }
});
