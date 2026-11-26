import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AdminPublicSiteChoice from "./AdminPublicSiteChoice.jsx";
import { fetchChurchSettings, updateChurchSettings } from "../api/client.js";

vi.mock("../api/client.js", () => ({ fetchChurchSettings: vi.fn(), updateChurchSettings: vi.fn() }));
const refreshSettings = vi.fn();
vi.mock("../context/SettingsContext.jsx", () => ({ useSettings: () => ({ refreshSettings }) }));

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/admin/public-site"]}>
      <Routes>
        <Route path="/admin/public-site" element={<AdminPublicSiteChoice />} />
        <Route path="/admin" element={<div>ADMIN HOME</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchChurchSettings.mockResolvedValue({ enabledFeatures: { trips: true } });
  updateChurchSettings.mockResolvedValue({});
});

describe("Show your partners on a public website?", () => {
  it("turns the directory and map on, keeping every other setting, and goes home", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Yes, turn on/ }));
    await waitFor(() =>
      expect(updateChurchSettings).toHaveBeenCalledWith({
        enabledFeatures: { trips: true, publicDirectory: true, publicMap: true },
      })
    );
    await waitFor(() => expect(screen.getByText("ADMIN HOME")).toBeInTheDocument());
    expect(refreshSettings).toHaveBeenCalled();
  });

  it("'Not yet' stores both as off, so the question is not asked again", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Not yet" }));
    await waitFor(() =>
      expect(updateChurchSettings).toHaveBeenCalledWith({
        enabledFeatures: { trips: true, publicDirectory: false, publicMap: false },
      })
    );
    await waitFor(() => expect(screen.getByText("ADMIN HOME")).toBeInTheDocument());
  });

  it("stays on the page, with a message, if saving fails", async () => {
    updateChurchSettings.mockRejectedValue(new Error("nope"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Not yet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/didn't save/);
    expect(screen.queryByText("ADMIN HOME")).toBeNull();
  });
});
