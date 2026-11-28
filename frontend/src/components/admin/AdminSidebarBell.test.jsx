import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSidebar from "./AdminSidebar.jsx";

// The notification bell's dropdown is position: fixed, placed from the bell's own screen
// position. On a phone the bell sits near the right edge, so a 320px dropdown from x=316 on a
// 390px screen ran off it. It must stay fully on screen, and close when the page scrolls or
// the window resizes, since a fixed dropdown would otherwise stay put while its bell moves.
// jsdom does no layout, so the rectangles are supplied.
const markSeenSpy = vi.hoisted(() => vi.fn());
vi.mock("../../api/client.js", () => ({ logout: vi.fn() }));
vi.mock("../../hooks/useCurrentUser.js", () => ({
  default: () => ({ isGuest: false, isAdmin: true, canWrite: true, loading: false }),
}));
vi.mock("../../hooks/useNotifications.js", () => ({
  default: () => ({
    categories: [
      { key: "needs", label: "New one-time needs", icon: "🎁", count: 2, linkTo: "/admin/one-time-needs" },
    ],
    totalWaiting: 1,
    markSeen: markSeenSpy,
  }),
}));
vi.mock("../../context/SettingsContext.jsx", () => ({
  useSettings: () => ({
    churchName: "Test Church",
    partnerTermPlural: "Partners",
    usePartnerTermInAdmin: false,
    enabledFeatures: {},
  }),
}));

const DROPDOWN_WIDTH = 320;
let bellLeft;

function openBell() {
  render(
    <MemoryRouter>
      <AdminSidebar />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByTitle("Notifications"));
  return screen.getByRole("menu");
}

describe("AdminSidebar notification bell dropdown", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rect() {
      const el = this;
      if (el.classList?.contains("admin-sidebar-bell-btn")) {
        return { left: bellLeft, right: bellLeft + 26, top: 20, bottom: 46, width: 26, height: 26 };
      }
      if (el.classList?.contains("admin-sidebar-bell-dropdown")) {
        return { left: 0, right: DROPDOWN_WIDTH, top: 50, bottom: 200, width: DROPDOWN_WIDTH, height: 150 };
      }
      return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("is pulled back on screen when the bell is near the right edge (a phone)", () => {
    window.innerWidth = 390;
    bellLeft = 316;
    const menu = openBell();
    // 390 - 320 wide - 8px edge gap
    expect(menu.style.left).toBe("62px");
  });

  it("stays at the bell when it already fits (a wide window)", () => {
    window.innerWidth = 1280;
    bellLeft = 156;
    const menu = openBell();
    expect(menu.style.left).toBe("156px");
  });

  it("closes when the page scrolls or the window resizes, instead of floating off its bell", () => {
    window.innerWidth = 390;
    bellLeft = 316;
    openBell();
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Notifications"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("AdminSidebar notification bell: opening it", () => {
  it("marks nothing seen, so no alert is cleared (or backup reminder snoozed) by looking", () => {
    window.innerWidth = 1280;
    bellLeft = 156;
    markSeenSpy.mockClear();
    openBell();
    expect(markSeenSpy).not.toHaveBeenCalled();
  });

  it("shows a badge that counts the same alerts as the list has lines", () => {
    window.innerWidth = 1280;
    render(
      <MemoryRouter>
        <AdminSidebar />
      </MemoryRouter>
    );
    expect(screen.getByTitle("1 waiting")).toHaveTextContent("1");
    fireEvent.click(screen.getByTitle("Notifications"));
    expect(screen.getAllByText("New one-time needs").length).toBe(1);
  });
});
