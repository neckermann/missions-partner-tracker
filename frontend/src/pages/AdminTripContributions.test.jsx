import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminTripContributions from "./AdminTripContributions.jsx";
import { fetchTrips, addTripContribution } from "../api/client.js";
import useCurrentUser from "../hooks/useCurrentUser.js";

// This page is the cross-trip counterpart to AdminTripFinancial.jsx's per-trip contribution
// form: the same addTripContribution(tripId, payload) call, reachable with a Trip selector up
// front. Mocked like AdminTripParticipantDetail.test.jsx mocks this module, plus
// useCurrentUser directly (the page reads no route params). It is a tab inside AdminTrips.jsx
// in the real app but reads no route/outlet context, so it is tested standalone.
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

// The form is a popup, opened from the "+ Log contribution" button.
async function openForm() {
  fireEvent.click(await screen.findByRole("button", { name: "+ Log contribution" }));
  await screen.findByRole("dialog");
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

    await openForm();

    fireEvent.change(screen.getByLabelText("Trip"), { target: { value: "trip-1" } });

    await waitFor(() => expect(screen.getByRole("option", { name: "Jamie Rivera" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Team member"), { target: { value: "participant-1" } });
    fireEvent.change(screen.getByLabelText("Donor name"), { target: { value: "Pat Donor" } });
    fireEvent.change(screen.getByLabelText("Amount ($)"), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText("Received"), { target: { value: "2027-01-15" } });

    fireEvent.click(screen.getByRole("button", { name: "Save and add another" }));

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

    // "Save and add another" keeps the trip, team member, method and date for the next check and
    // clears only who it was from and how much.
    expect(screen.getByLabelText("Trip").value).toBe("trip-1");
    expect(screen.getByLabelText("Team member").value).toBe("participant-1");
    expect(screen.getByLabelText("Received").value).toBe("2027-01-15");
    expect(screen.getByLabelText("Donor name").value).toBe("");
    expect(screen.getByLabelText("Amount ($)").value).toBe("");
  });

  it("closes the popup after a plain Save", async () => {
    addTripContribution.mockResolvedValue({ id: "contrib-new" });

    renderPage();
    await openForm();
    fireEvent.change(screen.getByLabelText("Trip"), { target: { value: "trip-1" } });
    fireEvent.change(screen.getByLabelText("Donor name"), { target: { value: "Pat Donor" } });
    fireEvent.change(screen.getByLabelText("Amount ($)"), { target: { value: "75" } });
    fireEvent.change(screen.getByLabelText("Received"), { target: { value: "2027-01-15" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText(/Logged \$75 from Pat Donor/)).toBeInTheDocument();
  });

  it("shows a friendly error and leaves the form filled in when the save fails", async () => {
    addTripContribution.mockRejectedValue({
      response: { data: { error: "donorName: Invalid input: expected string, received undefined" } },
    });

    renderPage();

    await openForm();
    fireEvent.change(screen.getByLabelText("Trip"), { target: { value: "trip-1" } });
    fireEvent.change(screen.getByLabelText("Donor name"), { target: { value: "Pat Donor" } });
    fireEvent.change(screen.getByLabelText("Amount ($)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Received"), { target: { value: "2027-01-15" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("donorName is required"));
    expect(screen.getByLabelText("Donor name").value).toBe("Pat Donor");
  });
});
