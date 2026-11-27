import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import AdminUsers from "./AdminUsers.jsx";
import AdminUserForm from "./AdminUserForm.jsx";
import AdminTripMeetings from "./AdminTripMeetings.jsx";
import AdminTripRequirements from "./AdminTripRequirements.jsx";
import PublicTripAccessRecovery from "./PublicTripAccessRecovery.jsx";
import {
  fetchUsers,
  fetchCurrentUser,
  fetchTrips,
  fetchReachablePartners,
  sendUserSetupLink,
  createUser,
  requestTripParticipantAccessLink,
  resendTripMeetingInvite,
} from "../api/client.js";
import { setupLinkNotSentMessage, welcomeNotSentMessage } from "../utils/setupLinkMessages.js";

// No screen may say an email was sent, or will be, when it wasn't or can't be.
vi.mock("../api/client.js", () => ({
  fetchUsers: vi.fn(),
  fetchUser: vi.fn(),
  fetchCurrentUser: vi.fn(),
  fetchTrips: vi.fn(),
  deleteUser: vi.fn(),
  sendUserSetupLink: vi.fn(),
  resetUserMfa: vi.fn(),
  updateUser: vi.fn(),
  createUser: vi.fn(),
  fetchReachablePartners: vi.fn(),
  updateChurchSettings: vi.fn(),
  requestTripParticipantAccessLink: vi.fn(),
  scheduleTripMeeting: vi.fn(),
  updateTripMeeting: vi.fn(),
  resendTripMeetingInvite: vi.fn(),
  cancelTripMeeting: vi.fn(),
  deleteTripMeeting: vi.fn(),
  fetchPublicSettings: vi.fn().mockResolvedValue({}),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: {}, timezone: "America/Chicago" }),
}));
vi.mock("../components/PublicSiteHeader.jsx", () => ({ default: () => null }));
vi.mock("../components/DemoBanner.jsx", () => ({ default: () => null }));

const me = (over = {}) => ({ id: "a", role: "admin", mfaEnabled: true, emailReady: true, ...over });
const invited = {
  id: "u1",
  email: "new@example.test",
  role: "editor",
  authProvider: "local",
  active: true,
  passwordSetupPending: true,
  mfaEnabled: false,
  passkeyCount: 0,
  lastLoginAt: null,
  tripAccess: [],
  inactiveReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchUsers.mockResolvedValue([
    { ...invited, id: "a", email: "admin@example.test", role: "admin", passwordSetupPending: false },
    invited,
  ]);
  fetchTrips.mockResolvedValue([]);
  fetchReachablePartners.mockResolvedValue([]);
  fetchCurrentUser.mockResolvedValue(me());
});

describe("Manage Users: Send setup link", () => {
  const renderUsers = () =>
    render(
      <MemoryRouter>
        <AdminUsers />
      </MemoryRouter>
    );

  it("says 'sent' only when the server says it was sent", async () => {
    sendUserSetupLink.mockResolvedValue({ sent: true });
    renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Send setup link" }));
    expect(await screen.findByText("Setup link sent to new@example.test.")).toBeInTheDocument();
  });

  it("does not say 'sent' when nothing was sent and there is no link to copy; it says what to do", async () => {
    sendUserSetupLink.mockResolvedValue({ sent: false, manualSetupUrl: null });
    renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Send setup link" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Nothing was sent to new@example.test");
    expect(alert).toHaveTextContent(/set a password for them/);
    expect(screen.queryByText(/Setup link sent/)).toBeNull();
  });
});

describe("the not-sent messages", () => {
  it("never print '(undefined)' when the server gave no error", () => {
    const message = welcomeNotSentMessage(
      "a@b.test",
      { sent: false },
      { retryHint: 'Use "Send setup link" on their row to try again.' }
    );
    expect(message).not.toMatch(/undefined/);
    expect(message).toMatch(/nothing was sent to them/);
    expect(message).toMatch(/set a password for them/);
    expect(setupLinkNotSentMessage("a@b.test")).not.toMatch(/undefined|Setup link sent/);
  });

  it("keep the server's reason when a send was tried and failed", () => {
    expect(
      welcomeNotSentMessage(
        "a@b.test",
        { sent: false, error: "Postmark said no" },
        { retryHint: "Try again." }
      )
    ).toBe("a@b.test was created, but the welcome email couldn't be sent (Postmark said no). Try again.");
  });
});

