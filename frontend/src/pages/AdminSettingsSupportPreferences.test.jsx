import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSettingsSupportPreferences from "./AdminSettingsSupportPreferences.jsx";
import {
  fetchSupportOptions,
  fetchSupportKinds,
  createSupportOption,
  updateSupportOption,
  deleteSupportOption,
  renameSupportGroup,
  addSupportExampleSet,
} from "../api/client.js";

// #374: the church's menu of support options, edited by an admin.
vi.mock("../api/client.js", () => ({
  fetchSupportOptions: vi.fn(),
  fetchSupportKinds: vi.fn(),
  createSupportOption: vi.fn(),
  updateSupportOption: vi.fn(),
  deleteSupportOption: vi.fn(),
  renameSupportGroup: vi.fn(),
  addSupportExampleSet: vi.fn(),
}));

const kinds = [
  { value: "offer", label: "Something we offer (tick it if wanted)" },
  { value: "single", label: "Pick one" },
  { value: "multiple", label: "Pick any" },
  { value: "text", label: "Free text" },
];
const option = (over = {}) => ({
  id: "o1",
  group: "Logistics",
  label: "Airport pick-up",
  kind: "offer",
  choices: [],
  allowOther: false,
  sortOrder: 1,
  active: true,
  answerCount: 0,
  ...over,
});

function renderPage() {
  render(
    <MemoryRouter>
      <AdminSettingsSupportPreferences />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchSupportKinds.mockResolvedValue(kinds);
  fetchSupportOptions.mockResolvedValue([
    option(),
    option({ id: "o2", label: "Care packages", group: "Gifts" }),
  ]);
  updateSupportOption.mockResolvedValue({});
  deleteSupportOption.mockResolvedValue();
  renameSupportGroup.mockResolvedValue({ renamed: 1 });
  createSupportOption.mockResolvedValue({});
  addSupportExampleSet.mockResolvedValue({ added: 18 });
});

describe("AdminSettingsSupportPreferences", () => {
  it("lists the menu by group with each option's kind and answer count", async () => {
    renderPage();
    expect(await screen.findByText("Airport pick-up")).toBeInTheDocument();
    expect(screen.getByText("Logistics")).toBeInTheDocument();
    expect(screen.getByText("Gifts")).toBeInTheDocument();
    expect(screen.getAllByText("Something we offer (tick it if wanted)")).toHaveLength(2);
  });

  it("offers an example set from an empty menu", async () => {
    fetchSupportOptions.mockResolvedValueOnce([]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add an example set" }));
    await waitFor(() => expect(addSupportExampleSet).toHaveBeenCalled());
    await waitFor(() => expect(fetchSupportOptions).toHaveBeenCalledTimes(2));
  });

  it("retires and restores an option without deleting its answers", async () => {
    renderPage();
    const row = (await screen.findByText("Airport pick-up")).closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Retire" }));
    await waitFor(() => expect(updateSupportOption).toHaveBeenCalledWith("o1", { active: false }));
  });

  it("asks before deleting, and says how many answers go with it", async () => {
    fetchSupportOptions.mockResolvedValue([option({ answerCount: 3 })]);
    renderPage();
    const row = (await screen.findByText("Airport pick-up")).closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/3 partners' answers/)).toBeInTheDocument();
    expect(deleteSupportOption).not.toHaveBeenCalled();
    // The dialog's own Delete button is the last one on the page.
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1));
    await waitFor(() => expect(deleteSupportOption).toHaveBeenCalledWith("o1"));
  });

  it("adds an option, splitting choices one per line", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "+ Add an option" }));
    fireEvent.change(screen.getByLabelText("What it says"), { target: { value: "How to send gifts" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "single" } });
    fireEvent.change(screen.getByLabelText(/Choices/), { target: { value: "Bank transfer\n\n  App  \n" } });
    fireEvent.click(screen.getByLabelText(/write their own answer/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(createSupportOption).toHaveBeenCalled());
    expect(createSupportOption.mock.calls[0][0]).toMatchObject({
      label: "How to send gifts",
      kind: "single",
      choices: ["Bank transfer", "App"],
      allowOther: true,
    });
  });

  it("renames a group", async () => {
    renderPage();
    const heading = await screen.findByText("Logistics");
    fireEvent.click(within(heading.parentElement).getByRole("button", { name: "Rename group" }));
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Getting around" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(renameSupportGroup).toHaveBeenCalledWith("Logistics", "Getting around"));
  });

  it("doesn't allow changing the kind of an option partners have answered", async () => {
    fetchSupportOptions.mockResolvedValue([option({ answerCount: 2 })]);
    renderPage();
    const row = (await screen.findByText("Airport pick-up")).closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Kind")).toBeDisabled();
  });
});
