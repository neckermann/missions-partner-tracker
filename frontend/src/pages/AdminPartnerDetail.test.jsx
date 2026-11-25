import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminPartnerDetail from "./AdminPartnerDetail.jsx";
import { updatePartner } from "../api/client.js";

// AdminPartnerDetail fetches the partner record plus every one of its
// own small collections on mount (see its own reload()), and reads the
// logged-in user's role via useCurrentUser -- none of which this test
// cares about beyond "resolve to something harmless." Only
// fetchPartner/updatePartner/fetchCurrentUser carry data these tests
// actually check.
vi.mock("../api/client.js", () => ({
  fetchPartner: vi.fn(),
  updatePartner: vi.fn().mockResolvedValue({}),
  fetchCurrentUser: vi.fn().mockResolvedValue({ role: "admin" }),
  fetchChurchSettings: vi.fn().mockResolvedValue({}),
  fetchPrayerRequests: vi.fn().mockResolvedValue([]),
  fetchPartnerFiles: vi.fn().mockResolvedValue([]),
  fetchSupportEntries: vi.fn().mockResolvedValue([]),
  fetchSupportNeeds: vi.fn().mockResolvedValue([]),
  fetchTrips: vi.fn().mockResolvedValue([]),
  fetchAdults: vi.fn().mockResolvedValue([]),
  fetchChildren: vi.fn().mockResolvedValue([]),
  fetchFurloughs: vi.fn().mockResolvedValue([]),
  fetchChurchVisits: vi.fn().mockResolvedValue([]),
  fetchPartnerLinks: vi.fn().mockResolvedValue([]),
  fetchPartnerLanguages: vi.fn().mockResolvedValue([]),
  fetchTripTypes: vi.fn().mockResolvedValue([]),
  createPrayerRequest: vi.fn(),
  updatePrayerRequest: vi.fn(),
  createSupportNeed: vi.fn(),
  updateSupportNeed: vi.fn(),
  createSupportEntry: vi.fn(),
  uploadPartnerFile: vi.fn(),
  updatePartnerFile: vi.fn(),
  createAdult: vi.fn(),
  updateAdult: vi.fn(),
  deleteAdult: vi.fn(),
  createChild: vi.fn(),
  updateChild: vi.fn(),
  deleteChild: vi.fn(),
  createFurlough: vi.fn(),
  updateFurlough: vi.fn(),
  deleteFurlough: vi.fn(),
  createChurchVisit: vi.fn(),
  updateChurchVisit: vi.fn(),
  deleteChurchVisit: vi.fn(),
  createPartnerLink: vi.fn(),
  updatePartnerLink: vi.fn(),
  deletePartnerLink: vi.fn(),
  createPartnerLanguage: vi.fn(),
  updatePartnerLanguage: vi.fn(),
  deletePartnerLanguage: vi.fn(),
  createTripType: vi.fn(),
  updateTripType: vi.fn(),
  deleteTripType: vi.fn(),
}));

// The Newsletters & Docs card only renders with partnerFiles on; a test flips this.
const features = vi.hoisted(() => ({ partnerFiles: false }));

vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({
    churchName: "Test Church",
    enabledFeatures: {
      prayerRequests: true,
      oneTimeNeeds: false,
      monthlySupport: false,
      trips: false,
      partnerFiles: features.partnerFiles,
      groupme: false,
      whatsapp: false,
      outboundEmail: false,
      joshuaProject: false,
    },
  }),
}));

// Organization, not missionary, specifically to skip the Sending
// Church/Sending Org sections (missionary-only) -- this page renders a
// lot per partner, and this fixture only needs to be complete enough to
// reach the "Last Prayed For in a Service" section in the Communication
// group without crashing on a missing field elsewhere.
const BASE_PARTNER = {
  id: "partner-1",
  kind: "organization",
  displayName: "Test Organization",
  fieldDisplayName: "",
  fipsCountryCode: null,
  isPublic: false,
  isRestricted: false,
  archived: false,
  archivedAt: null,
  overview: "",
  overviewShort: "",
  focusArea: "",
  supportingSince: null,
  contactMethod: null,
  contactLevel: "normal",
  sentByOurChurch: false,
  contactFirstName: null,
  contactLastName: null,
  contactPhone: null,
  contactEmail: null,
  orgType: "Local",
  anniversary: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  emergencyContactEmail: null,
  tripTeamSizeMin: null,
  tripTeamSizeMax: null,
  tripSeasonNotes: null,
  tripLogisticsNotes: null,
  addresses: [],
  sendingParties: [],
  photos: [],
  furloughs: [],
  lastPrayedWithCongregationAt: null,
};

function renderDetailPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/partners/partner-1"]}>
      <Routes>
        <Route path="/admin/partners/:id" element={<AdminPartnerDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AdminPartnerDetail: Last Prayed For in a Service (#228)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Never" and lets an admin mark it prayed today in one click', async () => {
    const { fetchPartner } = await import("../api/client.js");
    fetchPartner.mockResolvedValue({ ...BASE_PARTNER });
    updatePartner.mockResolvedValue({});

    renderDetailPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Test Organization" })).toBeInTheDocument()
    );
    expect(screen.getByText("Never")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark Prayed Today" }));

    await waitFor(() => expect(updatePartner).toHaveBeenCalledTimes(1));
    const [id, patch] = updatePartner.mock.calls[0];
    expect(id).toBe("partner-1");
    expect(patch.lastPrayedWithCongregationAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("shows a caption clarifying this is corporate prayer, not an individual prayer request", async () => {
    const { fetchPartner } = await import("../api/client.js");
    fetchPartner.mockResolvedValue({ ...BASE_PARTNER });

    renderDetailPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Test Organization" })).toBeInTheDocument()
    );
    expect(screen.getByRole("heading", { name: "Last Prayed For in a Service" })).toBeInTheDocument();
    expect(screen.getByText(/not an individual prayer request/)).toBeInTheDocument();
  });

  it("lets an admin backdate it through the edit popup, not just today", async () => {
    const { fetchPartner } = await import("../api/client.js");
    fetchPartner.mockResolvedValue({
      ...BASE_PARTNER,
      lastPrayedWithCongregationAt: "2026-10-01T00:00:00.000Z",
    });
    updatePartner.mockResolvedValue({});

    renderDetailPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Test Organization" })).toBeInTheDocument()
    );

    // The whole card (title + current view content) is the click target
    // to open the edit popup -- same convention as every other
    // EditableSection on this page.
    fireEvent.click(screen.getByRole("button", { name: /Last Prayed For in a Service/ }));

    // getByLabelText is ambiguous here -- the Modal's own aria-labelledby
    // points at the same heading text as the <label> wrapping the date
    // input, so both it and the dialog itself match "labelled by this
    // text." The known current value is unique, so look it up by that
    // instead.
    const dateInput = screen.getByDisplayValue("2026-10-01");
    fireEvent.change(dateInput, { target: { value: "2026-09-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updatePartner).toHaveBeenCalledTimes(1));
    expect(updatePartner).toHaveBeenCalledWith("partner-1", {
      lastPrayedWithCongregationAt: "2026-09-15",
    });
  });

  it("hides the Mark Prayed Today action for a read-only viewer", async () => {
    const { fetchPartner, fetchCurrentUser } = await import("../api/client.js");
    fetchCurrentUser.mockResolvedValue({ role: "viewer" });
    fetchPartner.mockResolvedValue({ ...BASE_PARTNER });

    renderDetailPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Test Organization" })).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "Mark Prayed Today" })).not.toBeInTheDocument();
  });
});

describe("AdminPartnerDetail: Newsletters & Docs card (#369)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    features.partnerFiles = true;
  });

  it("names each file's kind, never 'undefined', and shows a custom kind's own text", async () => {
    const { fetchPartner, fetchPartnerFiles } = await import("../api/client.js");
    fetchPartner.mockResolvedValue({ ...BASE_PARTNER });
    fetchPartnerFiles.mockResolvedValue([
      { id: "f1", title: "Winter 2023", fileName: "w.pdf", kind: "newsletter", receivedDate: "2025-06-19" },
      {
        id: "f2",
        title: "Prayer card",
        fileName: "c.pdf",
        kind: "other",
        customKind: "Prayer card",
        receivedDate: "2025-06-20",
      },
    ]);

    renderDetailPage();

    expect(await screen.findByText(/Winter 2023 · Newsletter ·/)).toBeInTheDocument();
    expect(screen.getByText(/Prayer card · Prayer card ·/)).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    features.partnerFiles = false;
  });
});

describe("AdminPartnerDetail: a partner that can't be loaded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    features.partnerFiles = false;
  });

  it("says it wasn't found instead of loading forever when the partner is gone (404)", async () => {
    const { fetchPartner } = await import("../api/client.js");
    fetchPartner.mockRejectedValue({ response: { status: 404 } });

    renderDetailPage();

    expect(
      await screen.findByText("This partner wasn't found. It may have been deleted.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to Partners/ })).toBeInTheDocument();
  });

  it("says there is no access when the partner is out of reach (403)", async () => {
    const { fetchPartner } = await import("../api/client.js");
    fetchPartner.mockRejectedValue({ response: { status: 403 } });

    renderDetailPage();

    expect(await screen.findByText("You don't have access to this partner.")).toBeInTheDocument();
  });
});
