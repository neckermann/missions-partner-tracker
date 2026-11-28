import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PrayerRequestFormFields from "./PrayerRequestFormFields.jsx";
import { sentForReviewNote } from "../../utils/heldForReview.js";

const base = {
  category: "strategic",
  requestText: "x",
  dateReceived: "2026-11-20",
  isPublic: true,
  includeInBooklet: true,
  isUrgent: false,
  approveNow: false,
  untracked: false,
  notes: "",
  sourceFileId: null,
};

function Harness({ initial = base, ...props }) {
  const [form, setForm] = React.useState(initial);
  return (
    <>
      <PrayerRequestFormFields form={form} setForm={setForm} files={[]} {...props} />
      <output data-testid="form">{JSON.stringify(form)}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("form").textContent);

describe("PrayerRequestFormFields: what each person may set", () => {
  it("staff see the public-profile and booklet boxes for a Ministry request", () => {
    render(<Harness mode="create" hasEnabledChannel enabledFeatures={{ groupme: true }} />);
    expect(screen.getByLabelText("Show on public profile")).toBeInTheDocument();
    expect(screen.getByLabelText("Include in printed booklet")).toBeInTheDocument();
    expect(screen.getByLabelText(/Mark as urgent/)).toBeInTheDocument();
  });

  it("a care team member who isn't staff sees neither the public-profile nor the booklet box", () => {
    render(<Harness mode="create" limited hasEnabledChannel />);
    expect(screen.queryByLabelText("Show on public profile")).toBeNull();
    expect(screen.queryByLabelText("Include in printed booklet")).toBeNull();
    expect(screen.queryByLabelText(/Mark as urgent/)).toBeNull();
  });

  it("an Everyday request offers neither urgent nor approve-now, says it stays with staff, and clears them", () => {
    render(
      <Harness
        mode="create"
        hasEnabledChannel
        enabledFeatures={{ groupme: true }}
        canApproveNow
        initial={{ ...base, isUrgent: true, approveNow: true }}
      />
    );
    expect(screen.getByLabelText(/Mark as urgent/)).toBeChecked();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "situational" } });
    expect(screen.queryByLabelText(/Mark as urgent/)).toBeNull();
    expect(screen.queryByLabelText(/Review and approve now/)).toBeNull();
    expect(screen.queryByLabelText("Show on public profile")).toBeNull();
    expect(screen.getByText(/never posted to a chat, emailed in an update/)).toBeInTheDocument();
    expect(state()).toMatchObject({
      category: "situational",
      isUrgent: false,
      approveNow: false,
      isPublic: false,
      includeInBooklet: false,
    });
  });
});

describe("sentForReviewNote", () => {
  it("names the church's own missions group, with a plain default", () => {
    expect(sentForReviewNote("Missions committee")).toBe(
      "Your request has gone to the Missions committee for review."
    );
    expect(sentForReviewNote("")).toBe("Your request has gone to the Missions team for review.");
    expect(sentForReviewNote(undefined)).toMatch(/for review\.$/);
  });
});
