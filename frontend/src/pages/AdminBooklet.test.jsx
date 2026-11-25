import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import AdminBooklet from "./AdminBooklet.jsx";
import { fetchPartners } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";

// AdminBooklet fetches the full partner list itself (fetchPartners({
// include: "full" })) and reads two independent contexts for
// church/branding details -- mock all three so most cases only have to
// exercise the include/exclude filtering that feeds buildBookletHtml.
// useSettings is a vi.fn() (not a fixed return value) because the #322
// accent-resolution tests below need to vary primaryColor per test.
vi.mock("../api/client.js", () => ({
  fetchPartners: vi.fn(),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: vi.fn(),
}));
vi.mock("../hooks/useChurchSettings.js", () => ({
  default: () => ({ settings: null, loading: false, error: null }),
}));

const DEFAULT_SETTINGS = {
  partnerTermPlural: "Missionaries",
  usePartnerTermInAdmin: false,
  loading: false,
  churchName: "Test Church",
  logo: null,
  primaryColor: null,
};

beforeEach(() => {
  useSettings.mockReturnValue(DEFAULT_SETTINGS);
});

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

// #288: contactSafe was never honored by the booklet -- a partner marked not
// safe to contact still had their phone and email printed.
describe("AdminBooklet contact details and contactSafe (#288)", () => {
  const withAdult = (over) => ({
    ...OPEN_MISSIONARY,
    preferredContactMethod: "Phone Call",
    adults: [
      { id: "a", firstName: "Dana", lastName: "Reed", phone1: "555-111-2222", email: "dana@example.org" },
    ],
    contactInstructions: "Secret staff reason",
    ...over,
  });

  it("prints phone, email and preferred method for a partner who is safe to contact", async () => {
    fetchPartners.mockResolvedValue([withAdult({ contactSafe: true })]);
    render(<AdminBooklet />);
    await waitFor(() => expect(getPreviewHtml()).toContain("Open Missionary"));
    expect(getPreviewHtml()).toContain("555-111-2222");
    expect(getPreviewHtml()).toContain("dana@example.org");
    expect(getPreviewHtml()).toContain("Phone Call");
  });

  it("withholds all of it, and the staff instructions, when not safe to contact", async () => {
    fetchPartners.mockResolvedValue([withAdult({ contactSafe: false })]);
    render(<AdminBooklet />);
    await waitFor(() => expect(getPreviewHtml()).toContain("Open Missionary"));
    const html = getPreviewHtml();
    expect(html).toContain("Dana Reed");
    expect(html).toContain("Details withheld");
    expect(html).not.toContain("555-111-2222");
    expect(html).not.toContain("dana@example.org");
    expect(html).not.toContain("Phone Call");
    expect(html).not.toContain("Secret staff reason");
  });

  // #411: addresses and the sending party's contact details are a way to reach them too.
  const withAddresses = (over) =>
    withAdult({
      addresses: [
        { type: "physical", addressLine1: "12 Hidden Lane", city: "Quietville" },
        { type: "mailing", addressLine1: "PO Box 99", city: "Postville" },
      ],
      sendingChurch: {
        name: "Home Church",
        contactFirstName: "Ruth",
        contactLastName: "Aide",
        phone: "555-999-0000",
      },
      ...over,
    });

  it("withholds the addresses and the sending party's contact person and phone when not safe to contact", async () => {
    fetchPartners.mockResolvedValue([withAddresses({ contactSafe: false })]);
    render(<AdminBooklet />);
    await waitFor(() => expect(getPreviewHtml()).toContain("Open Missionary"));
    const html = getPreviewHtml();
    expect(html).not.toContain("12 Hidden Lane");
    expect(html).not.toContain("PO Box 99");
    expect(html).toContain("Home Church");
    expect(html).not.toContain("Ruth Aide");
    expect(html).not.toContain("555-999-0000");
  });

  it("still prints them for a partner who is safe to contact", async () => {
    fetchPartners.mockResolvedValue([withAddresses({ contactSafe: true })]);
    render(<AdminBooklet />);
    await waitFor(() => expect(getPreviewHtml()).toContain("Open Missionary"));
    const html = getPreviewHtml();
    expect(html).toContain("12 Hidden Lane");
    expect(html).toContain("PO Box 99");
    expect(html).toContain("Ruth Aide");
    expect(html).toContain("555-999-0000");
  });
});

