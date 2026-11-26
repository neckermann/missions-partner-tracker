import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SurveysCard from "./SurveysCard.jsx";
import { fetchPartnerSurveys, savePartnerSurvey } from "../../api/client.js";

vi.mock("../../api/client.js", () => ({
  fetchPartnerSurveys: vi.fn(),
  savePartnerSurvey: vi.fn(),
}));

const question = {
  id: "q1",
  kind: "text",
  label: "How are you?",
  choices: [],
  allowOther: false,
  required: false,
};
const open = {
  id: "s1",
  title: "Check-in",
  intro: null,
  status: "open",
  questions: [question],
  response: null,
  invite: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  savePartnerSurvey.mockResolvedValue({ submitted: true });
});

describe("SurveysCard", () => {
  it("renders nothing when the feature is off or the viewer can't reach it", async () => {
    fetchPartnerSurveys.mockRejectedValue({ response: { status: 404 } });
    const { container } = render(<SurveysCard partnerId="p1" />);
    await waitFor(() => expect(fetchPartnerSurveys).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("lists a survey with where it stands, and staff fill it in for the partner", async () => {
    fetchPartnerSurveys.mockResolvedValue({ canEdit: true, surveys: [open] });
    render(<SurveysCard partnerId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Check-in · not sent/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: /How are you/ }), {
      target: { value: "Fine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save as answered" }));
    await waitFor(() => expect(savePartnerSurvey).toHaveBeenCalled());
    expect(savePartnerSurvey).toHaveBeenCalledWith(
      "s1",
      "p1",
      [{ questionId: "q1", value: "Fine", values: [], other: null }],
      true
    );
  });

  it("shows an answered survey read-only, with who entered it", async () => {
    fetchPartnerSurveys.mockResolvedValue({
      canEdit: false,
      surveys: [
        {
          ...open,
          response: {
            submittedAt: "2026-11-20T12:00:00Z",
            enteredByName: "Dana",
            answers: [
              {
                id: "a1",
                questionId: "q1",
                label: "How are you?",
                kind: "text",
                value: "Great",
                values: [],
                other: null,
              },
            ],
          },
        },
      ],
    });
    render(<SurveysCard partnerId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Check-in · answered .* by Dana/ }));
    expect(await screen.findByText("Great")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit answers/ })).not.toBeInTheDocument();
  });
});
