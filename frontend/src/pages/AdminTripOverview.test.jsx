import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import AdminTripOverview from "./AdminTripOverview.jsx";
import { updateTrip } from "../api/client.js";

vi.mock("../api/client.js", () => ({ updateTrip: vi.fn() }));
let confirmAnswer = true;
const confirmSpy = vi.fn();
vi.mock("../hooks/useConfirmDialog.jsx", () => ({
  default: () => ({
    confirm: (...a) => {
      confirmSpy(...a);
      return Promise.resolve(confirmAnswer);
    },
    confirmElement: null,
  }),
}));

const future = new Date(Date.now() + 90 * 86400000).toISOString();
const past = new Date(Date.now() - 90 * 86400000).toISOString();
const trip = (over) => ({
  id: "t1",
  name: "Summer build",
  status: "planning",
  startDate: future,
  endDate: future,
  participants: [],
  budgetLines: [],
  ...over,
});

function show(t) {
  render(
    <MemoryRouter initialEntries={["/admin/trips/t1"]}>
      <Routes>
        <Route element={<Outlet context={{ trip: t, setTrip: vi.fn(), canWrite: true }} />}>
          <Route path="/admin/trips/t1" element={<AdminTripOverview />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

async function setCompletedAndSave() {
  fireEvent.click(screen.getByRole("button", { name: /Trip setup/ }));
  fireEvent.change(await screen.findByLabelText("Status"), { target: { value: "completed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmAnswer = true;
  updateTrip.mockResolvedValue({ id: "t1", status: "completed" });
});

describe("setting a trip to Completed by hand", () => {
  it("asks first when the trip has not started, and saves once confirmed", async () => {
    show(trip());
    await setCompletedAndSave();
    await waitFor(() => expect(updateTrip).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalled();
    expect(confirmSpy.mock.calls[0][0].title).toMatch(/Mark this trip completed/);
  });

  it("saves nothing when the question is declined", async () => {
    confirmAnswer = false;
    show(trip());
    await setCompletedAndSave();
    expect(await screen.findByText(/Not saved: the status is unchanged/)).toBeTruthy();
    expect(updateTrip).not.toHaveBeenCalled();
  });

  it("does not ask for a trip that has already run", async () => {
    show(trip({ startDate: past, endDate: past, status: "closed" }));
    await setCompletedAndSave();
    await waitFor(() => expect(updateTrip).toHaveBeenCalled());
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
