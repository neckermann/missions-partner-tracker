import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DemoBanner from "./DemoBanner.jsx";

// The demo banner lists every published login: the admin, plus the
// limited-access ones (a care team member, a trip leader).
let settings;
vi.mock("../context/SettingsContext.jsx", () => ({ useSettings: () => settings }));

const guests = [
  {
    key: "careTeamMember",
    label: "Care team member",
    email: "care@x.org",
    password: "gpw",
    summary: "Looks after a few partners.",
  },
  {
    key: "tripLeader",
    label: "Trip leader",
    email: "trip@x.org",
    password: "gpw",
    summary: "Runs one trip.",
  },
];

beforeEach(() => {
  settings = {
    isDemo: true,
    demoLoginEmail: "admin@x.org",
    demoLoginPassword: "apw",
    demoGuestLogins: guests,
  };
});

describe("DemoBanner", () => {
  it("renders nothing off a demo", () => {
    settings = { isDemo: false, demoLoginEmail: null, demoLoginPassword: null, demoGuestLogins: [] };
    const { container } = render(<DemoBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("lists the admin and both guest logins with what each gets", () => {
    render(<DemoBanner />);
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByText("admin@x.org")).toBeTruthy();
    expect(screen.getByText("apw")).toBeTruthy();
    expect(screen.getByText("Care team member")).toBeTruthy();
    expect(screen.getByText("care@x.org")).toBeTruthy();
    expect(screen.getByText("Trip leader")).toBeTruthy();
    expect(screen.getByText("trip@x.org")).toBeTruthy();
    expect(screen.getAllByText("gpw").length).toBe(2);
    expect(screen.getByText(/Looks after a few partners/)).toBeTruthy();
    expect(screen.getByText(/Runs one trip/)).toBeTruthy();
  });

  it("still works with no guest logins (an older or minimal demo)", () => {
    settings = { ...settings, demoGuestLogins: [] };
    render(<DemoBanner />);
    expect(screen.getByText("admin@x.org")).toBeTruthy();
    expect(screen.queryByText("Care team member")).toBeNull();
  });

  it("shows the guest logins even if the admin one isn't configured", () => {
    settings = { ...settings, demoLoginEmail: null, demoLoginPassword: null };
    render(<DemoBanner />);
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.getByText("care@x.org")).toBeTruthy();
  });

  it("tolerates the field being absent entirely", () => {
    settings = { isDemo: true, demoLoginEmail: "admin@x.org", demoLoginPassword: "apw" };
    render(<DemoBanner />);
    expect(screen.getByText("admin@x.org")).toBeTruthy();
  });
});
