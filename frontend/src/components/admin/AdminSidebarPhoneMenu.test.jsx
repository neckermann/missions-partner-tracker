import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Link } from "react-router-dom";
import AdminSidebar from "./AdminSidebar.jsx";

// On a phone the sidebar is a slim bar with a Menu button, closed until tapped and closed
// again once a page is chosen. (What the CSS does with those classes is checked in a real
// browser by e2e/mobile-layout.spec.js; jsdom applies no stylesheet.)
vi.mock("../../api/client.js", () => ({ logout: vi.fn() }));
vi.mock("../../hooks/useCurrentUser.js", () => ({
  default: () => ({ loading: false, isAdmin: true, isGuest: false, careTeamSeats: [] }),
}));
vi.mock("../../hooks/useNotifications.js", () => ({
  default: () => ({ categories: [], totalWaiting: 0, markSeen: vi.fn() }),
}));
vi.mock("../../context/SettingsContext.jsx", () => ({
  useSettings: () => ({
    churchName: "Test Church",
    partnerTermPlural: "Partners",
    usePartnerTermInAdmin: false,
    enabledFeatures: { trips: true },
  }),
}));

function stubViewport(phone) {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: phone,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const sidebar = () => document.querySelector(".admin-sidebar");

function renderSidebar() {
  render(
    <MemoryRouter>
      <AdminSidebar />
      <Link to="/elsewhere">elsewhere</Link>
    </MemoryRouter>
  );
}

describe("AdminSidebar on a phone", () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubViewport(true);
  });
  afterEach(() => {
    delete window.matchMedia;
  });

  it("starts closed, opens from the Menu button, and closes after a page is chosen", () => {
    renderSidebar();
    const menu = screen.getByRole("button", { name: /Menu/ });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(sidebar()).not.toHaveClass("menu-open");

    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(sidebar()).toHaveClass("menu-open");

    fireEvent.click(screen.getByRole("link", { name: /Trips/ }));
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(sidebar()).not.toHaveClass("menu-open");
  });

  it("ignores the desktop icons-only preference: labels stay on a phone", () => {
    window.localStorage.setItem("admin.sidebarCollapsed", "1");
    renderSidebar();
    expect(sidebar()).not.toHaveClass("collapsed");
  });
});

describe("AdminSidebar beside the page", () => {
  it("keeps the desktop icons-only preference and never marks the menu open", () => {
    stubViewport(false);
    window.localStorage.setItem("admin.sidebarCollapsed", "1");
    renderSidebar();
    expect(sidebar()).toHaveClass("collapsed");
    expect(sidebar()).not.toHaveClass("menu-open");
    delete window.matchMedia;
  });
});
