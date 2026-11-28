import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AdminPrayerSheet, { nextSunday } from "./AdminPrayerSheet.jsx";
import { fetchPrayerSheet } from "../api/client.js";

// The Sunday prayer sheet page: the printable sheet, the choice of how often a sheet is made, and the slide view.
// The server decides who and what may appear (backend/test/routes/prayerSheet.test.js); this lays it out.
vi.mock("../api/client.js", () => ({ fetchPrayerSheet: vi.fn() }));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ churchName: "Grace Church", partnerTermPlural: "Missionaries" }),
}));

const sheet = (over = {}) => ({
  date: "2026-12-06",
  cadence: "weekly",
  group: { index: 1, count: 4 },
  totalPartners: 8,
  partners: [
    {
      id: "p1",
      displayName: "The Reeds",
      country: "Kenya",
      requests: [
        { id: "r1", text: "Pray for the new clinic." },
        { id: "r2", text: "Wisdom for the team." },
      ],
      moreRequests: 0,
    },
    {
      id: "p2",
      displayName: "Bridge Ministry",
      country: null,
      requests: [{ id: "r3", text: "Open doors." }],
      moreRequests: 0,
    },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  fetchPrayerSheet.mockResolvedValue(sheet());
});

describe("nextSunday", () => {
  it("is the coming Sunday, or today when today is one", () => {
    expect(nextSunday("2026-11-27")).toBe("2026-11-29"); // a Friday
    expect(nextSunday("2026-11-29")).toBe("2026-11-29"); // a Sunday
    expect(nextSunday("2026-11-28")).toBe("2026-11-29"); // a Saturday
    expect(nextSunday("2026-11-30")).toBe("2026-12-06"); // a Monday
    expect(nextSunday("2026-12-30")).toBe("2027-01-03"); // across a year end
  });
});

describe("AdminPrayerSheet", () => {
  it("lays out the church, the date, each partner and its requests, and says how much of the whole it is", async () => {
    render(<AdminPrayerSheet />);
    const page = await screen.findByLabelText("Prayer Sheet", { selector: "article" });
    expect(within(page).getByText("Grace Church")).toBeTruthy();
    expect(
      within(page).getByRole("heading", { level: 1, name: "Praying for our Missionaries" })
    ).toBeTruthy();
    expect(within(page).getByText(/The Reeds/)).toBeTruthy();
    expect(within(page).getByText(/Kenya/)).toBeTruthy();
    expect(within(page).getByText("Pray for the new clinic.")).toBeTruthy();
    expect(within(page).getByText("Open doors.")).toBeTruthy();
    expect(within(page).getByText(/2 of 8 missionaries/)).toBeTruthy();
  });

  it("asks the server for the Sunday coming, weekly, to begin with", async () => {
    render(<AdminPrayerSheet />);
    await waitFor(() => expect(fetchPrayerSheet).toHaveBeenCalled());
    expect(fetchPrayerSheet).toHaveBeenCalledWith({ date: nextSunday(), cadence: "weekly" });
  });

  it("asks again when the rhythm changes, and remembers the choice", async () => {
    render(<AdminPrayerSheet />);
    await waitFor(() => expect(fetchPrayerSheet).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Make a sheet"), { target: { value: "biweekly" } });
    await waitFor(() =>
      expect(fetchPrayerSheet).toHaveBeenLastCalledWith({ date: nextSunday(), cadence: "biweekly" })
    );
    expect(window.localStorage.getItem("prayerSheetCadence")).toBe("biweekly");
    expect(screen.getByText(/half of our partners on each sheet/)).toBeTruthy();
  });

  it("starts on the remembered rhythm", async () => {
    window.localStorage.setItem("prayerSheetCadence", "monthly");
    render(<AdminPrayerSheet />);
    await waitFor(() =>
      expect(fetchPrayerSheet).toHaveBeenCalledWith({ date: nextSunday(), cadence: "monthly" })
    );
    expect(screen.getByLabelText("Make a sheet").value).toBe("monthly");
  });

  it("asks again for another Sunday", async () => {
    render(<AdminPrayerSheet />);
    await waitFor(() => expect(fetchPrayerSheet).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("For the Sunday of"), { target: { value: "2027-01-10" } });
    await waitFor(() =>
      expect(fetchPrayerSheet).toHaveBeenLastCalledWith({ date: "2027-01-10", cadence: "weekly" })
    );
  });

  it("prints from the Print button", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<AdminPrayerSheet />);
    await screen.findByText("The Reeds", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("says so, and offers nothing to print, when there is nothing to pray for", async () => {
    fetchPrayerSheet.mockResolvedValue(sheet({ partners: [], totalPartners: 0 }));
    render(<AdminPrayerSheet />);
    expect(await screen.findByText(/Nothing to pray for on this sheet yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Show as slides" }).disabled).toBe(true);
  });

  it("shows a plain message when the sheet cannot be loaded", async () => {
    fetchPrayerSheet.mockRejectedValue(new Error("boom"));
    render(<AdminPrayerSheet />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't load the prayer sheet/);
  });
});

describe("the slide view", () => {
  async function openSlides() {
    render(<AdminPrayerSheet />);
    await screen.findByText("The Reeds", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: "Show as slides" }));
    return screen.getByRole("dialog", { name: "Prayer slides" });
  }

  it("shows one partner at a time, with Next and Previous", async () => {
    const slides = await openSlides();
    expect(within(slides).getByText(/The Reeds/)).toBeTruthy();
    expect(within(slides).getByText("1 of 2")).toBeTruthy();
    expect(within(slides).getByRole("button", { name: "Previous" }).disabled).toBe(true);
    fireEvent.click(within(slides).getByRole("button", { name: "Next" }));
    expect(within(slides).getByText(/Bridge Ministry/)).toBeTruthy();
    expect(within(slides).getByText("Open doors.")).toBeTruthy();
    expect(within(slides).getByRole("button", { name: "Next" }).disabled).toBe(true);
    fireEvent.click(within(slides).getByRole("button", { name: "Previous" }));
    expect(within(slides).getByText(/The Reeds/)).toBeTruthy();
  });

  it("moves with the arrow keys and closes with Escape", async () => {
    const slides = await openSlides();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(slides).getByText(/Bridge Ministry/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(slides).getByText("2 of 2")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(within(slides).getByText("1 of 2")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Prayer slides" })).toBeNull();
  });

  it("closes from the Close button", async () => {
    const slides = await openSlides();
    fireEvent.click(within(slides).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Prayer slides" })).toBeNull();
  });
});
