import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminPartnerForm from "./AdminPartnerForm.jsx";
import { createPartner } from "../api/client.js";

// A2 of the November 2026 app review: an admin who clicks Next, Next, Finish must not publish a
// family's name, photo and location to the internet. The step says in words what ticking it shows.
vi.mock("../api/client.js", () => ({ createPartner: vi.fn() }));
let currentUser = { isAdmin: true };
vi.mock("../hooks/useCurrentUser.js", () => ({ default: () => currentUser }));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ churchName: "Test Church" }),
}));

beforeEach(() => {
  createPartner.mockReset();
  createPartner.mockResolvedValue({ id: "p1" });
});

function renderForm() {
  render(
    <MemoryRouter>
      <AdminPartnerForm />
    </MemoryRouter>
  );
}

describe("New Partner form -- visibility", () => {
  it("links an admin to where restricted partners' public details are set, and an editor not", () => {
    for (const [user, expected] of [
      [{ isAdmin: true }, true],
      [{ isAdmin: false }, false],
    ]) {
      currentUser = user;
      const { unmount } = render(
        <MemoryRouter>
          <AdminPartnerForm />
        </MemoryRouter>
      );
      fireEvent.change(screen.getByPlaceholderText(/Miller Family/), { target: { value: "X" } });
      fireEvent.click(screen.getByText("Next"));
      fireEvent.click(screen.getByText("Next"));
      const link = screen.queryByRole("link", { name: /Change what restricted partners show/ });
      expect(Boolean(link)).toBe(expected);
      if (link) expect(link).toHaveAttribute("href", "/admin/settings/privacy");
      unmount();
    }
    currentUser = { isAdmin: true };
  });

  it("starts with 'Show on public site' unticked and explains what it shows", () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/Miller Family/), { target: { value: "The Test Family" } });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));

    expect(screen.getByLabelText("Show on public site")).not.toBeChecked();
    expect(
      screen.getByText(/anyone on the internet can see this partner's name, photo/i)
    ).toBeInTheDocument();
  });

  it("saves a partner as private when every default is accepted", async () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/Miller Family/), { target: { value: "The Test Family" } });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Finish"));

    await waitFor(() => expect(createPartner).toHaveBeenCalledTimes(1));
    expect(createPartner.mock.calls[0][0].isPublic).toBe(false);
  });
});
