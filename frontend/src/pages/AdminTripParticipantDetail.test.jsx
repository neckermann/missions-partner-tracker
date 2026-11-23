import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminTripParticipantDetail from "./AdminTripParticipantDetail.jsx";
import { fetchTrip, fetchTripsSettings } from "../api/client.js";

// useParams() only resolves params from an actual matched <Route>; rather
// than wire up a full <Routes> tree just for that, override it directly and
// keep every other react-router-dom export (Link, MemoryRouter) real.
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ tripId: "trip-1", participantId: "participant-1" }),
  };
});

// #309: TripParticipant.isLeader (a plain roster flag) used to show as
// "Trip Leader: Yes/No" right next to "Resend access link" -- easy to misread
// as portal access, since User.role "tripLeader" is a wholly separate scoped
// login with no relation to this field. The label is now "Team Leader" (no
// collision with that role's name) and the read-only value is a StatusPill
// rather than plain text, matching STYLE-GUIDE.md's status/kind convention.
vi.mock("../api/client.js", () => ({
  fetchTrip: vi.fn(),
  fetchTripsSettings: vi.fn(),
  generateSupportRaisingLink: vi.fn(),
  resendParticipantAccessLink: vi.fn(),
  uploadTripDocument: vi.fn(),
  deleteTripDocument: vi.fn(),
  setTripRequirementComplete: vi.fn(),
  updateTripParticipant: vi.fn(),
  tripParticipantPhotoUrl: vi.fn(),
}));
vi.mock("../hooks/useConfirmDialog.jsx", () => ({
  default: () => ({ confirm: vi.fn(), confirmElement: null }),
}));
vi.mock("../hooks/useCurrentUser.js", () => ({
  default: () => ({ canWrite: true, isTripLeader: false, scopedTripId: null }),
}));

const PARTICIPANT = {
  id: "participant-1",
  firstName: "Jamie",
  lastName: "Rivera",
  email: "jamie@example.com",
  phone: "555-0100",
  role: "Construction",
  isLeader: true,
};

const TRIP = {
  id: "trip-1",
  name: "Summer Build Trip",
  status: "accepting_applications",
  startDate: "2027-06-01",
  partner: { id: "partner-1", displayName: "Example Partner" },
  participants: [PARTICIPANT],
  documents: [],
  contributions: [],
  requirements: [],
  applicationQuestions: [],
};

const SETTINGS = {
  collectApplicantAddress: false,
  collectEmergencyContact: false,
  tripApplicationTemplate: [],
  allowPublicSupportRaisingLinks: false,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/trips/trip-1/participants/participant-1"]}>
      <AdminTripParticipantDetail />
    </MemoryRouter>
  );
}

describe("AdminTripParticipantDetail -- Team Leader field (#309)", () => {
  it("shows the renamed label and a StatusPill instead of plain Yes/No text", async () => {
    fetchTrip.mockResolvedValue(TRIP);
    fetchTripsSettings.mockResolvedValue(SETTINGS);

    renderPage();

    await waitFor(() => expect(screen.getByText("Team Leader")).toBeInTheDocument());

    // Renamed away from "Trip Leader" -- that name now refers only to the
    // User.role "tripLeader" scoped guest login, never to this roster flag.
    expect(screen.queryByText("Trip Leader")).not.toBeInTheDocument();

    // Read-only value renders as a StatusPill (a styled pill span), not bare text.
    const pill = screen.getByText("Yes");
    expect(pill.tagName).toBe("SPAN");
    expect(pill).toHaveStyle({ borderRadius: "999px" });
  });

  it("shows the StatusPill in its 'No' state for a non-leader participant", async () => {
    fetchTrip.mockResolvedValue({
      ...TRIP,
      participants: [{ ...PARTICIPANT, isLeader: false }],
    });
    fetchTripsSettings.mockResolvedValue(SETTINGS);

    renderPage();

    await waitFor(() => expect(screen.getByText("Team Leader")).toBeInTheDocument());
    const pill = screen.getByText("No");
    expect(pill.tagName).toBe("SPAN");
    expect(pill).toHaveStyle({ borderRadius: "999px" });
  });
});
