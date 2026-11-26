import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminPendingDispatches from "./AdminPendingDispatches.jsx";
import { fetchPendingDispatches, updatePendingDispatch } from "../api/client.js";

// A care team member's prayer request or need is held for staff review whatever the partner.
// The page has to say WHY it's held ("entered by a care team member", not "restricted"), and
// the approval dialog has to match, since telling an admin an ordinary partner "is restricted"
// would be wrong.
vi.mock("../api/client.js", () => ({
  fetchPendingDispatches: vi.fn(),
  deletePendingDispatch: vi.fn(),
  updatePendingDispatch: vi.fn(),
}));
let confirmArgs;
vi.mock("../hooks/useConfirmDialog.jsx", () => ({
  default: () => ({
    confirm: vi.fn(async (args) => {
      confirmArgs = args;
      return false; // looking at the dialog is enough; don't actually approve
    }),
    confirmElement: null,
  }),
}));
vi.mock("../hooks/useCurrentUser.js", () => ({ default: () => ({ canWrite: true }) }));
let channels = { outboundEmail: true, groupme: false, whatsapp: false };
vi.mock("../context/SettingsContext.jsx", () => ({ useSettings: () => ({ enabledFeatures: channels }) }));

const blurb = (over) => ({
  id: "d1",
  type: "prayerRequestCreated",
  partnerId: "p1",
  partnerName: "Example Partner",
  emoji: "🙏",
  summary: "New prayer request",
  bodyText: "Please pray for the clinic opening.",
  isRestricted: false,
  needsReview: true,
  reviewRequired: false,
  dispatchReviewedAt: null,
  ...over,
});

beforeEach(() => {
  confirmArgs = null;
  vi.clearAllMocks();
});

async function renderWith(items) {
  fetchPendingDispatches.mockResolvedValue(items);
  render(<AdminPendingDispatches />);
  await screen.findByText("Example Partner");
}

describe("AdminPendingDispatches -- why an item is held (#289)", () => {
  it("says a care team member entered it when the partner isn't restricted", async () => {
    await renderWith([blurb({ reviewRequired: true })]);
    expect(screen.getByText("Awaiting review · entered by a care team member")).toBeInTheDocument();
    expect(screen.queryByText("🔒 Restricted")).not.toBeInTheDocument();
  });

  it("keeps the plain wording for a restricted partner's held item", async () => {
    await renderWith([blurb({ isRestricted: true })]);
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.queryByText(/care team member/)).not.toBeInTheDocument();
  });

  it("approving a care team item shows the care team confirmation, never 'restricted'", async () => {
    await renderWith([blurb({ reviewRequired: true })]);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(confirmArgs).not.toBeNull());
    render(confirmArgs.body);
    expect(screen.getByText(/A care team member entered this/)).toBeInTheDocument();
    expect(screen.queryByText(/This partner is restricted/)).not.toBeInTheDocument();
    expect(updatePendingDispatch).not.toHaveBeenCalled();
  });

  it("approving a restricted partner's item still shows the restricted confirmation", async () => {
    await renderWith([blurb({ isRestricted: true })]);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(confirmArgs).not.toBeNull());
    render(confirmArgs.body);
    expect(screen.getByText(/This partner is restricted/)).toBeInTheDocument();
  });

  it("shows no review badge once an item has been reviewed", async () => {
    await renderWith([blurb({ reviewRequired: true, needsReview: false, dispatchReviewedAt: "2026-11-24" })]);
    expect(screen.queryByText(/Awaiting review/)).not.toBeInTheDocument();
  });
});

describe("with no way to send (the email-off option for dispatches)", () => {
  const ready = blurb({
    id: "d2",
    needsReview: false,
    summary: "New prayer request",
    bodyText: "Pray for the clinic.",
  });
  const held = blurb({ id: "d3", needsReview: true, bodyText: "Held text", partnerName: "Held Partner" });

  it("offers to copy what is ready, leaving out what is held for review", async () => {
    channels = { outboundEmail: false, groupme: false, whatsapp: false };
    fetchPendingDispatches.mockResolvedValue([ready, held]);
    render(<AdminPendingDispatches />);
    expect(await screen.findByText("Nothing here goes out on its own")).toBeInTheDocument();
    expect(screen.getByText(/Copy the 1 that is ready/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy the updates that are ready/ })).toBeInTheDocument();
  });

  it("says nothing when any channel is on", async () => {
    channels = { outboundEmail: false, groupme: true, whatsapp: false };
    fetchPendingDispatches.mockResolvedValue([ready]);
    render(<AdminPendingDispatches />);
    await screen.findByText("Updates to share");
    expect(screen.queryByText("Nothing here goes out on its own")).toBeNull();
  });

  it("says nothing when there is nothing ready (only held items)", async () => {
    channels = { outboundEmail: false, groupme: false, whatsapp: false };
    fetchPendingDispatches.mockResolvedValue([held]);
    render(<AdminPendingDispatches />);
    await screen.findByText("Updates to share");
    expect(screen.queryByText("Nothing here goes out on its own")).toBeNull();
  });
});