describe("Add User with email off", () => {
  const renderForm = () =>
    render(
      <MemoryRouter initialEntries={["/admin/settings/users/new"]}>
        <AdminUserForm />
      </MemoryRouter>
    );
  const toLastStep = async () => {
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ed@b.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  };

  it("offers a link to pass on, not a welcome email, and says nothing is emailed", async () => {
    fetchCurrentUser.mockResolvedValue(me({ emailReady: false }));
    renderForm();
    await toLastStep();
    expect(await screen.findByLabelText(/Give me a setup link to pass on/)).toBeChecked();
    expect(screen.queryByText(/Send a welcome email/)).toBeNull();
    expect(screen.getByText(/nothing is emailed/)).toBeInTheDocument();
  });

  it("still offers the welcome email when email works", async () => {
    renderForm();
    await toLastStep();
    expect(await screen.findByLabelText(/Send a welcome email/)).toBeChecked();
  });

  it("shows the link to copy when the server hands one back", async () => {
    fetchCurrentUser.mockResolvedValue(me({ emailReady: false }));
    createUser.mockResolvedValue({
      email: "ed@b.test",
      welcomeEmail: { sent: false, manualSetupUrl: "http://localhost/set-password?token=abc" },
    });
    renderForm();
    await toLastStep();
    fireEvent.click(await screen.findByRole("button", { name: "Finish" }));
    expect(await screen.findByDisplayValue("http://localhost/set-password?token=abc")).toBeInTheDocument();
    expect(screen.getByText(/Nothing was emailed/)).toBeInTheDocument();
  });
});

describe("the trip 'lost your link' page", () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <PublicTripAccessRecovery />
      </MemoryRouter>
    );
  const ask = () => {
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "me@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send me a link" }));
  };

  it("shows the server's answer when the request worked", async () => {
    requestTripParticipantAccessLink.mockResolvedValue({
      message: "If that email has a record, we've sent a new link.",
    });
    renderPage();
    ask();
    expect(await screen.findByText(/we've sent a new link/)).toBeInTheDocument();
  });

  for (const [name, error, expected] of [
    ["email is off", { response: { status: 404 } }, /isn't sending trip links by email/],
    ["the request failed", new Error("Network Error"), /Something went wrong and nothing was sent/],
  ]) {
    it(`does not say a link was sent when ${name}`, async () => {
      requestTripParticipantAccessLink.mockRejectedValue(error);
      renderPage();
      ask();
      expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(screen.queryByText(/we've sent/)).toBeNull();
      expect(screen.getByRole("button", { name: "Send me a link" })).toBeEnabled();
    });
  }
});

describe("trip pages with email off", () => {
  const trip = {
    id: "t1",
    participants: [{ id: "p1", firstName: "Jamie", lastName: "Lee" }],
    meetings: [{ id: "m1", title: "Training", startAt: "2026-12-02T00:00:00.000Z", rsvps: [] }],
    requirements: [],
    documents: [],
  };
  const confirmDialog = vi.fn(async () => false);
  const renderTab = (element, emailOff) =>
    render(
      <MemoryRouter>
        <Routes>
          <Route
            element={
              <Outlet
                context={{
                  trip,
                  reload: vi.fn(),
                  confirmDialog,
                  id: "t1",
                  canWrite: true,
                  emailOff,
                  requirementLibrary: [],
                }}
              />
            }
          >
            <Route path="/" element={element} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  const bodyText = (opts) => render(opts.body).container.textContent;

  it("cancelling a meeting does not promise a cancellation notice, and Resend becomes links to pass on", async () => {
    resendTripMeetingInvite.mockResolvedValue({ sent: false, manual: [] });
    renderTab(<AdminTripMeetings />, true);
    fireEvent.click(await screen.findByText("Training"));
    expect(screen.queryByRole("button", { name: "Resend invite" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show links to pass on" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel meeting" }));
    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    const said = bodyText(confirmDialog.mock.calls.at(-1)[0]);
    expect(said).toMatch(/nobody is told automatically/);
    expect(said).not.toMatch(/will get a cancellation notice/);
  });

  it("with email on, the same screens still say an email goes out", async () => {
    renderTab(<AdminTripMeetings />, false);
    fireEvent.click(await screen.findByText("Training"));
    expect(screen.getByRole("button", { name: "Resend invite" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel meeting" }));
    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(bodyText(confirmDialog.mock.calls.at(-1)[0])).toMatch(/will get a cancellation notice/);
  });

  it("the Requirements intro does not say people are emailed automatically", () => {
    renderTab(<AdminTripRequirements />, true);
    expect(screen.getByText(/no reminders are sent/)).toBeInTheDocument();
    expect(screen.queryByText(/emailed automatically/)).toBeNull();
  });
});
