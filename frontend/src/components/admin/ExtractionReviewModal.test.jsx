import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ExtractionReviewModal from "./ExtractionReviewModal.jsx";

// createPrayerRequest/createSupportNeed are never called by either test
// below (no "Add" click happens) -- mocked only so the module import
// itself doesn't reach for a real api client.
vi.mock("../../api/client.js", () => ({
  createPrayerRequest: vi.fn(),
  createSupportNeed: vi.fn(),
}));
vi.mock("../../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: { prayerRequests: true, oneTimeNeeds: true } }),
}));

function renderModal(scanResult) {
  const scan = vi.fn().mockResolvedValue(scanResult);
  render(
    <ExtractionReviewModal
      scan={scan}
      partnerId="p1"
      defaultDate="2026-03-01"
      sourceFileId="f1"
      onClose={vi.fn()}
    />
  );
}

// #323: the already-scanned banner is informational only -- it must never
// block or hide the suggestions themselves, so each case below also checks
// those still render normally alongside it.
describe("ExtractionReviewModal -- #323 already-scanned banner", () => {
  it("shows the banner with the right count when the file was already scanned", async () => {
    renderModal({
      prayerRequests: [{ category: "situational", background: "", requestText: "Pray for travel." }],
      oneTimeNeeds: [],
      alreadyScannedCount: 3,
    });

    await waitFor(() => expect(screen.getByText(/This file was already scanned/)).toBeInTheDocument());
    expect(screen.getByText(/3 request\(s\)\/need\(s\) were already added from it/)).toBeInTheDocument();
    // Still shows the new suggestion -- the banner is informational, not a
    // gate on reviewing/adding more.
    expect(screen.getByText("Prayer requests")).toBeInTheDocument();
  });

  it("shows no banner at all when the count is zero", async () => {
    renderModal({
      prayerRequests: [],
      oneTimeNeeds: [{ background: "", description: "Need $500.", requestedAmount: 500 }],
      alreadyScannedCount: 0,
    });

    await waitFor(() => expect(screen.getByText("One-time needs")).toBeInTheDocument());
    expect(screen.queryByText(/already scanned/)).not.toBeInTheDocument();
  });

  it("shows no banner when the field is absent from the response entirely (older/mocked backend)", async () => {
    renderModal({ prayerRequests: [], oneTimeNeeds: [] });

    await waitFor(() =>
      expect(screen.getByText("No prayer requests or one-time needs found in this file.")).toBeInTheDocument()
    );
    expect(screen.queryByText(/already scanned/)).not.toBeInTheDocument();
  });
});
