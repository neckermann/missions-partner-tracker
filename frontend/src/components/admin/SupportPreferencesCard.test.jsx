import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SupportPreferencesCard, { groupOptions, describeResponse } from "./SupportPreferencesCard.jsx";
import { fetchPartnerSupportPreferences, savePartnerSupportPreferences } from "../../api/client.js";

// A partner's support preferences, recorded by staff or the care team.
vi.mock("../../api/client.js", () => ({
  fetchPartnerSupportPreferences: vi.fn(),
  savePartnerSupportPreferences: vi.fn(),
}));

const options = [
  {
    id: "o1",
    group: "Logistics",
    label: "Airport pick-up",
    kind: "offer",
    choices: [],
    allowOther: false,
    active: true,
  },
  {
    id: "o2",
    group: "Gifts",
    label: "How should gifts be sent?",
    kind: "single",
    choices: ["Bank transfer", "A transfer app"],
    allowOther: true,
    active: true,
  },
  {
    id: "o3",
    group: "Gifts",
    label: "Care packages",
    kind: "offer",
    choices: [],
    allowOther: false,
    active: true,
  },
];

function renderCard(props = {}) {
  render(
    <MemoryRouter>
      <SupportPreferencesCard partnerId="p1" {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  savePartnerSupportPreferences.mockResolvedValue({ saved: 1, cleared: 0 });
});

describe("SupportPreferencesCard", () => {
  it("shows what the partner chose, grouped, with their answers and notes", async () => {
    fetchPartnerSupportPreferences.mockResolvedValue({
      options,
      canEdit: true,
      preferences: [
        {
          optionId: "o1",
          selected: true,
          note: "Early flights",
          choice: null,
          choices: [],
          other: null,
          text: null,
        },
        {
          optionId: "o2",
          selected: true,
          choice: "Bank transfer",
          choices: [],
          other: null,
          text: null,
          note: null,
        },
      ],
    });
    renderCard();
    expect(await screen.findByText("Support Preferences")).toBeInTheDocument();
    expect(screen.getByText(/2 preferences recorded/)).toBeInTheDocument();
    expect(screen.queryByText("Early flights")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View all →" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Logistics", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByText(/Airport pick-up/)).toBeInTheDocument();
    expect(screen.getByText("Early flights")).toBeInTheDocument();
    expect(screen.getByText("Bank transfer")).toBeInTheDocument();
    expect(screen.queryByText(/Care packages/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("renders nothing for someone who can't reach it (a trip leader) or when the feature is off", async () => {
    for (const status of [403, 404]) {
      fetchPartnerSupportPreferences.mockRejectedValueOnce({ response: { status } });
      const { container, unmount } = render(
        <MemoryRouter>
          <SupportPreferencesCard partnerId="p1" />
        </MemoryRouter>
      );
      await waitFor(() => expect(fetchPartnerSupportPreferences).toHaveBeenCalled());
      await waitFor(() => expect(container).toBeEmptyDOMElement());
      unmount();
    }
  });

  it("says when nothing is recorded and offers to record it; a viewer gets no button", async () => {
    fetchPartnerSupportPreferences.mockResolvedValue({ options, canEdit: false, preferences: [] });
    renderCard();
    expect(await screen.findByText(/Nothing recorded yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Record/ })).not.toBeInTheDocument();
  });

  it("points an admin at Settings when no menu exists", async () => {
    fetchPartnerSupportPreferences.mockResolvedValue({ options: [], canEdit: true, preferences: [] });
    renderCard({ isAdmin: true });
    expect(await screen.findByRole("link", { name: "Set up the menu" })).toHaveAttribute(
      "href",
      "/admin/settings/support-preferences"
    );
  });

  it("records a choice: ticks an offer, picks an answer, and saves every option", async () => {
    fetchPartnerSupportPreferences.mockResolvedValue({ options, canEdit: true, preferences: [] });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "+ Record" }));
    fireEvent.click(screen.getByLabelText("Airport pick-up"));
    fireEvent.change(screen.getByLabelText("How should gifts be sent?"), {
      target: { value: "A transfer app" },
    });
    fireEvent.change(screen.getByLabelText("Note for Airport pick-up"), { target: { value: "Window seat" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(savePartnerSupportPreferences).toHaveBeenCalled());
    const [partnerId, body] = savePartnerSupportPreferences.mock.calls[0];
    expect(partnerId).toBe("p1");
    expect(body).toHaveLength(3);
    expect(body.find((b) => b.optionId === "o1")).toMatchObject({ selected: true, note: "Window seat" });
    expect(body.find((b) => b.optionId === "o2")).toMatchObject({ choice: "A transfer app", other: null });
    expect(body.find((b) => b.optionId === "o3")).toMatchObject({
      selected: false,
      choice: null,
      note: null,
    });
  });
});

describe("helpers", () => {
  it("groups options by group name in the order given", () => {
    expect(groupOptions(options).map((g) => [g.name, g.options.length])).toEqual([
      ["Logistics", 1],
      ["Gifts", 2],
    ]);
  });

  it("describes each kind of response in one line", () => {
    expect(describeResponse(options[0], { selected: true })).toBe("Yes");
    expect(describeResponse(options[1], { choice: null, other: "Mission board" })).toBe("Mission board");
    expect(describeResponse({ kind: "multiple" }, { choices: ["A", "B"], other: "C" })).toBe("A, B, C");
    expect(describeResponse({ kind: "text" }, { text: "hello" })).toBe("hello");
    expect(describeResponse(options[0], undefined)).toBe("");
  });
});
