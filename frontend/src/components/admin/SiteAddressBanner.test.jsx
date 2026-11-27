import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SiteAddressBanner from "./SiteAddressBanner.jsx";

let configured;
vi.mock("../../hooks/useCurrentUser.js", () => ({
  default: () => ({ configuredSiteOrigin: configured }),
}));

describe("SiteAddressBanner", () => {
  it("names both addresses when the browser is at one the site is not set to", () => {
    configured = "https://church.example.org";
    render(<SiteAddressBanner here="https://church.onrender.com" />);
    const note = screen.getByRole("alert");
    expect(note.textContent).toContain("You are at https://church.onrender.com");
    expect(note.textContent).toContain("set to https://church.example.org");
    expect(screen.getByRole("link", { name: "https://church.example.org" })).toBeTruthy();
  });

  it("is silent when the addresses match, when none is set, and for everyone who is not told one", () => {
    configured = "https://church.example.org";
    const { container, rerender } = render(<SiteAddressBanner here="https://church.example.org" />);
    expect(container.textContent).toBe("");
    configured = null;
    rerender(<SiteAddressBanner here="https://anything.example.org" />);
    expect(container.textContent).toBe("");
  });
});
