import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SetPassword from "./SetPassword.jsx";
import { validatePasswordSetup, requestPasswordSetupLink } from "../api/client.js";

// The expired-link page offers a new link by email. While the site can't send email it must
// say so (and point to an administrator), not promise a link that will never arrive.
vi.mock("../api/client.js", () => ({
  validatePasswordSetup: vi.fn(),
  completePasswordSetup: vi.fn(),
  requestPasswordSetupLink: vi.fn(),
}));

function renderExpired() {
  validatePasswordSetup.mockRejectedValue({ response: { status: 400 } });
  render(
    <MemoryRouter initialEntries={["/set-password?token=expired"]}>
      <SetPassword />
    </MemoryRouter>
  );
}

async function askForNewLink(email = "pat@example.test") {
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a new link" }));
}

beforeEach(() => vi.clearAllMocks());

describe("SetPassword: asking for a new link", () => {
  it("shows the server's message while email works", async () => {
    requestPasswordSetupLink.mockResolvedValue({
      ok: true,
      message: "If that email has an account, a new link to set up your sign-in is on its way.",
    });
    renderExpired();
    await askForNewLink();
    expect(await screen.findByRole("status")).toHaveTextContent(/new link to set up your sign-in is on its way/);
    expect(requestPasswordSetupLink).toHaveBeenCalledWith("pat@example.test");
  });

  it("tells the person to ask their administrator when the site can't send email", async () => {
    requestPasswordSetupLink.mockResolvedValue({
      ok: true,
      emailOff: true,
      message:
        "This site can't send email, so we can't send a new link. Please ask your church administrator for a new setup link.",
    });
    renderExpired();
    await askForNewLink();
    expect(await screen.findByRole("status")).toHaveTextContent(/ask your church administrator/);
    expect(screen.queryByText(/is on its way/)).not.toBeInTheDocument();
  });

  it("falls back to the generic message if the request fails", async () => {
    requestPasswordSetupLink.mockRejectedValue(new Error("network"));
    renderExpired();
    await askForNewLink();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/new link to set up your sign-in is on its way/)
    );
  });
});
