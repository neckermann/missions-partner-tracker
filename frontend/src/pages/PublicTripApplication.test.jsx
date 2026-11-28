import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// A plain function, not vi.fn(): vitest tracks a mock's returned promise and reports a rejection as unhandled.
let tripResult = () => Promise.resolve({});
const fetchByToken = (...a) => tripResult(...a);
vi.mock("../api/client.js", async (orig) => ({
  ...(await orig()),
  fetchPublicTripByToken: (...a) => fetchByToken(...a),
  fetchPublicTrip: vi.fn(),
  submitTripApplication: vi.fn(),
  submitTripApplicationByToken: vi.fn(),
}));
vi.mock("../components/PublicSiteHeader.jsx", () => ({ default: () => <div /> }));

import PublicTripApplication from "./PublicTripApplication.jsx";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/trips/apply/abc"]}>
      <Routes>
        <Route path="/trips/apply/:token" element={<PublicTripApplication />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("PublicTripApplication", () => {
  beforeEach(() => {
    tripResult = () => Promise.resolve({});
  });

  it("says applications are not open when the trip has closed", async () => {
    tripResult = () =>
      Promise.reject({ response: { data: { code: "applications_closed", tripName: "Kenya 2027" } } });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Applications for Kenya 2027 are not open/)).toBeTruthy());
  });

  it("still says couldn't be found for an unknown link", async () => {
    tripResult = () => Promise.reject({ response: { data: { error: "Not found" } } });
    renderPage();
    await waitFor(() => expect(screen.getByText(/couldn't be found/)).toBeTruthy());
  });

  it("stops step 1 on an email that cannot be an address", async () => {
    tripResult = () => Promise.resolve({ id: "t", name: "Trip", applicationQuestions: {}, questions: [] });
    renderPage();
    await waitFor(() => screen.getByText(/First name/));
    const inputs = document.querySelectorAll("input");
    const byType = (t) => [...inputs].find((i) => i.type === t);
    const text = [...inputs].filter((i) => i.type === "text" && i.name !== "website");
    fireEvent.change(text[0], { target: { value: "A" } });
    fireEvent.change(text[1], { target: { value: "B" } });
    fireEvent.change(byType("email"), { target: { value: "not-an-email" } });
    fireEvent.change(byType("date"), { target: { value: "1990-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /next|continue/i }));
    await waitFor(() => expect(screen.getByText(/email address doesn't look right/)).toBeTruthy());
  });
});
