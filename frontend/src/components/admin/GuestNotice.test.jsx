import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GuestNotice, { HeldForReviewNote, guestNoticeText } from "./GuestNotice.jsx";

// A guest is told, in one line, what they are, what is hidden, and (care team) that what they add waits for
// staff approval. Nobody else sees these lines.
let currentUser;
vi.mock("../../hooks/useCurrentUser.js", () => ({ default: () => currentUser }));

describe("GuestNotice", () => {
  it("tells a trip leader what they can see, with no approval line", () => {
    currentUser = { isGuest: true, careTeamSeats: [], guestTripIds: ["t1"], loading: false };
    render(<GuestNotice />);
    const text = screen.getByRole("note").textContent;
    expect(text).toMatch(/signed in as a guest/);
    expect(text).toMatch(/trips you were given/);
    expect(text).toMatch(/rest of the app is hidden/);
    expect(text).not.toMatch(/staff approval/);
  });

  it("tells a care team member their entries wait for staff approval", () => {
    currentUser = { isGuest: true, careTeamSeats: [{ partnerId: "p1" }], guestTripIds: [], loading: false };
    render(<GuestNotice />);
    const text = screen.getByRole("note").textContent;
    expect(text).toMatch(/care team you are on/);
    expect(text).toMatch(/wait for staff approval before anyone is notified/);
  });

  it("names both when a guest has trips and a care team seat", () => {
    expect(guestNoticeText({ careTeamSeats: [{}], guestTripIds: ["t"] })).toMatch(
      /the trips you were given and the partners whose care team you are on/
    );
  });

  it("shows nothing to staff", () => {
    currentUser = { isGuest: false, careTeamSeats: [], guestTripIds: [], loading: false };
    const { container } = render(<GuestNotice />);
    expect(container.textContent).toBe("");
  });
});

describe("HeldForReviewNote", () => {
  it("shows for a care team guest only", () => {
    currentUser = { isGuest: true, careTeamSeats: [{ partnerId: "p1" }] };
    const { rerender, container } = render(<HeldForReviewNote />);
    expect(container.textContent).toMatch(/waits for staff approval/);
    currentUser = { isGuest: true, careTeamSeats: [] };
    rerender(<HeldForReviewNote />);
    expect(container.textContent).toBe("");
    currentUser = { isGuest: false, careTeamSeats: [] };
    rerender(<HeldForReviewNote />);
    expect(container.textContent).toBe("");
  });
});
