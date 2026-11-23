import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminTripContributions from "./AdminTripContributions.jsx";
import { fetchTrips, addTripContribution } from "../api/client.js";
import useCurrentUser from "../hooks/useCurrentUser.js";

// #272: this page is the cross-trip counterpart to AdminTripFinancial.jsx's
// own per-trip contribution form -- same addTripContribution(tripId, payload)
// call, just reachable with a Trip selector up front. Mocked the same way
// AdminTripParticipantDetail.test.jsx mocks this module, plus
// useCurrentUser directly (not a react-router useParams override -- this
// page reads no route params). Rendered as a tab inside AdminTrips.jsx in
// the real app, but tested standalone here -- it reads no route/outlet
// context of its own, so this is an equivalent render.
vi.mock("../api/client.js", () => ({
  fetchTrips: vi.fn(),
  addTripContribution: vi.fn(),
}));
vi.mock("../hooks/useCurrentUser.js", () => ({
  default: vi.fn(),
}));

const PARTICIPANT = { id: "participant-1", firstName: "Jamie", lastName: "Rivera" };

const TRIP = {
  id: "trip-1",
  name: "Summer Build Trip",
  type: "Construction",
  status: "accepting_applications",
  startDate: "2027-06-01",
  partner: { id: "partner-1", displayName: "Example Partner" },
  participants: [PARTICIPANT],
  contributions: [{ amount: 100 }],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/trips/contributions"]}>
      <AdminTripContributions />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useCurrentUser.mockReturnValue({ canWrite: true, loading: false });
  fetchTrips.mockResolvedValue([TRIP]);
});

describe("AdminTripContributions (#272)", () => {
  it("hides the form for a role without write access", async () => {
    useCurrentUser.mockReturnValue({ canWrite: false, loading: false });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/You don't have permission to log contributions/)).toBeInTheDocument()
    );
  });

  it("populates the Team Member selector from the chosen trip, logs a contribution, and resets the form while keeping the trip selected", async () => {
    addTripContribution.mockResolvedValue({ id: "contrib-new" });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Trip")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Trip"), { target: { value: "trip-1" } });

    await waitFor(() => expect(screen.getByRole("option", { name: "Jamie Rivera" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Team member"), { target: { value: "participant-1" } });
    fireEvent.change(screen.getByLabelText("Donor name"), { target: { value: "Pat Donor" } });
    fireEvent.change(screen.getByLabelText("Amount ($)"), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText("Received"), { target: { value: "2027-01-15" } });

    fireEvent.click(screen.getByRole("button", { name: "+ Log contribution" }));

    await waitFor(() =>
      expect(addTripContribution).toHaveBeenCalledWith("trip-1", {
        participantId: "participant-1",
        donorName: "Pat Donor",
        amount: 250,
        method: "check",
        receivedDate: "2027-01-15",
      })
    );

    // Confirms the page immediately without navigating away, and shows up
    // in the running session log.
    await waitFor(() => expect(screen.getByText(/Logged \$250 from Pat Donor/)).toBeInTheDocument());
    // "Jamie Rivera" now appears twice -- once as the (reset) Team member
    // select's own option, once as the session log row's plain text.
    expect(screen.getByRole("cell", { name: "Jamie Rivera" })).toBeInTheDocument();

    // Trip stays selected (sticky) -- only the entry fields and the
    // participant picker clear, ready for the next check in the stack.
    expect(screen.getByLabelText("Trip").value).toBe("trip-1");
    expect(screen.getByLabelText("Team member").value).toBe("");
    expect(screen.getByLabelText("Donor name").value).toBe("");
    expect(screen.getByLabelText("Amount ($)").value).toBe("");
  });

  it("shows a friendly error and leaves the form filled in when the save fails", async () => {
    addTripContribution.mockRejectedValue({
      response: { data: { error: "donorName: Invalid input: expected string, received undefined" } },
    });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Trip")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Trip"), { target: { value: "trip-1" } });
    fireEvent.change(screen.getByLabelText("Donor name"), { target: { value: "Pat Donor" } });
    fireEvent.change(screen.getByLabelText("Amount ($)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Received"), { target: { value: "2027-01-15" } });

    fireEvent.click(screen.getByRole("button", { name: "+ Log contribution" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("donorName is required"));
    expect(screen.getByLabelText("Donor name").value).toBe("Pat Donor");
  });
});
