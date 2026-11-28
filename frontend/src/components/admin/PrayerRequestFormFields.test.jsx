import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PrayerRequestFormFields from "./PrayerRequestFormFields.jsx";
import { sentForReviewNote } from "../../utils/heldForReview.js";
import { useSettings } from "../../context/SettingsContext.jsx";

vi.mock("../../context/SettingsContext.jsx", () => ({
  useSettings: vi.fn(() => ({ enabledFeatures: { booklet: true, publicDirectory: true } })),
}));

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

describe("PrayerRequestFormFields: features that are off", () => {
  it("does not offer 'Include in printed booklet' when the booklet is off", () => {
    useSettings.mockReturnValue({ enabledFeatures: { booklet: false, publicDirectory: true } });
    render(<Harness mode="create" />);
    expect(screen.getByLabelText("Show on public profile")).toBeInTheDocument();
    expect(screen.queryByLabelText("Include in printed booklet")).toBeNull();
    useSettings.mockReturnValue({ enabledFeatures: { booklet: true, publicDirectory: true } });
  });
});

describe("PrayerRequestFormFields with no public page on", () => {
  it("offers one booklet box instead of a public-profile box, and it sets both fields", () => {
    useSettings.mockReturnValue({ enabledFeatures: { booklet: true } });
    render(<Harness initial={{ ...base, isPublic: false, includeInBooklet: false }} mode="create" />);
    expect(screen.queryByLabelText("Show on public profile")).toBeNull();
    fireEvent.click(screen.getByLabelText("Include in printed booklet"));
    expect(state()).toMatchObject({ isPublic: true, includeInBooklet: true });
    useSettings.mockReturnValue({ enabledFeatures: { booklet: true, publicDirectory: true } });
  });

  it("offers neither with the booklet off too", () => {
    useSettings.mockReturnValue({ enabledFeatures: { booklet: false } });
    render(<Harness mode="create" />);
    expect(screen.queryByLabelText("Show on public profile")).toBeNull();
    expect(screen.queryByLabelText("Include in printed booklet")).toBeNull();
  });
});
