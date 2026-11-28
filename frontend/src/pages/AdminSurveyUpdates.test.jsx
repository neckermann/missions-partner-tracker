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

  it("shows a phone and a contact method the way a person reads them, the same for Now and Suggested (#548)", async () => {
    fetchSurveyUpdates.mockResolvedValue([
      {
        ...phone,
        id: "r1",
        inputType: "tel",
        problem: null,
        currentValue: "(506) 555-0259",
        proposedValue: "+15065550260",
      },
      {
        ...phone,
        id: "r2",
        field: "contactMethod",
        fieldLabel: "How they prefer to be contacted",
        inputType: "contactMethod",
        problem: null,
        currentValue: "call",
        proposedValue: "whatsapp",
      },
    ]);
    renderPage();
    expect(await screen.findByText("(506) 555-0260")).toBeInTheDocument();
    expect(screen.getByText("(506) 555-0259")).toBeInTheDocument();
    expect(screen.getByText("Phone call")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.queryByText("+15065550260")).not.toBeInTheDocument();
  });

  it("says why a suggestion that isn't a real value can't be approved, and offers Edit and Reject instead (#548)", async () => {
    fetchSurveyUpdates.mockResolvedValue([
      {
        ...phone,
        id: "j1",
        inputType: "tel",
        currentValue: "(506) 555-0259",
        proposedValue: "dsafdsfsadf",
        problem:
          "That doesn't look like a phone number. Include the area code, or start with + and the country code.",
      },
    ]);
    renderPage();
    expect(await screen.findByText("dsafdsfsadf")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Can't be approved as it is: That doesn't look like a phone number/
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(approveSurveyUpdate).not.toHaveBeenCalled();
  });

  it("edits a phone in a phone box, and a contact method from the fixed list (#548)", async () => {
    fetchSurveyUpdates.mockResolvedValue([
      {
        ...phone,
        id: "e1",
        inputType: "tel",
        problem: "That doesn't look like a phone number.",
        proposedValue: "12",
      },
      {
        ...phone,
        id: "e2",
        field: "contactMethod",
        fieldLabel: "How they prefer to be contacted",
        inputType: "contactMethod",
        problem: null,
        currentValue: "call",
        proposedValue: "text",
      },
    ]);
    renderPage();
    await screen.findByText("Text message");
    const edits = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(edits[0]);
    const box = await screen.findByLabelText("Value to put on their record");
    expect(box).toHaveAttribute("type", "tel");
    fireEvent.change(box, { target: { value: "(506) 555-0259" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve with this value" }));
    await waitFor(() => expect(approveSurveyUpdate).toHaveBeenCalledWith("e1", "(506) 555-0259"));
  });

  it("approves only the suggestions that are ready, and says how many (#548)", async () => {
    fetchSurveyUpdates.mockResolvedValue([
      { ...phone, id: "g1", inputType: "tel", problem: null },
      { ...phone, id: "g2", field: "primaryEmail", fieldLabel: "Email", inputType: "email", problem: null },
      {
        ...phone,
        id: "g3",
        inputType: "tel",
        proposedValue: "nope",
        problem: "That doesn't look like a phone number.",
      },
    ]);
    renderPage();
    const button = await screen.findByRole("button", { name: "Approve the 2 that are ready" });
    fireEvent.click(button);
    await waitFor(() => expect(approveSurveyUpdate).toHaveBeenCalledTimes(2));
    expect(approveSurveyUpdate).toHaveBeenCalledWith("g1");
    expect(approveSurveyUpdate).toHaveBeenCalledWith("g2");
    expect(approveSurveyUpdate).not.toHaveBeenCalledWith("g3");
  });
});

describe("AdminSurveyUpdates: which survey a change came from", () => {
  it("names the survey once in the heading when all of a partner's changes came from one", async () => {
    renderPage();
    expect(await screen.findByText(/· Annual update/)).toBeInTheDocument();
    expect(screen.queryByText(/surveys$/)).toBeNull();
  });

  it("names each change's own survey, not the first one's, when they came from different surveys", async () => {
    fetchSurveyUpdates.mockResolvedValue([phone, { ...photo, surveyTitle: "Prayer letter" }]);
    renderPage();
    expect(await screen.findByText("· 2 surveys")).toBeInTheDocument();
    expect(screen.getByText(/· Annual update/)).toBeInTheDocument();
    expect(screen.getByText(/· Prayer letter/)).toBeInTheDocument();
  });
});
