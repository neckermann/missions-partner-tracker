import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import AdminTripWrapUp from "./AdminTripWrapUp.jsx";
import { wrapUpTrip } from "../api/client.js";

// The Wrap up trip wizard: what happened, a debrief, a follow-up contact, loose ends,
// photos, and when leader access ends. Open to staff and a trip leader for their own trip.
vi.mock("../api/client.js", () => ({ wrapUpTrip: vi.fn() }));
let features;
let currentUser;
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: features }),
}));
vi.mock("../hooks/useCurrentUser.js", () => ({ default: () => currentUser }));

const baseTrip = {
  id: "t1",
  name: "Summer build",
  status: "closed",
  startDate: "2026-06-01T00:00:00.000Z",
  endDate: "2026-06-12T00:00:00.000Z",
  partner: { id: "p1", displayName: "Ann & Bob", fieldDisplayName: null },
  participants: [{ id: "a" }, { id: "b" }],
  albumProvider: null,
  albumUrl: null,
  enableTripBudgeting: true,
};

function renderWizard({ trip = baseTrip, canWrite = true, setTrip = vi.fn() } = {}) {
  render(
    <MemoryRouter initialEntries={["/admin/trips/t1/wrap-up"]}>
      <Routes>
        <Route element={<Outlet context={{ trip, setTrip, id: "t1", canWrite }} />}>
          <Route path="/admin/trips/t1/wrap-up" element={<AdminTripWrapUp />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
  return { setTrip };
}

const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
const skip = () => fireEvent.click(screen.getByRole("button", { name: "Skip" }));

beforeEach(() => {
  vi.clearAllMocks();
  features = { contactLog: true };
  currentUser = { isGuest: false, isOnCareTeamFor: () => false };
  wrapUpTrip.mockResolvedValue({
    trip: { ...baseTrip, status: "completed", wrappedUpAt: "2026-06-13T00:00:00Z" },
    contactLogged: true,
  });
});

describe("AdminTripWrapUp", () => {
  it("walks through the steps and saves the dates, the debrief and the follow-up contact", async () => {
    const { setTrip } = renderWizard();
    // 1. What happened: the dates are prefilled, and the team size shown.
    expect(screen.getByLabelText("Actual start")).toHaveValue("2026-06-01");
    expect(screen.getByLabelText("Actual end")).toHaveValue("2026-06-12");
    expect(screen.getByText(/2 people are on the team/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Actual end"), { target: { value: "2026-06-14" } });
    next();
    // 2. Debrief.
    fireEvent.change(screen.getByLabelText("What did the team do?"), { target: { value: "Built the roof" } });
    fireEvent.change(screen.getByLabelText("What does the partner need next?"), {
      target: { value: "Cement" },
    });
    next();
    // 3. Follow-up contact (staff, contact log on).
    fireEvent.click(screen.getByLabelText("Log a visit for this trip"));
    fireEvent.change(screen.getByLabelText(/Follow up by/), { target: { value: "2026-07-15" } });
    next();
    // 4. Loose ends, 5. Photos.
    expect(screen.getByRole("link", { name: "Requirements" })).toHaveAttribute(
      "href",
      "/admin/trips/t1/requirements"
    );
    next();
    fireEvent.change(screen.getByLabelText("Album link"), {
      target: { value: "https://photos.example.com/a" },
    });
    next();
    // 6. Access: 30 days after the (new) end date.
    expect(screen.getByText("2026-07-14")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(wrapUpTrip).toHaveBeenCalled());
    const [id, payload] = wrapUpTrip.mock.calls[0];
    expect(id).toBe("t1");
    expect(payload).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-14",
      debrief: { whatWeDid: "Built the roof", wentWell: "", wasHard: "", partnerNeeds: "Cement" },
      albumProvider: "other",
      albumUrl: "https://photos.example.com/a",
      followUp: { logContact: true, followUpDate: "2026-07-15" },
    });
    expect(await screen.findByText("Trip wrapped up")).toBeInTheDocument();
    expect(screen.getByText(/visit was added to the partner's contact log/)).toBeInTheDocument();
    expect(setTrip).toHaveBeenCalled();
  });

  it("won't go past the dates when the end is before the start", () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText("Actual end"), { target: { value: "2026-05-01" } });
    next();
    expect(screen.getByRole("alert")).toHaveTextContent(/end date can't be before the start/);
    // Still on the first step: the debrief prompts haven't appeared.
    expect(screen.queryByLabelText("What did the team do?")).not.toBeInTheDocument();
  });

  it("leaves the follow-up step out when the contact log is off", () => {
    features = { contactLog: false };
    renderWizard();
    next(); // debrief
    skip(); // -> loose ends (no follow-up step in between)
    expect(screen.getByText(/Things still open on this trip/)).toBeInTheDocument();
  });

  it("leaves the follow-up step out for a trip leader with no care team seat on the partner", () => {
    currentUser = { isGuest: true, isOnCareTeamFor: () => false };
    renderWizard();
    next();
    skip();
    expect(screen.getByText(/Things still open on this trip/)).toBeInTheDocument();
  });

  it("keeps it for a guest on the partner's care team", () => {
    currentUser = { isGuest: true, isOnCareTeamFor: (id) => id === "p1" };
    renderWizard();
    next();
    skip();
    expect(screen.getByText(/Add this trip to/)).toBeInTheDocument();
  });

  it("tells a trip leader their own access ends, with no controls to change it", () => {
    currentUser = { isGuest: true, isOnCareTeamFor: () => false };
    renderWizard();
    next(); // -> debrief
    skip(); // -> loose ends (no follow-up step for a leader)
    skip(); // -> photos
    skip(); // -> access
    expect(screen.getByText(/Your access to this trip/)).toBeInTheDocument();
    expect(screen.getByText("2026-07-12")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "the Team tab" })).not.toBeInTheDocument();
  });

  it("shows the server's error and stays on the last step", async () => {
    wrapUpTrip.mockRejectedValue({
      response: { data: { error: "Enter a valid album link for the selected provider" } },
    });
    renderWizard();
    next();
    skip();
    skip();
    skip();
    skip();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/album link/i);
    expect(screen.queryByText("Trip wrapped up")).not.toBeInTheDocument();
  });

  it("says so when you can't wrap this trip up", () => {
    renderWizard({ canWrite: false });
    expect(screen.getByText(/can't wrap up this trip/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Actual start")).not.toBeInTheDocument();
  });

  it("calls it a debrief, and says it was saved, when a wrapped-up trip is edited", async () => {
    const wrapped = {
      ...baseTrip,
      status: "completed",
      wrappedUpAt: "2026-06-13T00:00:00Z",
      debriefWentWell: "Teamwork",
    };
    renderWizard({ trip: wrapped });
    expect(screen.getByRole("heading", { name: "Trip debrief" })).toBeInTheDocument();
    next();
    expect(screen.getByLabelText("What went well?")).toHaveValue("Teamwork");
  });

  it("calls a first wrap-up a wrap-up, even though saving updates the trip to completed", async () => {
    // A stateful stand-in for the layout, whose setTrip really changes the trip the page sees.
    function Layout() {
      const [trip, setTrip] = useState(baseTrip);
      return <Outlet context={{ trip, setTrip, id: "t1", canWrite: true }} />;
    }
    render(
      <MemoryRouter initialEntries={["/admin/trips/t1/wrap-up"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/admin/trips/t1/wrap-up" element={<AdminTripWrapUp />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    next();
    skip();
    skip();
    skip();
    skip();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByText("Trip wrapped up")).toBeInTheDocument();
    expect(screen.queryByText("Debrief saved")).not.toBeInTheDocument();
  });
});
