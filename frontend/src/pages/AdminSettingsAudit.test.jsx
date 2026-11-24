import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSettingsAudit from "./AdminSettingsAudit.jsx";
import { fetchAuditLog, fetchAuditMeta, setAuditRetention } from "../api/client.js";

// #341: the audit log page -- the rows, the filters it sends, paging, a
// deleted account still named, the retention setting, and the CSV link
// carrying the on-screen filters.
vi.mock("../api/client.js", () => ({
  fetchAuditLog: vi.fn(),
  fetchAuditMeta: vi.fn(),
  setAuditRetention: vi.fn(),
  auditExportUrl: (p) => `/api/audit/export?${new URLSearchParams(Object.entries(p).filter(([, v]) => v))}`,
}));

const row = (over = {}) => ({
  id: "r1",
  createdAt: "2026-11-24T15:00:00.000Z",
  action: "user.updated",
  label: "Changed an account",
  category: "Accounts",
  actor: { id: "a1", email: "dana@example.test", name: "Dana Whitfield", deleted: false },
  target: { id: "t1", email: "gus@example.test", name: "Gus Ghost", deleted: true },
  entity: null,
  ip: "203.0.113.9",
  summary: "Role: viewer → editor",
  ...over,
});
const meta = {
  categories: ["Sign-in", "Accounts"],
  actions: [],
  retentionDays: 90,
  retentionChoices: [30, 60, 90],
  total: 3,
  oldest: null,
};
const renderIt = () =>
  render(
    <MemoryRouter>
      <AdminSettingsAudit />
    </MemoryRouter>
  );

describe("AdminSettingsAudit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fetchAuditMeta.mockResolvedValue(meta);
    fetchAuditLog.mockResolvedValue({ rows: [row()], nextCursor: null });
  });

  it("lists who did what, to whom, with the details and where from", async () => {
    renderIt();
    expect(await screen.findByText("Changed an account")).toBeInTheDocument();
    expect(screen.getByText("Dana Whitfield")).toBeInTheDocument();
    expect(screen.getByText("Role: viewer → editor")).toBeInTheDocument();
    expect(screen.getByText("from 203.0.113.9")).toBeInTheDocument();
  });

  it("still names an account that has been deleted, and says so", async () => {
    renderIt();
    expect(await screen.findByText(/Gus Ghost/)).toBeInTheDocument();
    expect(screen.getByText("(deleted account)")).toBeInTheDocument();
  });

  it("says so when nothing is recorded, and when nothing matches", async () => {
    fetchAuditLog.mockResolvedValue({ rows: [], nextCursor: null });
    renderIt();
    expect(await screen.findByText("Nothing has been recorded yet.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByText("Nothing matches those filters.")).toBeInTheDocument();
  });

  it("sends the filters it was given, and the export link carries the same ones", async () => {
    renderIt();
    await screen.findByText("Changed an account");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "dana" } });
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "Sign-in" } });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await waitFor(() =>
      expect(fetchAuditLog).toHaveBeenLastCalledWith({ q: "dana", category: "Sign-in", from: "", to: "" })
    );
    const href = screen.getByRole("link", { name: "Export CSV" }).getAttribute("href");
    expect(href).toContain("q=dana");
    expect(href).toContain("category=Sign-in");
  });

  it("loads more rows with the cursor", async () => {
    fetchAuditLog
      .mockResolvedValueOnce({ rows: [row({ id: "r1" })], nextCursor: "r1" })
      .mockResolvedValueOnce({ rows: [row({ id: "r2", label: "Deleted an account" })], nextCursor: null });
    renderIt();
    await screen.findByText("Changed an account");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Deleted an account")).toBeInTheDocument();
    expect(fetchAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "r1" }));
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows the retention window and saves a new one", async () => {
    setAuditRetention.mockResolvedValue({ retentionDays: 30 });
    renderIt();
    expect(await screen.findByText("90 days")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retention/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Keep entries for"), { target: { value: "30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(setAuditRetention).toHaveBeenCalledWith(30));
  });
});
