import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import AdminBooklet from "./AdminBooklet.jsx";
import { fetchPartners } from "../api/client.js";

// AdminBooklet fetches the full partner list itself (fetchPartners({
// include: "full" })) and reads two independent contexts for
// church/branding details neither test case below cares about -- mock all
// three so this only has to exercise the include/exclude filtering that
// feeds buildBookletHtml.
vi.mock("../api/client.js", () => ({
  fetchPartners: vi.fn(),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({
    partnerTermPlural: "Missionaries",
    usePartnerTermInAdmin: false,
    loading: false,
    churchName: "Test Church",
    logo: null,
  }),
}));
vi.mock("../hooks/useChurchSettings.js", () => ({
  default: () => ({ settings: null, loading: false, error: null }),
}));

const RESTRICTED_MISSIONARY = {
  id: "m-restricted",
  kind: "missionary",
  displayName: "Restricted Missionary",
  archived: false,
  isRestricted: true,
};
const OPEN_MISSIONARY = {
  id: "m-open",
  kind: "missionary",
  displayName: "Open Missionary",
  archived: false,
  isRestricted: false,
};
const RESTRICTED_ORG = {
  id: "o-restricted",
  kind: "organization",
  displayName: "Restricted Org",
  orgType: "Local",
  archived: false,
  isRestricted: true,
};
const OPEN_ORG = {
  id: "o-open",
  kind: "organization",
  displayName: "Open Org",
  orgType: "Local",
  archived: false,
  isRestricted: false,
};

function getPreviewHtml() {
  return document.querySelector(".booklet-preview").innerHTML;
}

describe("AdminBooklet restricted-access filtering", () => {
  it("excludes a restricted missionary and a restricted organization from the preview when unchecked", async () => {
    fetchPartners.mockResolvedValue([RESTRICTED_MISSIONARY, OPEN_MISSIONARY, RESTRICTED_ORG, OPEN_ORG]);
    render(<AdminBooklet />);

    await waitFor(() => expect(document.querySelector(".booklet-preview")).toBeInTheDocument());
    // Preview content settles once the fetched partners land.
    await waitFor(() => expect(getPreviewHtml()).toContain("Open Missionary"));

    // Restricted-access defaults to checked (includeRestricted starts
    // true) -- both restricted entries print until the admin unchecks it.
    expect(getPreviewHtml()).toContain("Restricted Missionary");
    expect(getPreviewHtml()).toContain("Restricted Org");

    fireEvent.click(screen.getByRole("checkbox", { name: "Restricted-access" }));

    await waitFor(() => expect(getPreviewHtml()).not.toContain("Restricted Missionary"));
    // The bug under #270: this line used to still be present because the
    // organizations filter never checked isRestricted at all.
    expect(getPreviewHtml()).not.toContain("Restricted Org");

    // Unaffected entries keep printing either way.
    expect(getPreviewHtml()).toContain("Open Missionary");
    expect(getPreviewHtml()).toContain("Open Org");
  });
});
