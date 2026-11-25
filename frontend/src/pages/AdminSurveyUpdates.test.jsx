import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSurveyUpdates from "./AdminSurveyUpdates.jsx";
import { fetchSurveyUpdates, approveSurveyUpdate, rejectSurveyUpdate } from "../api/client.js";

vi.mock("../api/client.js", () => ({
  fetchSurveyUpdates: vi.fn(),
  approveSurveyUpdate: vi.fn(),
  rejectSurveyUpdate: vi.fn(),
}));

const phone = {
  id: "u1",
  status: "pending",
  partnerId: "p1",
  partnerName: "Amy Farnsworth",
  surveyTitle: "Annual update",
  field: "primaryPhone",
  fieldLabel: "Primary contact's phone",
  currentValue: "111",
  proposedValue: "(337) 555-0100",
  photoUploadId: null,
  createdAt: "2026-11-20T12:00:00Z",
};
const photo = {
  ...phone,
  id: "u2",
  field: "photo",
  fieldLabel: "Photo",
  currentValue: null,
  proposedValue: null,
  photoUploadId: "up1",
};

function renderPage() {
  render(
    <MemoryRouter>
      <AdminSurveyUpdates />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchSurveyUpdates.mockResolvedValue([phone, photo]);
  approveSurveyUpdate.mockResolvedValue({ approved: true });
  rejectSurveyUpdate.mockResolvedValue({ rejected: true });
});

describe("AdminSurveyUpdates", () => {
  it("lists what is on file next to what they answered, with a photo shown", async () => {
    renderPage();
    expect(await screen.findByText("(337) 555-0100")).toBeInTheDocument();
    expect(screen.getByText("111")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Amy Farnsworth/ })).toHaveAttribute(
      "src",
      "/api/survey-updates/photo/up1"
    );
    expect(screen.getByText("2 waiting for a decision")).toBeInTheDocument();
  });

  it("approves as suggested, and edits before approving", async () => {
    renderPage();
    await screen.findByText("(337) 555-0100");
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]);
    await waitFor(() => expect(approveSurveyUpdate).toHaveBeenCalledWith("u1"));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByLabelText(/Value to put on their record/), {
      target: { value: "(337) 555-0199" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve with this value" }));
    await waitFor(() => expect(approveSurveyUpdate).toHaveBeenCalledWith("u1", "(337) 555-0199"));
  });

  it("asks before rejecting, and a photo can't be edited", async () => {
    renderPage();
    await screen.findByText("(337) 555-0100");
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Reject" })[1]);
    expect(await screen.findByText(/the photo is deleted/)).toBeInTheDocument();
  });

  it("shows the server's reason when a value can't be applied", async () => {
    approveSurveyUpdate.mockRejectedValue({
      response: { data: { error: "That doesn't look like a phone number" } },
    });
    renderPage();
    await screen.findByText("(337) 555-0100");
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("phone number"));
  });

  it("groups a partner's changes and decides them together", async () => {
    fetchSurveyUpdates.mockResolvedValue([
      phone,
      photo,
      { ...phone, id: "u3", partnerId: "p2", partnerName: "Bob Oakleigh" },
    ]);
    renderPage();
    await screen.findByText("Bob Oakleigh");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Approve all 2" }));
    await waitFor(() => expect(approveSurveyUpdate).toHaveBeenCalledTimes(2));
    expect(approveSurveyUpdate).toHaveBeenCalledWith("u1");
    expect(approveSurveyUpdate).toHaveBeenCalledWith("u2");
    expect(approveSurveyUpdate).not.toHaveBeenCalledWith("u3");
  });
});
