import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import FeaturePausedPage, { pausedNames } from "./FeaturePausedPage.jsx";
import AdminLayout from "./admin/AdminLayout.jsx";
import RequireAdminFeature from "./RequireAdminFeature.jsx";
import useCurrentUser from "../hooks/useCurrentUser.js";

vi.mock("../api/client.js", () => ({ logout: vi.fn() }));
vi.mock("../hooks/useCurrentUser.js", () => ({ default: vi.fn() }));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: { trips: false, careTeam: false } }),
}));
vi.mock("./admin/AdminSidebar.jsx", () => ({ default: () => <nav>sidebar</nav> }));
vi.mock("./admin/UpdateBanner.jsx", () => ({ default: () => null }));
vi.mock("./admin/BackupReminder.jsx", () => ({ default: () => null }));
vi.mock("./admin/SiteAddressBanner.jsx", () => ({ default: () => null }));
vi.mock("./admin/GuestNotice.jsx", () => ({ default: () => null }));

const guest = (over = {}) => ({
  isGuest: true,
  loading: false,
  guestTripIds: [],
  guestReadTripIds: [],
  careTeamSeats: [],
  pausedFeatures: [],
  ...over,
});

describe("FeaturePausedPage", () => {
  it("names what is paused, in plain words", () => {
    expect(pausedNames(["trips"])).toBe("Trips");
    expect(pausedNames(["careTeam"])).toBe("Care teams");
    expect(pausedNames(["trips", "careTeam"])).toBe("Trips and Care teams");
  });

  it("says the church has paused it and access comes back, with no instruction to change a setting", () => {
    render(
      <MemoryRouter>
        <FeaturePausedPage features={["trips"]} signOut />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Trips are paused" })).toBeInTheDocument();
    expect(screen.getByText(/Your church has paused trips for now/)).toBeInTheDocument();
    expect(screen.getByText(/turns trips back on, everything will be there/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Settings|Features|turn it back on at/i);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});

describe("a guest in the admin shell", () => {
  beforeEach(() => vi.clearAllMocks());
  const shell = (path) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>sign in page</p>} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="*" element={<p>the real page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

  it("with nothing left but a paused feature, sees the paused page and not the sign-in page", () => {
    useCurrentUser.mockReturnValue(guest({ pausedFeatures: ["careTeam"] }));
    shell("/admin/partners");
    expect(screen.getByRole("heading", { name: "Care teams are paused" })).toBeInTheDocument();
    expect(screen.queryByText("sign in page")).toBeNull();
    expect(screen.queryByText("the real page")).toBeNull();
  });

  it("with care team partners left and only trips paused, sees the paused page where trips were, and the rest as usual", () => {
    useCurrentUser.mockReturnValue(
      guest({ pausedFeatures: ["trips"], careTeamSeats: [{ id: "p1", label: "P" }] })
    );
    shell("/admin/trips");
    expect(screen.getByRole("heading", { name: "Trips are paused" })).toBeInTheDocument();
    expect(screen.getByText("sidebar")).toBeInTheDocument();
  });

  it("a guest with live access sees their pages", () => {
    useCurrentUser.mockReturnValue(guest({ careTeamSeats: [{ id: "p1", label: "P" }] }));
    shell("/admin/partners");
    expect(screen.getByText("the real page")).toBeInTheDocument();
  });
});

describe("RequireAdminFeature for a guest", () => {
  it("says paused, not 'turn it back on at Church Settings', when trips is off", () => {
    useCurrentUser.mockReturnValue(guest({ pausedFeatures: ["trips"] }));
    render(
      <MemoryRouter>
        <RequireAdminFeature feature="trips">
          <p>trips page</p>
        </RequireAdminFeature>
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Trips are paused" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Settings|Enabled Features/);
  });

  it("an admin still gets the way to switch it back on", () => {
    useCurrentUser.mockReturnValue({ isGuest: false, loading: false });
    render(
      <MemoryRouter>
        <RequireAdminFeature feature="trips">
          <p>trips page</p>
        </RequireAdminFeature>
      </MemoryRouter>
    );
    expect(screen.getByText(/Enabled Features/)).toBeInTheDocument();
  });
});
