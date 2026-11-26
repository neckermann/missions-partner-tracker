// Where the emailed sign-in link lands.
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SignInLink from "./SignInLink.jsx";
import * as client from "../api/client.js";

vi.mock("../api/client.js", () => ({ redeemSignInLink: vi.fn() }));
const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));

const renderAt = (url) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <SignInLink />
    </MemoryRouter>
  );

beforeEach(() => vi.clearAllMocks());

describe("SignInLink", () => {
  test("spends the link once and hands the result to the sign-in page", async () => {
    client.redeemSignInLink.mockResolvedValue({ mfaSetupRequired: true, setupToken: "s" });
    renderAt("/login/link?token=abc");
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/login", {
        replace: true,
        state: { resume: { mfaSetupRequired: true, setupToken: "s" } },
      })
    );
    expect(client.redeemSignInLink).toHaveBeenCalledTimes(1);
    expect(client.redeemSignInLink).toHaveBeenCalledWith("abc");
  });

  test("an expired or used link says so and offers the way back", async () => {
    client.redeemSignInLink.mockRejectedValue({ response: { data: { error: "This link has expired" } } });
    renderAt("/login/link?token=old");
    expect(await screen.findByText("This link has expired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("a link with no token doesn't call the server", async () => {
    renderAt("/login/link");
    expect(await screen.findByText(/missing its code/)).toBeInTheDocument();
    expect(client.redeemSignInLink).not.toHaveBeenCalled();
  });
});
