import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminTripApplicationDetail from "./AdminTripApplicationDetail.jsx";
import { fetchTrip, fetchTripApplications, fetchTripsSettings } from "../api/client.js";

// A link to an application whose trip is gone (an old bookmark, a tab left open across a
// reset) must not leave this page on "Loading…" for good; and a guest, who can't read the
// church-wide trip settings (403), must not be asked for them.
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useParams: () => ({ tripId: "trip-1", applicationId: "app-1" }) };
});
vi.mock("../api/client.js", () => ({
  fetchTrip: vi.fn(),
  fetchTripApplications: vi.fn(),
  fetchTripsSettings: vi.fn(),
  reviewTripApplication: vi.fn(),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: {}, churchName: "Test Church" }),
}));
let currentUser;
vi.mock("../hooks/useCurrentUser.js", () => ({ default: () => currentUser }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/trips/trip-1/applications/app-1"]}>
      <AdminTripApplicationDetail />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { canWrite: true, isAdmin: true, isGuest: false, canAccessTrip: () => true };
  fetchTrip.mockResolvedValue({ id: "trip-1", name: "Trip", status: "planning", partner: { id: "p1" } });
  fetchTripApplications.mockResolvedValue([]);
  fetchTripsSettings.mockResolvedValue({});
});

describe("AdminTripApplicationDetail -- a trip that can't be loaded", () => {
  it("says the trip wasn't found instead of loading forever (404)", async () => {
    fetchTrip.mockRejectedValue({ response: { status: 404 } });

    renderPage();

    expect(
      await screen.findByText("This application wasn't found. It may have been deleted.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to Trips/ })).toHaveAttribute("href", "/admin/trips");
  });

  it("says there is no access when the trip isn't one the guest holds (403)", async () => {
    currentUser = { canWrite: false, isAdmin: false, isGuest: true, canAccessTrip: () => false };
    fetchTrip.mockRejectedValue({ response: { status: 403 } });

    renderPage();

    expect(await screen.findByText("You don't have access to this application.")).toBeInTheDocument();
  });

  it("does not ask for the closed trip settings as a guest", async () => {
    currentUser = { canWrite: false, isAdmin: false, isGuest: true, canAccessTrip: () => true };

    renderPage();

    await waitFor(() => expect(fetchTrip).toHaveBeenCalled());
    expect(fetchTripsSettings).not.toHaveBeenCalled();
  });

  it("still loads the trip settings for staff", async () => {
    renderPage();

    await waitFor(() => expect(fetchTripsSettings).toHaveBeenCalledTimes(1));
  });
});
