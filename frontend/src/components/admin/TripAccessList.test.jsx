import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TripAccessList, { describeExpiry } from "./TripAccessList.jsx";

// Grant expiry as an admin reads it (#356): derived from the trip's end
// date unless an admin set a date, and an ended grant says so.
const base = { tripId: "t1", trip: { name: "Build" }, active: true };

describe("describeExpiry", () => {
  it("explains a derived expiry as 30 days after the trip ends", () => {
    const text = describeExpiry({
      ...base,
      effectiveExpiresAt: "2027-07-01T23:59:59.999Z",
      expiresIsOverride: false,
    });
    expect(text).toMatch(/Access until .*30 days after the trip ends/);
  });

  it("says an admin-set date was set by an admin", () => {
    const text = describeExpiry({
      ...base,
      effectiveExpiresAt: "2027-07-01T23:59:59.999Z",
      expiresIsOverride: true,
    });
    expect(text).toMatch(/set by an admin/);
  });

  it("says a trip with no end date has no expiry", () => {
    expect(describeExpiry({ ...base, effectiveExpiresAt: null, expiresIsOverride: false })).toMatch(
      /no expiry/
    );
  });

  it("marks a lapsed grant as ended", () => {
    const text = describeExpiry({ ...base, active: false, effectiveExpiresAt: "2026-01-02T23:59:59.999Z" });
    expect(text).toMatch(/^Ended /);
  });
});

describe("TripAccessList", () => {
  const grant = {
    ...base,
    id: "g1",
    effectiveExpiresAt: "2027-07-01T23:59:59.999Z",
    expiresIsOverride: false,
  };

  function setup(overrides = {}) {
    const handlers = {
      onExtend: vi.fn().mockResolvedValue(),
      onEndNow: vi.fn(),
      onResetDate: vi.fn(),
      onRemove: vi.fn(),
    };
    render(
      <TripAccessList grants={[{ ...grant, ...overrides }]} labelFor={(g) => g.trip.name} {...handlers} />
    );
    return handlers;
  }

  it("extends access to a chosen date", async () => {
    const { onExtend } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Extend/ }));
    fireEvent.change(screen.getByLabelText(/Keep access until/), { target: { value: "2027-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onExtend).toHaveBeenCalledWith(expect.objectContaining({ tripId: "t1" }), "2027-12-31")
    );
  });

  it("only offers 'Use automatic date' when an admin has overridden it", () => {
    setup();
    expect(screen.queryByRole("button", { name: /Use automatic date/ })).not.toBeInTheDocument();
  });

  it("offers 'Use automatic date' for an override and Restore (not End now) for an ended grant", () => {
    setup({ expiresIsOverride: true, active: false, effectiveExpiresAt: "2026-01-02T23:59:59.999Z" });
    expect(screen.getByRole("button", { name: /Use automatic date/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Restore/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /End now/ })).not.toBeInTheDocument();
  });

  it("hands End now and Remove to the caller, which owns the confirmation", () => {
    const { onEndNow, onRemove } = setup();
    fireEvent.click(screen.getByRole("button", { name: /End now/ }));
    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    expect(onEndNow).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("says so when there are no trips", () => {
    render(<TripAccessList grants={[]} labelFor={() => ""} />);
    expect(screen.getByText("No trips yet.")).toBeInTheDocument();
  });
});
