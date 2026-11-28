import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PublicDirectory from "./PublicDirectory.jsx";
import { fetchPublicPartners, fetchSetupStatus } from "../api/client.js";

// A3 of the November 2026 app review: on an install with no accounts and no partners the front page
// used to say "Loading..." for ever. Now it goes to setup, or says there is nothing to show yet.
vi.mock("../api/client.js", () => ({ fetchPublicPartners: vi.fn(), fetchSetupStatus: vi.fn() }));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({
    partnerTermPlural: "Partners",
    publicTagline: "",
    aboutText: "",
    churchName: "Grace Church",
  }),
}));
vi.mock("../components/DemoBanner.jsx", () => ({ default: () => null }));
vi.mock("../components/PublicSiteHeader.jsx", () => ({ default: () => <div /> }));

function renderAt() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<PublicDirectory />} />
        <Route path="/setup" element={<div>SETUP PAGE</div>} />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  fetchPublicPartners.mockReset();
  fetchSetupStatus.mockReset();
});

describe("PublicDirectory on an empty install", () => {
  it("goes to setup when no account exists yet", async () => {
    fetchPublicPartners.mockResolvedValue([]);
    fetchSetupStatus.mockResolvedValue({ needed: true });
    renderAt();
    await waitFor(() => expect(screen.getByText("SETUP PAGE")).toBeInTheDocument());
  });

  it("says there is nothing to show yet, with a sign-in link, once setup is done", async () => {
    fetchPublicPartners.mockResolvedValue([]);
    fetchSetupStatus.mockResolvedValue({ needed: false });
    renderAt();
    expect(await screen.findByText(/Grace Church has no partners to show here yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  it("still says Loading while the list is on its way", () => {
    fetchPublicPartners.mockReturnValue(new Promise(() => {}));
    renderAt();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows partners, and never asks about setup, when there are some", async () => {
    fetchPublicPartners.mockResolvedValue([
      { id: "p1", kind: "missionary", displayName: "The Miller Family", country: "Peru" },
    ]);
    renderAt();
    expect(await screen.findByText("The Miller Family")).toBeInTheDocument();
    expect(fetchSetupStatus).not.toHaveBeenCalled();
  });
});
