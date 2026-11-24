import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminTripParticipantDetail from "./AdminTripParticipantDetail.jsx";
import { fetchTrip, fetchTripsSettings, createUser } from "../api/client.js";

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

// #356: the roster's "Team Leader" checkbox is gone -- who leads a trip is
// now decided by who holds a guest grant for it, which the trip's Guest
// access section and this page's "Give guest access" action manage. #309
// had renamed the flag to avoid confusing it with the old tripLeader login;
// removing it ends that confusion for good.
vi.mock("../api/client.js", () => ({
  fetchTrip: vi.fn(),
  fetchTripsSettings: vi.fn(),
  generateSupportRaisingLink: vi.fn(),
  resendParticipantAccessLink: vi.fn(),
  uploadTripDocument: vi.fn(),
  deleteTripDocument: vi.fn(),
  setTripRequirementComplete: vi.fn(),
  updateTripParticipant: vi.fn(),
  createUser: vi.fn(),
  tripParticipantPhotoUrl: vi.fn(),
}));
vi.mock("../hooks/useConfirmDialog.jsx", () => ({
  default: () => ({ confirm: vi.fn(), confirmElement: null }),
}));
let currentUser;
vi.mock("../hooks/useCurrentUser.js", () => ({
  default: () => currentUser,
}));

const PARTICIPANT = {
  id: "participant-1",
  firstName: "Jamie",
  lastName: "Rivera",
  email: "jamie@example.com",
  phone: "555-0100",
  role: "Construction",
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

beforeEach(() => {
  currentUser = { canWrite: true, isAdmin: true, isGuest: false, canAccessTrip: () => false };
  fetchTrip.mockResolvedValue(TRIP);
  fetchTripsSettings.mockResolvedValue(SETTINGS);
  createUser.mockReset();
});

describe("AdminTripParticipantDetail -- guest access (#356)", () => {
  it("no longer shows a Team Leader field, even for a participant flagged as one in old data", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Construction")).toBeInTheDocument());
    expect(screen.queryByText("Team Leader")).not.toBeInTheDocument();
  });

  it("offers Give guest access to an admin, prefilled from the participant", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Give guest access", { selector: "button" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Email")).toHaveValue("jamie@example.com");
    expect(within(dialog).getByLabelText("First name")).toHaveValue("Jamie");
  });

  it("creates a guest login scoped to just this trip", async () => {
    createUser.mockResolvedValue({ email: "jamie@example.com", welcomeEmail: { sent: true } });
    renderPage();

    fireEvent.click(await screen.findByText("Give guest access", { selector: "button" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1));
    expect(createUser).toHaveBeenCalledWith({
      email: "jamie@example.com",
      firstName: "Jamie",
      lastName: "Rivera",
      role: "guest",
      tripAccess: [{ tripId: "trip-1" }],
      sendWelcomeEmail: true,
    });
  });

  it("hides Give guest access from an editor -- only an admin manages logins", async () => {
    currentUser = { canWrite: true, isAdmin: false, isGuest: false, canAccessTrip: () => false };
    renderPage();

    await screen.findByText("Resend access link", { selector: "button" });
    expect(screen.queryByText("Give guest access", { selector: "button" })).not.toBeInTheDocument();
  });
});
