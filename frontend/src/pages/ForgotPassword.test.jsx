import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ForgotPassword from "./ForgotPassword.jsx";
import * as client from "../api/client.js";

vi.mock("../api/client.js", () => ({ requestPasswordSetupLink: vi.fn() }));

const renderIt = () =>
  render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>
  );

beforeEach(() => vi.clearAllMocks());

describe("ForgotPassword", () => {
  it("asks for the email, then says a link is on its way", async () => {
    client.requestPasswordSetupLink.mockResolvedValue({
      ok: true,
      message: "If that email has an account, a new link to set up your sign-in is on its way.",
    });
    renderIt();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dana@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("a new link to set up your sign-in is on its way");
    expect(client.requestPasswordSetupLink).toHaveBeenCalledWith("dana@example.org");
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeInTheDocument();
  });

  it("shows the server's own words while the site can't send email", async () => {
    client.requestPasswordSetupLink.mockResolvedValue({
      ok: true,
      emailOff: true,
      message:
        "This site can't send email, so we can't send a link. Please ask your church administrator for a new setup link.",
    });
    renderIt();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dana@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("ask your church administrator");
  });

  it("says the same generic thing when the request fails, so a failure reveals nothing", async () => {
    client.requestPasswordSetupLink.mockRejectedValue(new Error("boom"));
    renderIt();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "x@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a link" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("If that email has an account"));
  });
});
