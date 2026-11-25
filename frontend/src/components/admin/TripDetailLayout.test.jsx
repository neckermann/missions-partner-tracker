import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TripDetailLayout from "./TripDetailLayout.jsx";
import { fetchTrip, fetchTripApplications, fetchTripsSettings } from "../../api/client.js";

// The trip page's Financial tab depends on the church's "trip budgeting" setting. Staff read it
// from the trip settings; a guest can't (that route is 403 for them, #327), so it comes with the
// trip itself and the layout must not ask for the closed settings at all (#370).
vi.mock("../../api/client.js", () => ({
  fetchTrip: vi.fn(),
  fetchTripApplications: vi.fn().mockResolvedValue([]),
  fetchTripsSettings: vi.fn().mockResolvedValue({}),
}));

const user = vi.hoisted(() => ({ current: {} }));
vi.mock("../../hooks/useCurrentUser.js", () => ({ default: () => user.current }));
vi.mock("../../hooks/useRecentlyViewed.js", () => ({ useRecordRecentlyViewed: () => {} }));

const TRIP = {
  id: "t1",
  name: "Summer Trip",
  status: "planning",
  partner: { id: "p1", displayName: "Partner One" },
  participants: [],
};

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/admin/trips/t1"]}>
      <Routes>
        <Route path="/admin/trips/:id" element={<TripDetailLayout />}>
          <Route index element={<div>overview</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("TripDetailLayout: Financial tab (#370)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTripApplications.mockResolvedValue([]);
    fetchTripsSettings.mockResolvedValue({ enableTripBudgeting: true });
  });

  it("shows the Financial tab to a guest when budgeting is on, without reading trip settings", async () => {
    user.current = { isGuest: true, canWrite: false, isAdmin: false, canAccessTrip: () => true };
    fetchTrip.mockResolvedValue({ ...TRIP, enableTripBudgeting: true });

    renderLayout();

    expect(await screen.findByRole("link", { name: "Financial" })).toBeInTheDocument();
    expect(fetchTripsSettings).not.toHaveBeenCalled();
  });

  it("does not ask for the trip settings while the user is still loading, then not at all for a guest", async () => {
    // Until the user loads, isGuest is false for everyone: a guest must not fire the request
    // (and be refused) in that window.
    user.current = {
      loading: true,
      isGuest: false,
      canWrite: false,
      isAdmin: false,
      canAccessTrip: () => false,
    };
    fetchTrip.mockResolvedValue({ ...TRIP, enableTripBudgeting: true });

    const view = renderLayout();
    expect(await screen.findByRole("link", { name: "Financial" })).toBeInTheDocument();
    expect(fetchTripsSettings).not.toHaveBeenCalled();

    // The user then loads, as a guest: still no request.
    user.current = {
      loading: false,
      isGuest: true,
      canWrite: false,
      isAdmin: false,
      canAccessTrip: () => true,
    };
    view.rerender(
      <MemoryRouter initialEntries={["/admin/trips/t1"]}>
        <Routes>
          <Route path="/admin/trips/:id" element={<TripDetailLayout />}>
            <Route index element={<div>overview</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    await screen.findByRole("link", { name: "Financial" });
    expect(fetchTripsSettings).not.toHaveBeenCalled();
  });

  it("hides the Financial tab from a guest when budgeting is off", async () => {
    user.current = { isGuest: true, canWrite: false, isAdmin: false, canAccessTrip: () => true };
    fetchTrip.mockResolvedValue({ ...TRIP, enableTripBudgeting: false });

    renderLayout();

    expect(await screen.findByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Financial" })).not.toBeInTheDocument();
  });

  it("still loads the trip settings for staff, and follows the same flag for the tab", async () => {
    user.current = { isGuest: false, canWrite: true, isAdmin: true, canAccessTrip: () => true };
    fetchTrip.mockResolvedValue({ ...TRIP, enableTripBudgeting: true });

    renderLayout();

    expect(await screen.findByRole("link", { name: "Financial" })).toBeInTheDocument();
    expect(fetchTripsSettings).toHaveBeenCalledTimes(1);
  });
});

describe("TripDetailLayout: a trip that can't be loaded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTripApplications.mockResolvedValue([]);
    fetchTripsSettings.mockResolvedValue({});
    user.current = { isGuest: false, canWrite: true, isAdmin: true, canAccessTrip: () => true };
  });

  it("says the trip wasn't found instead of loading forever (404)", async () => {
    fetchTrip.mockRejectedValue({ response: { status: 404 } });

    renderLayout();

    expect(await screen.findByText("This trip wasn't found. It may have been deleted.")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("says there is no access when the trip isn't one the guest holds (403)", async () => {
    user.current = { isGuest: true, canWrite: false, isAdmin: false, canAccessTrip: () => false };
    fetchTrip.mockRejectedValue({ response: { status: 403 } });

    renderLayout();

    expect(await screen.findByText("You don't have access to this trip.")).toBeInTheDocument();
  });
});

describe("TripDetailLayout: Wrap up trip (#358)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTripApplications.mockResolvedValue([]);
    fetchTripsSettings.mockResolvedValue({});
  });

  it("offers Wrap up trip to someone who can write an open trip, linking to the wizard", async () => {
    user.current = { isGuest: false, canWrite: true, isAdmin: true, canAccessTrip: () => true };
    fetchTrip.mockResolvedValue({ ...TRIP, status: "closed" });
    renderLayout();
    const link = await screen.findByRole("link", { name: "Wrap up trip" });
    expect(link).toHaveAttribute("href", "/admin/trips/t1/wrap-up");
  });

  it("offers it to a trip leader for their own trip", async () => {
    user.current = { isGuest: true, canWrite: false, isAdmin: false, canAccessTrip: () => true };
    fetchTrip.mockResolvedValue({ ...TRIP, status: "closed" });
    renderLayout();
    expect(await screen.findByRole("link", { name: "Wrap up trip" })).toBeInTheDocument();
  });

  it("does not offer it once the trip is completed, or to someone who can't write it", async () => {
    user.current = { isGuest: false, canWrite: true, isAdmin: true, canAccessTrip: () => true };
    fetchTrip.mockResolvedValue({ ...TRIP, status: "completed" });
    const first = renderLayout();
    await screen.findByRole("heading", { name: "Summer Trip" });
    expect(screen.queryByRole("link", { name: "Wrap up trip" })).not.toBeInTheDocument();
    first.unmount();

    user.current = { isGuest: true, canWrite: false, isAdmin: false, canAccessTrip: () => false };
    fetchTrip.mockResolvedValue({ ...TRIP, status: "closed" });
    renderLayout();
    await screen.findByRole("heading", { name: "Summer Trip" });
    expect(screen.queryByRole("link", { name: "Wrap up trip" })).not.toBeInTheDocument();
  });
});
