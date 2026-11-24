import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import Setup from "./Setup.jsx";
import { fetchSetupStatus, completeSetup } from "../api/client.js";

// First-run setup creates the first admin. A fresh install requires two-factor from the start
// (#385), so no session is handed out: the page sends them to sign in, with a note saying that
// two-factor setup is next.
vi.mock("../api/client.js", () => ({
  fetchSetupStatus: vi.fn(),
  completeSetup: vi.fn(),
}));

function LoginStub() {
  const { state } = useLocation();
  return <p>login page: {state?.notice}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchSetupStatus.mockResolvedValue({ needed: true });
  completeSetup.mockResolvedValue({ ok: true, mfaSetupRequired: true });
});

describe("Setup", () => {
  it("creates the account, then sends the new admin to sign in with a note about two-factor", async () => {
    render(
      <MemoryRouter initialEntries={["/setup"]}>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="/login" element={<LoginStub />} />
          <Route path="/admin" element={<p>the admin app</p>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: "first@church.test" } });
    const [password, confirm] = screen.getAllByLabelText(/password/i);
    fireEvent.change(password, { target: { value: "A-Strong-Passw0rd!" } });
    fireEvent.change(confirm, { target: { value: "A-Strong-Passw0rd!" } });
    fireEvent.click(screen.getByRole("button", { name: /create|continue|set up|finish/i }));

    await waitFor(() =>
      expect(completeSetup).toHaveBeenCalledWith("first@church.test", "A-Strong-Passw0rd!")
    );
    expect(await screen.findByText(/login page: Your admin account is ready/)).toBeInTheDocument();
    expect(screen.getByText(/two-factor authentication/)).toBeInTheDocument();
    expect(screen.queryByText("the admin app")).not.toBeInTheDocument();
  });
});
