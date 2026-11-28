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

describe("the second-administrator screen comes first on a brand-new site", () => {
  async function loadWith(users) {
    vi.resetModules();
    vi.doMock("../api/client.js", () => ({
      fetchChurchSettings: vi.fn().mockResolvedValue({ enabledFeatures: {} }),
      fetchUsers: vi.fn().mockResolvedValue(users),
    }));
    return (await import("./usePublicSiteChoiceRedirect.js")).default;
  }
  function Home({ hook }) {
    hook(true);
    return <div>ADMIN HOME</div>;
  }
  async function renderWith(hook) {
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<Home hook={hook} />} />
          <Route path="/admin/add-administrator" element={<div>ADD ADMIN PAGE</div>} />
          <Route path="/admin/public-site" element={<div>CHOICE PAGE</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  beforeEach(() => localStorage.clear());

  it("shows the step when there is only one administrator", async () => {
    await renderWith(await loadWith([{ role: "admin", active: true }]));
    expect(await screen.findByText("ADD ADMIN PAGE")).toBeInTheDocument();
  });

  it("skips it when there are already two administrators", async () => {
    await renderWith(
      await loadWith([
        { role: "admin", active: true },
        { role: "admin", active: true },
      ])
    );
    expect(await screen.findByText("CHOICE PAGE")).toBeInTheDocument();
  });

  it("skips it once it has been answered or skipped in this browser", async () => {
    localStorage.setItem("addAdministratorAsked", "1");
    await renderWith(await loadWith([{ role: "admin", active: true }]));
    expect(await screen.findByText("CHOICE PAGE")).toBeInTheDocument();
  });
});
