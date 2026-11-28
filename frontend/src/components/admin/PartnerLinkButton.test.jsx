import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PartnerLinkButton from "./PartnerLinkButton.jsx";

const show = (props) =>
  render(
    <MemoryRouter>
      <PartnerLinkButton {...props} />
    </MemoryRouter>
  );

describe("PartnerLinkButton", () => {
  it("is a real link, styled as a button, that names the partner it goes to", () => {
    show({ partnerId: "p1", partners: [{ id: "p1", displayName: "Abernathy family" }] });
    const link = screen.getByRole("link", { name: "Go to Abernathy family →" });
    expect(link.getAttribute("href")).toBe("/admin/partners/p1");
    expect(link.className).toContain("btn");
  });

  it("falls back to 'Go to partner' when the partner is not in the list", () => {
    show({ partnerId: "p9", partners: [] });
    expect(screen.getByRole("link", { name: "Go to partner →" }).getAttribute("href")).toBe(
      "/admin/partners/p9"
    );
  });

  it("is absent when the record has no partner", () => {
    const { container } = show({ partnerId: "", partners: [] });
    expect(container.textContent).toBe("");
  });
});
