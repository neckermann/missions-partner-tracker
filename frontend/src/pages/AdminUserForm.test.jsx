import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminUserForm from "./AdminUserForm.jsx";
import { createUser } from "../api/client.js";

// The Add User wizard with care teams on. The Care team step exists only for
// a Guest (everyone else reaches partners through their role): Basics ->
// Account Setup for admin/editor/viewer, Basics -> Care team -> Account Setup
// for a guest.
vi.mock("../api/client.js", () => ({
  createUser: vi.fn(),
  fetchCurrentUser: vi.fn().mockResolvedValue({ id: "a", role: "admin", emailReady: true }),
  fetchTrips: vi.fn().mockResolvedValue([]),
  fetchReachablePartners: vi
    .fn()
    .mockResolvedValue([{ id: "p1", displayName: "The Smiths", archived: false }]),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: { careTeam: true } }),
}));

function renderForm(url = "/admin/settings/users/new") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AdminUserForm />
    </MemoryRouter>
  );
}

describe("AdminUserForm care team step", () => {
  beforeEach(() => {
    createUser.mockReset();
    createUser.mockResolvedValue({ email: "a@b.test", welcomeEmail: { sent: true } });
  });

  it("goes straight from Basics to Account Setup for an editor", async () => {
    renderForm();
    expect(screen.queryByText(/Care team/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ed@b.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/Send a welcome email/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(createUser).toHaveBeenCalled());
    expect(createUser.mock.calls[0][0].careTeam).toBeUndefined();
  });

  it("shows the Care team step once Guest is chosen, and sends the partners picked", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "g@b.test" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "guest" } });
    expect(screen.getByText(/2\. Care team/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/which partners will this person keep in touch with/);
    fireEvent.change(screen.getByLabelText("Add a partner to look after"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Send a welcome email/);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(createUser).toHaveBeenCalled());
    expect(createUser.mock.calls[0][0].careTeam).toEqual([{ partnerId: "p1" }]);
  });

  it("drops partners picked for a guest if the role is switched back", async () => {
    renderForm("/admin/settings/users/new?partnerId=p1");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "x@b.test" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "editor" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Send a welcome email/);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(createUser).toHaveBeenCalled());
    expect(createUser.mock.calls[0][0].careTeam).toBeUndefined();
  });
});
