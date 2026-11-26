import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import usePublicSiteChoiceRedirect from "./usePublicSiteChoiceRedirect.js";
import { fetchChurchSettings } from "../api/client.js";

vi.mock("../api/client.js", () => ({ fetchChurchSettings: vi.fn() }));

function Home({ isAdmin }) {
  usePublicSiteChoiceRedirect(isAdmin);
  return <div>ADMIN HOME</div>;
}

function renderHome(isAdmin) {
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route path="/admin" element={<Home isAdmin={isAdmin} />} />
        <Route path="/admin/public-site" element={<div>CHOICE PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => fetchChurchSettings.mockReset());

describe("the one-time 'show your partners publicly?' question", () => {
  it("is asked of an admin whose site has never decided", async () => {
    fetchChurchSettings.mockResolvedValue({ enabledFeatures: { trips: true } });
    renderHome(true);
    await waitFor(() => expect(screen.getByText("CHOICE PAGE")).toBeInTheDocument());
  });

  it("is not asked again once either switch is stored, even as off", async () => {
    fetchChurchSettings.mockResolvedValue({ enabledFeatures: { publicDirectory: false } });
    renderHome(true);
    await waitFor(() => expect(fetchChurchSettings).toHaveBeenCalled());
    expect(screen.getByText("ADMIN HOME")).toBeInTheDocument();
  });

  it("is never asked of someone who is not an admin, and their settings are not even fetched", () => {
    renderHome(false);
    expect(fetchChurchSettings).not.toHaveBeenCalled();
    expect(screen.getByText("ADMIN HOME")).toBeInTheDocument();
  });
});
