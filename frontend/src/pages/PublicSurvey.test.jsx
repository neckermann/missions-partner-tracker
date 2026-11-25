import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PublicSurvey from "./PublicSurvey.jsx";
import { fetchPublicSurvey, savePublicSurvey, submitPublicSurvey } from "../api/client.js";

vi.mock("../api/client.js", () => ({
  fetchPublicSurvey: vi.fn(),
  savePublicSurvey: vi.fn(),
  submitPublicSurvey: vi.fn(),
  fetchPublicSettings: vi.fn().mockResolvedValue({}),
}));
vi.mock("../components/PublicSiteHeader.jsx", () => ({ default: ({ title }) => <h1>{title}</h1> }));
vi.mock("../components/DemoBanner.jsx", () => ({ default: () => null }));

const survey = {
  title: "Check-in",
  intro: "A few questions",
  submitted: false,
  questions: [
    { id: "q1", kind: "text", label: "How are you?", choices: [], allowOther: false, required: true },
  ],
  answers: [],
};

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/survey/abc"]}>
      <Routes>
        <Route path="/survey/:token" element={<PublicSurvey />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  savePublicSurvey.mockResolvedValue({ saved: true, submitted: false });
  submitPublicSurvey.mockResolvedValue({ saved: true, submitted: true });
});

describe("PublicSurvey", () => {
  it("says the same thing for any link that isn't available", async () => {
    fetchPublicSurvey.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    expect(await screen.findByText(/This link isn't available/)).toBeInTheDocument();
  });

  it("saves to finish later, then submits", async () => {
    fetchPublicSurvey.mockResolvedValue(survey);
    renderPage();
    fireEvent.change(await screen.findByRole("textbox", { name: /How are you/ }), {
      target: { value: "Well" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    expect(await screen.findByText(/Saved. You can come back/)).toBeInTheDocument();
    expect(savePublicSurvey).toHaveBeenCalledWith("abc", [
      { questionId: "q1", value: "Well", values: [], other: null },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText(/Thank you, your answers are in/)).toBeInTheDocument();
  });

  it("shows the server's message when a required question is missing", async () => {
    fetchPublicSurvey.mockResolvedValue(survey);
    submitPublicSurvey.mockRejectedValue({ response: { data: { error: "Please answer: How are you?" } } });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Please answer: How are you?"));
  });

  it("opens an already answered survey with a thank-you and lets them update", async () => {
    fetchPublicSurvey.mockResolvedValue({ ...survey, submitted: true });
    renderPage();
    expect(await screen.findByText(/Thank you, your answers are in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update my answers" })).toBeInTheDocument();
  });
});
