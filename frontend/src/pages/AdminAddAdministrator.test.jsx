import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminAddAdministrator from "./AdminAddAdministrator.jsx";
import * as client from "../api/client.js";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));
vi.mock("../api/client.js", () => ({ createUser: vi.fn() }));

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminAddAdministrator />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("Add a second administrator", () => {
  it("'Not now' skips it, remembers that, and goes on", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(client.createUser).not.toHaveBeenCalled();
    expect(localStorage.getItem("addAdministratorAsked")).toBe("1");
    expect(navigate).toHaveBeenCalledWith("/admin", { replace: true });
  });

  it("adds an administrator by email and says the link was sent", async () => {
    client.createUser.mockResolvedValue({ welcomeEmail: { sent: true } });
    renderPage();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@church.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add administrator" }));
    await waitFor(() =>
      expect(client.createUser).toHaveBeenCalledWith({
        email: "sam@church.test",
        firstName: "Sam",
        role: "admin",
        sendWelcomeEmail: true,
      })
    );
    expect(await screen.findByText(/We emailed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(navigate).toHaveBeenCalledWith("/admin", { replace: true });
  });

  it("with email off, shows the link to hand over", async () => {
    client.createUser.mockResolvedValue({
      welcomeEmail: { sent: false, manualSetupUrl: "http://x.test/set-password?token=t" },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@church.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add administrator" }));
    expect(await screen.findByText(/can't send email yet/)).toBeInTheDocument();
    expect(screen.getByText("http://x.test/set-password?token=t")).toBeInTheDocument();
  });

  it("shows the server's message when the address is already an account", async () => {
    client.createUser.mockRejectedValue({
      response: { data: { error: "A user with this email already exists." } },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@church.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add administrator" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });
});
