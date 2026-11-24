import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import ContactLogSection from "./ContactLogSection.jsx";
import { fetchContactLogOptions, createContactLogEntry, updateContactLogEntry } from "../../api/client.js";

vi.mock("../../api/client.js", () => ({
  fetchContactLogOptions: vi.fn(),
  createContactLogEntry: vi.fn(),
  updateContactLogEntry: vi.fn(),
  deleteContactLogEntry: vi.fn(),
}));
vi.mock("../../hooks/useConfirmDialog.jsx", () => ({
  default: () => ({ confirm: vi.fn(), confirmElement: null }),
}));

const OPTIONS = {
  types: [
    { value: "call", label: "Phone call" },
    { value: "visit", label: "Visit" },
  ],
  directions: [
    { value: "outbound", label: "We reached out" },
    { value: "inbound", label: "They reached out" },
  ],
  topics: [
    { value: "prayer", label: "Prayer" },
    { value: "need", label: "Need / support" },
  ],
  staleDays: 90,
};
const entry = {
  id: "e1",
  contactType: "call",
  direction: "inbound",
  contactDate: "2026-03-01T00:00:00.000Z",
  topics: ["prayer"],
  notes: "Asked us to pray for the move.",
  followUpDate: null,
  contactedById: "u1",
  contactedBy: { id: "u1", firstName: "Dana", lastName: "Reed" },
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchContactLogOptions.mockResolvedValue(OPTIONS);
  createContactLogEntry.mockResolvedValue({});
  updateContactLogEntry.mockResolvedValue({});
});

const renderIt = (props = {}) =>
  render(
    <ContactLogSection
      partnerId="p1"
      entries={[entry]}
      onChanged={vi.fn()}
      canFix={false}
      currentUserId="me"
      {...props}
    />
  );

describe("ContactLogSection (#288)", () => {
  it("lists entries with readable labels", async () => {
    renderIt();
    expect(await screen.findByText("Phone call")).toBeTruthy();
    expect(screen.getByText(/They reached out/)).toBeTruthy();
    expect(screen.getByText(/by Dana Reed/)).toBeTruthy();
    expect(screen.getByText("Asked us to pray for the move.")).toBeTruthy();
  });

  it("anyone can log with chips; fix and delete are staff only", async () => {
    renderIt({ canFix: false });
    await screen.findByText("Phone call");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ Log contact" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Visit" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "They reached out" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Prayer" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createContactLogEntry).toHaveBeenCalled());
    const payload = createContactLogEntry.mock.calls[0][0];
    expect(payload).toMatchObject({
      partnerId: "p1",
      contactType: "visit",
      direction: "inbound",
      topics: ["prayer"],
    });
    expect(payload).not.toHaveProperty("contactedById"); // "Me" is the server's default
  });

  it("won't save without choosing what kind of contact it was", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "+ Log contact" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/Choose what kind of contact/)).toBeTruthy();
    expect(createContactLogEntry).not.toHaveBeenCalled();
  });

  it("staff can edit, and a teammate can be picked as who", async () => {
    renderIt({ canFix: true, teammates: [{ userId: "u9", name: "Sam Okafor" }] });
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Who"), { target: { value: "u9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateContactLogEntry).toHaveBeenCalled());
    expect(updateContactLogEntry.mock.calls[0][0]).toBe("e1");
    expect(updateContactLogEntry.mock.calls[0][1]).toMatchObject({
      contactedById: "u9",
      contactType: "call",
    });
  });

  it("shows an empty state", async () => {
    renderIt({ entries: [] });
    expect(await screen.findByText("No contact logged yet.")).toBeTruthy();
  });
});
