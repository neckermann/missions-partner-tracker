import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import RequirePublicSite from "./RequirePublicSite.jsx";
import { fetchSetupStatus } from "../api/client.js";

// The public directory is off on a new install, so this notice is the front page of a brand-new site.
vi.mock("../api/client.js", () => ({ fetchSetupStatus: vi.fn() }));
let settings;
vi.mock("../context/SettingsContext.jsx", () => ({ useSettings: () => settings }));

function renderGate() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <RequirePublicSite feature="publicDirectory">
              <div>THE DIRECTORY</div>
            </RequirePublicSite>
          }
        />
        <Route path="/setup" element={<div>SETUP PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => fetchSetupStatus.mockReset());

describe("RequirePublicSite", () => {
  it("shows the page when the feature is on, and never asks about setup", () => {
    settings = { enabledFeatures: { publicDirectory: true }, loading: false };
    renderGate();
    expect(screen.getByText("THE DIRECTORY")).toBeInTheDocument();
    expect(fetchSetupStatus).not.toHaveBeenCalled();
  });

  it("sends a site with no accounts to setup", async () => {
    settings = { enabledFeatures: { publicDirectory: false }, loading: false };
    fetchSetupStatus.mockResolvedValue({ needed: true });
    renderGate();
    await waitFor(() => expect(screen.getByText("SETUP PAGE")).toBeInTheDocument());
  });

  it("otherwise says the page isn't public, with a way to sign in", async () => {
    settings = { enabledFeatures: { publicDirectory: false }, loading: false };
    fetchSetupStatus.mockResolvedValue({ needed: false });
    renderGate();
    expect(await screen.findByText("This isn't public")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to admin login" })).toHaveAttribute("href", "/login");
  });

  it("waits for the settings before deciding anything", () => {
    settings = { enabledFeatures: { publicDirectory: false }, loading: true };
    renderGate();
    expect(fetchSetupStatus).not.toHaveBeenCalled();
  });
});
