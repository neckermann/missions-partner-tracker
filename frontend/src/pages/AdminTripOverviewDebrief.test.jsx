import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import AdminTripOverview from "./AdminTripOverview.jsx";

// The debrief a team wrote when the trip was wrapped up shows on the trip's overview.
vi.mock("../api/client.js", () => ({ updateTrip: vi.fn() }));

const trip = (extra = {}) => ({
  id: "t1",
  name: "Summer build",
  status: "completed",
  budgetLines: [],
  ...extra,
});

function renderOverview(t, canWrite = true) {
  render(
    <MemoryRouter initialEntries={["/admin/trips/t1"]}>
      <Routes>
        <Route
          element={<Outlet context={{ trip: t, setTrip: vi.fn(), enableTripBudgeting: false, canWrite }} />}
        >
          <Route path="/admin/trips/t1" element={<AdminTripOverview />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("Trip overview: the debrief (#358)", () => {
  it("shows each prompt the team answered, and when it was wrapped up, with a way to edit it", () => {
    renderOverview(
      trip({
        wrappedUpAt: "2026-06-13T00:00:00.000Z",
        debriefWhatWeDid: "Built the roof",
        debriefPartnerNeeds: "More cement",
      })
    );
    expect(screen.getByRole("heading", { name: "Debrief" })).toBeInTheDocument();
    expect(screen.getByText("What did the team do?")).toBeInTheDocument();
    expect(screen.getByText("Built the roof")).toBeInTheDocument();
    expect(screen.getByText("More cement")).toBeInTheDocument();
    expect(screen.getByText(/Wrapped up/)).toBeInTheDocument();
    // A prompt nobody answered isn't listed.
    expect(screen.queryByText("What was hard?")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit debrief" })).toHaveAttribute(
      "href",
      "/admin/trips/t1/wrap-up"
    );
  });

  it("shows nothing for a trip with no debrief, and no edit link to someone who can't write it", () => {
    renderOverview(trip());
    expect(screen.queryByRole("heading", { name: "Debrief" })).not.toBeInTheDocument();
  });

  it("hides the edit link from someone who can only read", () => {
    renderOverview(trip({ debriefWentWell: "Teamwork" }), false);
    expect(screen.getByText("Teamwork")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit debrief" })).not.toBeInTheDocument();
  });
});