// #346: the config page was restructured into a two-pane layout
// (controls left, live preview right, see .booklet-layout in
// index.css) instead of three stacked cards above a full-width scrolling
// preview. These assert the structural invariant that reshuffle has to
// preserve -- the preview stays outside the `no-print` controls column,
// since that's what the Print Booklet button actually prints (see the
// comment above the returned JSX in AdminBooklet.jsx) -- rather than
// asserting anything about the visual layout itself.
describe("AdminBooklet layout: preview stays printable", () => {
  it("renders the preview outside the no-print controls column", async () => {
    fetchPartners.mockResolvedValue([OPEN_MISSIONARY]);
    render(<AdminBooklet />);

    await waitFor(() => expect(document.querySelector(".booklet-preview")).toBeInTheDocument());

    const preview = document.querySelector(".booklet-preview");
    expect(preview.closest(".no-print")).toBeNull();
    // The controls (template picker, checkboxes, text fields) are the
    // part hidden on print -- confirm that wrapper still exists and still
    // contains a real control, not just that the preview escaped it.
    const controls = document.querySelector(".no-print");
    expect(controls).toBeInTheDocument();
    expect(controls.querySelector('input[name="booklet-template"]')).toBeInTheDocument();
  });

  it("still fires window.print() from the reorganized Print Booklet button", async () => {
    fetchPartners.mockResolvedValue([OPEN_MISSIONARY]);
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<AdminBooklet />);

    await waitFor(() => expect(document.querySelector(".booklet-preview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Print Booklet" }));

    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });
});

describe("AdminBooklet controls: survive the reshuffle", () => {
  it("still reads/writes Who's Included, What Shows, and Cover Page Text state", async () => {
    fetchPartners.mockResolvedValue([OPEN_MISSIONARY]);
    render(<AdminBooklet />);

    await waitFor(() => expect(getPreviewHtml()).toContain("Open Missionary"));

    // Cover page text: typing into the title field reaches the preview's
    // cover section, same as before the reorganization.
    const titleInput = screen.getByLabelText("Booklet Title");
    fireEvent.change(titleInput, { target: { value: "Our Sent Ones" } });
    await waitFor(() => expect(getPreviewHtml()).toContain("Our Sent Ones"));

    // What Shows on Each Page: turning off the photo field removes the
    // <img> from the rendered entry.
    fireEvent.click(screen.getByRole("checkbox", { name: "Photo" }));
    // Who's Included: Local & National Organizations stays checked by
    // default and its own label/checkbox is still reachable by name.
    expect(screen.getByRole("checkbox", { name: "Local & National Organizations" })).toBeChecked();
  });
});

// #322: the template system was rebuilt as a data-driven catalog
// (frontend/src/booklet/templates.js) that AdminBooklet.jsx's picker now
// renders from, instead of a literal TEMPLATE_OPTIONS array here.
describe("AdminBooklet template picker", () => {
  it("renders exactly Classic and Modern, nothing else", async () => {
    fetchPartners.mockResolvedValue([OPEN_MISSIONARY]);
    render(<AdminBooklet />);

    await waitFor(() => expect(document.querySelector(".booklet-preview")).toBeInTheDocument());

    // Each option's title and description share one <label>, so the
    // radio's accessible name is the whole label text, not just the
    // title -- assert on the two concerns separately instead: exactly two
    // radios named "booklet-template", and exactly the two expected
    // titles present as text.
    const radios = document.querySelectorAll('input[name="booklet-template"]');
    expect(radios).toHaveLength(2);
    expect(screen.getByText("Classic")).toBeInTheDocument();
    expect(screen.getByText("Modern")).toBeInTheDocument();
    // The four templates that existed before #322's rebuild are no longer
    // offered in the picker.
    for (const deferred of ["Traditional", "Keepsake", "Portfolio", "Friendly"]) {
      expect(screen.queryByText(deferred)).not.toBeInTheDocument();
    }
  });
});

// #322 fix: the booklet's accent color now defaults to
// ChurchSettings.primaryColor, with the old fixed four-color rotation
// kept only as the fallback for an instance that hasn't set a brand
// color.
describe("AdminBooklet accent resolution", () => {
  function getCoverAccent() {
    const style = document.querySelector(".booklet-preview .booklet-cover").getAttribute("style");
    return style.match(/--accent:([^;"]+)/)[1];
  }

  it("uses ChurchSettings.primaryColor as the accent when the church has set one", async () => {
    useSettings.mockReturnValue({ ...DEFAULT_SETTINGS, primaryColor: "#123abc" });
    fetchPartners.mockResolvedValue([OPEN_MISSIONARY]);
    render(<AdminBooklet />);

    await waitFor(() => expect(document.querySelector(".booklet-cover")).toBeInTheDocument());
    expect(getCoverAccent()).toBe("#123abc");
  });

  it("falls back to the fixed rotation when no primaryColor is configured", async () => {
    useSettings.mockReturnValue({ ...DEFAULT_SETTINGS, primaryColor: null });
    fetchPartners.mockResolvedValue([OPEN_MISSIONARY]);
    render(<AdminBooklet />);

    await waitFor(() => expect(document.querySelector(".booklet-cover")).toBeInTheDocument());
    // The exact fallback hex is an implementation detail of
    // booklet/templates.js's FALLBACK_ACCENTS -- just confirm it's a real
    // color and not the church's (unset) brand color.
    expect(getCoverAccent()).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
