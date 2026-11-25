import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminContactLog from "./AdminContactLog.jsx";
import { fetchContactLogAll, fetchContactLogOptions, fetchReachablePartners } from "../api/client.js";

vi.mock("../api/client.js", () => ({
  fetchContactLogAll: vi.fn(),
  fetchContactLogOptions: vi.fn(),
  fetchReachablePartners: vi.fn(),
  fetchPartner: vi.fn().mockResolvedValue({ id: "p1", displayName: "The Reeds" }),
}));

const options = {
  types: [{ value: "call", label: "Phone call" }],
  directions: [{ value: "outbound", label: "We reached out" }],
  topics: [{ value: "prayer", label: "Prayer" }],
};
const row = (n) => ({
  id: `e${n}`,
  partner: { id: "p1", displayName: "The Reeds" },
  contactType: "call",
  direction: "outbound",
  contactDate: "2026-03-01T00:00:00.000Z",
  topics: ["prayer"],
  supportOptionLabel: n === 1 ? "Airport pick-up" : null,
  contactedBy: { firstName: "Dana", lastName: "Reed" },
  notes: `Note ${n}`,
});

function renderPage(url = "/admin/contact-log") {
  render(
    <MemoryRouter initialEntries={[url]}>
      <AdminContactLog />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchContactLogOptions.mockResolvedValue(options);
  fetchReachablePartners.mockResolvedValue([{ id: "p1", displayName: "The Reeds", kind: "missionary" }]);
  fetchContactLogAll.mockResolvedValue({ rows: [row(1), row(2)], total: 2, hasMore: false });
});

describe("AdminContactLog", () => {
  it("lists entries with their partner, what happened, topics and the option they were about", async () => {
    renderPage();
    expect(await screen.findByText("Note 1")).toBeInTheDocument();
    expect(screen.getAllByText("The Reeds").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Phone call · We reached out")).toHaveLength(2);
    expect(screen.getByText("Prayer, re: Airport pick-up")).toBeInTheDocument();
    expect(screen.getByText("2 entries")).toBeInTheDocument();
  });

  it("asks the server for just one partner when linked from their page", async () => {
    renderPage("/admin/contact-log?partnerId=p1");
    await waitFor(() =>
      expect(fetchContactLogAll).toHaveBeenCalledWith(
        expect.objectContaining({ partnerId: "p1", limit: 50, offset: 0 })
      )
    );
  });

  it("loads the next page when there are more", async () => {
    fetchContactLogAll.mockResolvedValueOnce({ rows: [row(1)], total: 2, hasMore: true });
    fetchContactLogAll.mockResolvedValueOnce({ rows: [row(2)], total: 2, hasMore: false });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load More \(1 remaining\)/ }));
    expect(await screen.findByText("Note 2")).toBeInTheDocument();
    expect(fetchContactLogAll).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1 }));
  });
});
