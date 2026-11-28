import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PublicHome from "./PublicHome.jsx";

let features;
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: features, loading: false, churchName: "Hillside" }),
}));
vi.mock("../api/client.js", () => ({ fetchSetupStatus: vi.fn().mockResolvedValue({ needed: false }) }));

const show = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<PublicHome directory={<p>The directory</p>} />} />
        <Route path="/map" element={<p>The map</p>} />
      </Routes>
    </MemoryRouter>
  );

describe("PublicHome", () => {
  beforeEach(() => {
    features = {};
  });
  it("shows the directory when it is on", () => {
    features = { publicDirectory: true, publicMap: true };
    show();
    expect(screen.getByText("The directory")).toBeTruthy();
  });
  it("sends a map-only site to the map instead of saying it is private", () => {
    features = { publicDirectory: false, publicMap: true };
    show();
    expect(screen.getByText("The map")).toBeTruthy();
  });
  it("says it is not public when neither is on", () => {
    show();
    expect(screen.getByText("This isn't public")).toBeTruthy();
  });
});
